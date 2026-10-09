import { execFile } from 'node:child_process';
import { resolve } from 'node:path';

export class GitError extends Error {
  constructor(public readonly operation: string) { super(`Git ${operation} failed or timed out.`); }
}
export async function repository(cwd: string): Promise<string> {
  return (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
}
export async function gitPath(root: string, name: string): Promise<string> {
  return resolve(root, (await git(root, ['rev-parse', '--git-path', name])).trim());
}
export function git(cwd: string, args: string[], signal?: AbortSignal, timeout = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.quotepath=false', ...args], {
      cwd, signal, timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
    }, (error, stdout) => {
      // Do not propagate stderr: remote URLs may contain credentials.
      if (error) { reject(new GitError(args[0])); } else { resolve(stdout); }
    });
  });
}
export type BranchStatus = {
  root: string; branch: string; upstream?: string; ahead?: number; behind?: number;
  fresh: boolean; note?: string; head?: string;
};
export async function getBranchStatus(cwd: string, fetchRemote: boolean, signal?: AbortSignal): Promise<BranchStatus> {
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'], signal)).trim();
  const branch = (await git(root, ['branch', '--show-current'], signal)).trim();
  const status: BranchStatus = { root, branch: branch || 'Detached HEAD', fresh: false };
  try { status.head = (await git(root, ['rev-parse', '--verify', 'HEAD'], signal)).trim(); }
  catch { signal?.throwIfAborted(); status.note = 'No commits yet. Reviewing new files.'; return status; }
  if (!branch) { status.note = 'Detached HEAD has no branch upstream.'; return status; }
  try {
    status.upstream = (await git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], signal)).trim();
  } catch { signal?.throwIfAborted(); status.note = 'No upstream configured for this branch.'; return status; }
  if (fetchRemote) {
    try {
      const remote = (await git(root, ['config', '--get', `branch.${branch}.remote`], signal)).trim();
      if (remote && remote !== '.') { await git(root, ['fetch', '--quiet', '--', remote], signal); }
      status.fresh = true;
    } catch { signal?.throwIfAborted(); status.note = 'Fetch unavailable. Counts use the last fetched upstream.'; }
  } else { status.note = 'Counts use the last fetched upstream.'; }
  const counts = (await git(root, ['rev-list', '--left-right', '--count', 'HEAD...@{u}'], signal)).trim().split(/\s+/).map(Number);
  if (counts.length !== 2 || counts.some(count => !Number.isInteger(count) || count < 0)) {
    throw new GitError('upstream comparison');
  }
  [status.ahead, status.behind] = counts;
  return status;
}

export async function getCommitsSince(root: string, previous: string, head: string, signal?: AbortSignal): Promise<{ count: number; metadata: string }> {
  if (![previous, head].every(value => /^[a-f0-9]{40,64}$/i.test(value))) { throw new GitError('saved revision validation'); }
  if (previous === head) { return { count: 0, metadata: '' }; }
  await git(root, ['merge-base', '--is-ancestor', previous, head], signal);
  const range = `${previous}..${head}`;
  const count = Number((await git(root, ['rev-list', '--count', range], signal)).trim());
  if (!Number.isSafeInteger(count) || count < 0) { throw new GitError('commit count'); }
  const metadata = await git(root, ['log', '--max-count=20', '--format=Author: %an%nSubject: %s', '--name-only', range, '--'], signal);
  return { count, metadata: metadata.slice(0, 8000) };
}
