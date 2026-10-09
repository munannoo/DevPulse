import { git } from '../git/repo';
import { isSensitiveFile } from '../git/diff';
import { contentHash } from '../llm/cache';
import { createLlm } from '../llm/client';
import type { LlmConfig } from '../llm/config';
import { commitPrompt } from '../llm/prompts';
import { redact } from '../security/redact';

export class CommitDraftError extends Error {}
export type CommitDraft = { title: string; description: string; analysis: string };
export type StagedCommitInput = { content: string; skipped: string[]; fingerprint: string };
export async function stagedFingerprint(root: string, signal?: AbortSignal): Promise<string> {
  return contentHash(await git(root, ['diff', '--cached', '--raw', '--no-abbrev', '-z', '--no-ext-diff'], signal));
}
export async function stagedCommitInput(root: string, signal?: AbortSignal): Promise<StagedCommitInput> {
  const fingerprint = await stagedFingerprint(root, signal);
  const names = (await git(root, ['diff', '--cached', '--name-only', '-z', '--no-ext-diff'], signal)).split('\0').filter(Boolean);
  if (!names.length) { throw new CommitDraftError('Stage the changes you want to describe first.'); }
  const skipped = names.filter(file => isSensitiveFile(file) || /(^|\/)(?:node_modules|dist|\.git)\//.test(file));
  const files = names.filter(file => !skipped.includes(file));
  if (!files.length) { throw new CommitDraftError('Staged files are private or generated; no code was sent to Gemma.'); }
  const diff = await git(root, ['--literal-pathspecs', 'diff', '--cached', '--no-ext-diff', '--no-textconv', '--unified=3', '--', ...files], signal);
  const sections = diff.split(/(?=^diff --git )/m).filter(Boolean);
  const text = sections.filter(section => !/^Binary files .* differ$/m.test(section)).join('');
  if (sections.length && text !== diff) { skipped.push('Binary file changes'); }
  if (!text.trim()) { throw new CommitDraftError('No staged text changes to analyze.'); }
  if (text.length > 24_000) { throw new CommitDraftError('Staged diff exceeds 24,000 characters. Stage a smaller change to generate a complete draft.'); }
  if (await stagedFingerprint(root, signal) !== fingerprint) { throw new CommitDraftError('Staged changes moved. Run the command again.'); }
  return { content: redact(text), skipped: skipped.map(file => redact(file)), fingerprint };
}
export function validateCommitDraft(value: unknown): CommitDraft {
  if (!value || typeof value !== 'object') { throw new Error('Invalid commit draft.'); }
  const fields = value as Partial<Record<keyof CommitDraft, unknown>>;
  const text = (key: keyof CommitDraft, max: number) => {
    const raw = fields[key];
    if (typeof raw !== 'string' || !raw.trim() || raw.length > max || /command:|```|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/i.test(raw)) { throw new Error('Invalid commit draft.'); }
    return redact(raw.trim());
  };
  const title = text('title', 72);
  if (!/^(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\([a-z0-9._/-]+\))?!?: [^\r\n]+$/.test(title)) { throw new Error('Invalid commit title.'); }
  return { title, description: text('description', 1600), analysis: text('analysis', 2400) };
}
export async function generateCommitDraft(input: StagedCommitInput, config: LlmConfig, signal?: AbortSignal): Promise<CommitDraft> {
  return createLlm(config).chat({ system: commitPrompt,
    user: `Excluded files: ${JSON.stringify(input.skipped)}\nStaged diff:\n${input.content}`,
    json: validateCommitDraft, signal, timeoutMs: 30_000, maxTokens: 1000 });
}
