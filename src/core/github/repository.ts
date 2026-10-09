import { git } from '../git/repo';

export type GitHubRepository = { owner: string; name: string };
export function parseGitHubRemote(remote: string): GitHubRepository | undefined {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(remote.trim());
  if (!match || [match[1], match[2]].some(part => part === '.' || part === '..')) { return undefined; }
  return { owner: match[1], name: match[2] };
}
export async function githubRepository(cwd: string, signal?: AbortSignal): Promise<GitHubRepository> {
  let remote = 'origin';
  try {
    const branch = (await git(cwd, ['branch', '--show-current'], signal)).trim();
    if (branch) { remote = (await git(cwd, ['config', '--get', `branch.${branch}.remote`], signal)).trim() || remote; }
  } catch { signal?.throwIfAborted(); }
  if (remote === '.') { remote = 'origin'; }
  let url: string;
  try { url = await git(cwd, ['remote', 'get-url', '--', remote], signal); }
  catch { signal?.throwIfAborted(); throw new Error('No GitHub remote found for this workspace.'); }
  const repository = parseGitHubRemote(url);
  if (!repository) { throw new Error('PR reviews currently require a github.com HTTPS or SSH remote.'); }
  return repository;
}
