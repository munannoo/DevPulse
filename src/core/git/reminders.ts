import { readFile, stat } from 'node:fs/promises';
import { git, gitPath } from './repo';

export type RepositoryAttention = { dirty: boolean; hookInstalled: boolean };
export async function repositoryAttention(root: string, signal?: AbortSignal): Promise<RepositoryAttention> {
  const dirty = Boolean((await git(root, ['status', '--porcelain', '--untracked-files=normal'], signal)).trim());
  const hook = await gitPath(root, 'hooks/pre-commit');
  let hookInstalled = false;
  try {
    const info = await stat(hook);
    if (info.isFile() && info.size <= 64_000) { hookInstalled = (await readFile(hook, { encoding: 'utf8', signal })).includes('# DevPulse pre-commit guard'); }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; } }
  return { dirty, hookInstalled };
}
export type AttentionItem = { id: 'uncommitted' | 'hook' | 'prs'; text: string };
export function attentionItems(state: RepositoryAttention, since: number | undefined, now: number, oldMinutes: number, prs: number): AttentionItem[] {
  return [
    ...(!state.hookInstalled ? [{ id: 'hook' as const, text: 'DevPulse pre-commit guard is not installed.' }] : []),
    ...(prs > 0 ? [{ id: 'prs' as const, text: `${prs} PR(s) awaiting your review.` }] : []),
    ...(state.dirty && since !== undefined && now - since >= oldMinutes * 60_000 ? [{ id: 'uncommitted' as const, text: 'Uncommitted changes have been waiting. Review or commit when ready.' }] : []),
  ];
}
