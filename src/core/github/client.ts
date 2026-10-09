import type { GitHubRepository } from './repository';
import { redact } from '../security/redact';

export type PullRequest = { number: number; title: string; author: string };
export type PullRevision = { head: string; base: string; changedFiles: number };
export class GitHubError extends Error {}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { throw new GitHubError('GitHub returned an invalid response.'); }
  return value as Record<string, unknown>;
}
export class GitHubClient {
  constructor(private readonly token: string, private readonly request: typeof fetch = fetch) {}
  private async get(path: string, signal?: AbortSignal, diff = false): Promise<string> {
    try {
      const response = await this.request(`https://api.github.com${path}`, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: diff ? 'application/vnd.github.diff' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]), redirect: 'error',
      });
      if (!response.ok) {
        const message = response.status === 401 ? 'GitHub sign-in expired. Connect GitHub again.'
          : response.status === 403 || response.status === 429 ? 'GitHub access is restricted or rate limited. Try again later.'
          : response.status === 404 ? 'This pull request or repository is unavailable to your GitHub account.'
          : 'GitHub could not complete the request. Try again later.';
        throw new GitHubError(message);
      }
      // Bound streamed responses before retaining them in memory.
      const reader = response.body?.getReader();
      if (!reader) { throw new GitHubError('GitHub returned an empty response.'); }
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) { break; }
          size += value.byteLength;
          if (size > 4 * 1024 * 1024) { throw new GitHubError('GitHub response exceeds the 4 MB review limit.'); }
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      return Buffer.concat(chunks).toString('utf8');
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof GitHubError) { throw error; }
      throw new GitHubError('GitHub is unavailable or timed out. Local reviews still work.');
    }
  }
  private async json(path: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    try { return object(JSON.parse(await this.get(path, signal))); }
    catch (error) {
      signal?.throwIfAborted();
      if (error instanceof GitHubError) { throw error; }
      throw new GitHubError('GitHub returned an invalid response.');
    }
  }
  async requested(repository: GitHubRepository, signal?: AbortSignal): Promise<{ items: PullRequest[]; truncated: boolean }> {
    const items: PullRequest[] = [];
    let truncated = false;
    for (let page = 1; page <= 10; page++) {
      const query = `is:pr is:open review-requested:@me repo:${repository.owner}/${repository.name}`;
      const data = await this.json(`/search/issues?q=${encodeURIComponent(query)}&per_page=100&page=${page}`, signal);
      if (!Array.isArray(data.items)) { throw new GitHubError('GitHub returned an invalid PR list.'); }
      for (const value of data.items) {
        const item = object(value); const user = object(item.user);
        if (!Number.isSafeInteger(item.number) || Number(item.number) <= 0 || typeof item.title !== 'string' || typeof user.login !== 'string') {
          throw new GitHubError('GitHub returned an invalid PR list.');
        }
        items.push({ number: Number(item.number), title: redact(item.title).slice(0, 300), author: user.login.slice(0, 100) });
      }
      truncated ||= data.incomplete_results === true || Number(data.total_count) > 1000;
      if (data.items.length < 100 || items.length >= Number(data.total_count)) { break; }
    }
    return { items, truncated };
  }
  private path(repository: GitHubRepository, number: number): string {
    if (!Number.isSafeInteger(number) || number <= 0 || !/^[\w.-]+$/.test(repository.owner) || !/^[\w.-]+$/.test(repository.name)) { throw new GitHubError('Invalid pull request.'); }
    return `/repos/${repository.owner}/${repository.name}/pulls/${number}`;
  }
  async revision(repository: GitHubRepository, number: number, signal?: AbortSignal): Promise<PullRevision> {
    const data = await this.json(this.path(repository, number), signal);
    const head = object(data.head).sha; const base = object(data.base).sha;
    if (typeof head !== 'string' || typeof base !== 'string' || !/^[a-f0-9]{40,64}$/.test(head) || !/^[a-f0-9]{40,64}$/.test(base)
      || !Number.isSafeInteger(data.changed_files) || Number(data.changed_files) < 0) { throw new GitHubError('GitHub returned an invalid PR revision.'); }
    return { head, base, changedFiles: Number(data.changed_files) };
  }
  diff(repository: GitHubRepository, number: number, signal?: AbortSignal): Promise<string> {
    return this.get(this.path(repository, number), signal, true);
  }
}
