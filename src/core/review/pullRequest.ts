import { changedRanges, diffPath, isSensitiveFile, type ReviewInput } from '../git/diff';
import { analyze } from './analyze';
import type { LlmConfig } from '../llm/config';
import { contentHash } from '../llm/cache';
import type { Finding } from '../llm/schemas';
import { GitHubClient, GitHubError, type PullRevision } from '../github/client';
import type { GitHubRepository } from '../github/repository';

export type PullReviewResult = {
  head: string; base: string; risk: 'security' | 'warning' | 'context' | 'none';
  summaries: Array<{ file: string; text: string }>; findings: Finding[]; skipped: string[];
};
export function pullInputs(diff: string): { inputs: ReviewInput[]; skipped: string[]; files: number } {
  const inputs: ReviewInput[] = []; const skipped: string[] = []; let total = 0;
  const sections = diff.split(/(?=^diff --git )/m).filter(section => section.startsWith('diff --git '));
  for (const section of sections) {
    const header = /^\+\+\+ (.+)$/m.exec(section)?.[1].replace(/\r$/, '');
    const file = header ? diffPath(header) : '';
    if (!file) { skipped.push('Deleted, binary or metadata-only file: no destination text'); continue; }
    if (file.startsWith('/') || file.includes('\\') || file.split('/').some(part => part === '..' || part === '.') || /^[A-Za-z]:/.test(file)) {
      skipped.push('Unsafe file path excluded'); continue;
    }
    if (isSensitiveFile(file) || /(^|\/)(?:node_modules|dist|\.git)\//.test(file) || /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(file)) {
      skipped.push(`${file}: private or generated file`); continue;
    }
    const hunks = [...section.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)];
    const lineCount = Math.max(1, ...hunks.map(match => Number(match[1]) + Number(match[2] ?? 1) - 1));
    if (!hunks.length || section.includes('\0')) { skipped.push(`${file}: no text changes`); continue; }
    if (inputs.length >= 20 || section.length > 24_000 || total + section.length > 80_000) { skipped.push(`${file}: review size limit`); continue; }
    inputs.push({ file, content: section, lineCount, kind: 'diff', changedRanges: changedRanges(section, lineCount) }); total += section.length;
  }
  return { inputs, skipped, files: sections.length };
}
function same(a: PullRevision, b: PullRevision): boolean { return a.head === b.head && a.base === b.base; }
export class PullReviewer {
  private readonly cache = new Map<string, PullReviewResult>();
  constructor(private readonly runAnalysis: typeof analyze = analyze) {}
  async review(client: GitHubClient, repository: GitHubRepository, number: number, config: LlmConfig, signal: AbortSignal,
    progress: (message: string) => void): Promise<PullReviewResult> {
    const revision = await client.revision(repository, number, signal);
    const key = contentHash(JSON.stringify([repository, number, revision, config]));
    const cached = this.cache.get(key);
    if (cached) { return structuredClone(cached); }
    const diff = await client.diff(repository, number, signal);
    if (!same(revision, await client.revision(repository, number, signal))) { throw new GitHubError('The PR changed while fetching its diff. Refresh and review again.'); }
    const { inputs, skipped, files } = pullInputs(diff);
    if (files !== revision.changedFiles) { throw new GitHubError('GitHub returned an incomplete PR diff. Review the PR on GitHub.'); }
    const result: PullReviewResult = { head: revision.head, base: revision.base, risk: 'none', summaries: [], findings: [], skipped };
    // Sequential execution bounds concurrency and shares the existing LLM queue/cache.
    for (const [index, input] of inputs.entries()) {
      signal.throwIfAborted(); progress(`Reviewing ${input.file} (${index + 1}/${inputs.length})…`);
      const review = await this.runAnalysis(input, config, signal);
      result.summaries.push({ file: input.file, text: review.summary || `${review.findings.length} finding(s).` });
      result.findings.push(...review.findings);
    }
    signal.throwIfAborted();
    if (!same(revision, await client.revision(repository, number, signal))) { throw new GitHubError('The PR changed during analysis. Refresh and review again.'); }
    result.risk = result.findings.some(item => item.severity === 'security') ? 'security'
      : result.findings.some(item => item.severity === 'warning') ? 'warning'
      : result.findings.length ? 'context' : 'none';
    if (this.cache.size >= 20) { this.cache.delete(this.cache.keys().next().value!); }
    this.cache.set(key, structuredClone(result));
    return result;
  }
}
