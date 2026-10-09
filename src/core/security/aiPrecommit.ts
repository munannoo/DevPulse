import { addedLines, changedRanges, diffPath, isSensitiveFile, type ReviewInput } from '../git/diff';
import type { LlmConfig } from '../llm/config';
import { precommitPrompt } from '../llm/prompts';
import { analyze } from '../review/analyze';
import type { Finding } from '../llm/schemas';
import { redact } from './redact';

export type AiScan = { findings: Finding[]; warning?: string };
export async function reviewStagedRisks(diff: string, config: LlmConfig, signal?: AbortSignal, timeoutMs = 10_000,
  run: typeof analyze = analyze): Promise<AiScan> {
  const controller = new AbortController();
  const cancel = () => controller.abort(); signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) { cancel(); }
  const timer = setTimeout(cancel, Math.max(1, Math.min(10_000, timeoutMs)));
  const findings: Finding[] = [];
  try {
    const sections = diff.split(/(?=^diff --git )/m).filter(part => part.startsWith('diff --git '));
    let total = 0, skipped = false;
    for (const section of sections) {
      controller.signal.throwIfAborted();
      const header = /^\+\+\+ (.+)$/m.exec(section)?.[1].replace(/\r$/, '');
      const file = header ? diffPath(header) : '';
      if (!file || isSensitiveFile(file) || /(^|\/)(?:node_modules|dist|\.git)\//.test(file)
        || /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(file)) { skipped = true; continue; }
      if (section.length > 24_000 || total + section.length > 80_000) { skipped = true; continue; }
      total += section.length;
      const lines = addedLines(section); if (!lines.length) { continue; }
      const lineCount = Math.max(1, ...lines.map(item => item.line));
      const input: ReviewInput = { file, content: redact(section), kind: 'diff', lineCount, changedRanges: changedRanges(section, lineCount) };
      const result = await run(input, config, controller.signal, undefined, precommitPrompt);
      controller.signal.throwIfAborted();
      findings.push(...result.findings.filter(finding => finding.severity === 'warning' || finding.severity === 'security'));
    }
    return { findings, ...(skipped ? { warning: 'AI review is partial: private, generated, binary or oversized changes were skipped.' } : {}) };
  } catch {
    return { findings: [], warning: controller.signal.aborted ? 'AI pre-commit review skipped: cancelled or exceeded its 10-second budget.'
      : 'AI pre-commit review skipped: Gemma is unavailable or returned an invalid response.' };
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
