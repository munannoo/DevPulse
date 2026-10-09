import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseGitHubRemote } from '../../core/github/repository';
import { GitHubClient } from '../../core/github/client';
import { PullReviewer, pullInputs } from '../../core/review/pullRequest';
import type { ReviewInput } from '../../core/git/diff';
import { createServer } from 'node:http';
import { once } from 'node:events';

const repository = { owner: 'team', name: 'project' };
const sha = 'a'.repeat(40); const base = 'b'.repeat(40);
const patch = 'diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -1,2 +1,2 @@\n old\n-old\n+new\n';
const config = { baseUrl: 'http://localhost:11434/v1', model: 'fixture', jsonMode: true };
function mock(handler: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch {
  return (async (url, init) => handler(String(url), init ?? {})) as typeof fetch;
}
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('repository parsing accepts GitHub remotes without leaking credentials to another host', () => {
  for (const url of ['https://github.com/team/project.git', 'git@github.com:team/project.git', 'ssh://git@github.com/team/project']) {
    assert.deepEqual(parseGitHubRemote(url), repository);
  }
  for (const url of ['https://github.com.evil.test/team/project', 'https://user:token@github.com/team/project', 'git@other.test:team/project', 'https://github.com/../project']) {
    assert.equal(parseGitHubRemote(url), undefined);
  }
});

test('PR diff parsing preserves destination coordinates and excludes private, binary and unsafe paths', () => {
  const diff = patch + patch.replaceAll('app.ts', '.env') + patch.replaceAll('app.ts', '../outside.ts')
    + 'diff --git a/image.png b/image.png\nBinary files differ\n'
    + 'diff --git a/deleted.ts b/deleted.ts\n--- a/deleted.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n'
    + patch.replaceAll('app.ts', 'new name.ts').replace('@@ -1,2 +1,2 @@', '@@ -1,2 +98,2 @@');
  const result = pullInputs(diff);
  assert.equal(result.files, 6); assert.equal(result.inputs.length, 2); assert.equal(result.skipped.length, 4);
  assert.equal(result.inputs[0].changedRanges?.[0].start, 2);
  assert.equal(result.inputs[1].file, 'new name.ts'); assert.equal(result.inputs[1].changedRanges?.[0].start, 99);
  assert.equal(pullInputs(patch + 'x'.repeat(24_000)).inputs.length, 0);
});

test('GitHub requests use authenticated read-only API calls, paginate and sanitize failures', async () => {
  let calls = 0;
  const client = new GitHubClient('fixture-token', mock((url, init) => {
    calls++;
    assert.ok(url.startsWith('https://api.github.com/search/issues?'));
    assert.ok(decodeURIComponent(url).includes('review-requested:@me repo:team/project'));
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer fixture-token');
    assert.equal(init.redirect, 'error'); assert.equal(init.method, undefined);
    return json({ total_count: 101, items: Array.from({ length: calls === 1 ? 100 : 1 }, (_, i) => ({ number: (calls - 1) * 100 + i + 1, title: '<script>text</script>', user: { login: 'reviewer' } })) });
  }));
  const list = await client.requested(repository);
  assert.equal(list.items.length, 101); assert.equal(calls, 2); assert.equal(list.truncated, false);
  for (const [status, message] of [[401, /sign-in expired/], [403, /rate limited/], [404, /unavailable/], [500, /Try again/]] as const) {
    await assert.rejects(new GitHubClient('fixture', mock(() => new Response('private token details', { status }))).requested(repository), message);
  }
  await assert.rejects(new GitHubClient('fixture', mock(() => { throw new Error('secret URL'); })).requested(repository), /GitHub is unavailable/);
  await assert.rejects(new GitHubClient('fixture', mock(() => new Response('not json'))).requested(repository), /invalid response/);
  await assert.rejects(new GitHubClient('fixture', mock(() => new Response('x'.repeat(4 * 1024 * 1024 + 1)))).diff(repository, 1), /4 MB/);
});

test('PR review reuses analysis, caches by revision and invalidates when head or base changes', async () => {
  let head = sha; let currentBase = base; let diffCalls = 0; let analyzed = 0;
  const client = new GitHubClient('fixture', mock((_url, init) => {
    if ((init.headers as Record<string, string>).Accept === 'application/vnd.github.diff') { diffCalls++; return new Response(patch); }
    return json({ head: { sha: head }, base: { sha: currentBase }, changed_files: 1 });
  }));
  const reviewer = new PullReviewer(async (input: ReviewInput) => {
    analyzed++; assert.equal(input.file, 'app.ts');
    return { summary: 'Updates behavior', findings: [{ file: input.file, startLine: 2, endLine: 2, severity: 'warning', title: 'Edge case', explanation: 'Check this path.' }] };
  });
  const run = () => reviewer.review(client, repository, 7, config, new AbortController().signal, () => {});
  const first = await run(); assert.equal(first.risk, 'warning'); assert.equal(first.head, sha);
  first.findings.length = 0;
  assert.equal((await run()).findings.length, 1); assert.equal(analyzed, 1); assert.equal(diffCalls, 1);
  head = 'c'.repeat(40); await run(); assert.equal(analyzed, 2);
  currentBase = 'd'.repeat(40); await run(); assert.equal(analyzed, 3);
});

test('PR review rejects racing/incomplete diffs, cancellation and failed analysis without caching', async () => {
  let metadata = 0;
  const racing = new GitHubClient('fixture', mock((_url, init) => {
    if ((init.headers as Record<string, string>).Accept === 'application/vnd.github.diff') { return new Response(patch); }
    return json({ head: { sha: ++metadata === 1 ? sha : base }, base: { sha: base }, changed_files: 1 });
  }));
  await assert.rejects(new PullReviewer().review(racing, repository, 1, config, new AbortController().signal, () => {}), /changed while fetching/);
  const incomplete = new GitHubClient('fixture', mock((_url, init) => (init.headers as Record<string, string>).Accept === 'application/vnd.github.diff'
    ? new Response(patch) : json({ head: { sha }, base: { sha: base }, changed_files: 2 })));
  await assert.rejects(new PullReviewer().review(incomplete, repository, 1, config, new AbortController().signal, () => {}), /incomplete PR diff/);
  const client = new GitHubClient('fixture', mock((_url, init) => (init.headers as Record<string, string>).Accept === 'application/vnd.github.diff'
    ? new Response(patch) : json({ head: { sha }, base: { sha: base }, changed_files: 1 })));
  let calls = 0;
  const reviewer = new PullReviewer(async () => { calls++; throw new Error('analysis failed'); });
  for (let i = 0; i < 2; i++) { await assert.rejects(reviewer.review(client, repository, 1, config, new AbortController().signal, () => {}), /analysis failed/); }
  assert.equal(calls, 2);
  const cancellation = new AbortController(); cancellation.abort();
  await assert.rejects(new PullReviewer().review(client, repository, 1, config, cancellation.signal, () => {}), /abort/i);
});

test('PR diff reaches the real shared engine redacted and validates changed-line findings', async () => {
  const fakeKey = 'sk_' + 'test_FAKEKEY0000000000';
  const secretPatch = patch.replace('+new', ['+const api', 'Key = "', fakeKey, '";'].join(''));
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      assert.ok(!body.includes('FAKEKEY')); assert.ok(body.includes('<REDACTED_SECRET>'));
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: 'Adds configuration', findings: [
        { file: 'app.ts', startLine: 2, endLine: 2, severity: 'security', title: 'Unsafe configuration', explanation: 'Check configuration.' },
        { file: 'app.ts', startLine: 1, endLine: 1, severity: 'warning', title: 'Unchanged line', explanation: 'Must be discarded.' },
      ] }) } }] }));
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const client = new GitHubClient('fixture', mock((_url, init) => (init.headers as Record<string, string>).Accept === 'application/vnd.github.diff'
    ? new Response(secretPatch) : json({ head: { sha }, base: { sha: base }, changed_files: 1 })));
  try {
    const result = await new PullReviewer().review(client, repository, 3, { ...config, baseUrl: `http://127.0.0.1:${address.port}/v1` }, new AbortController().signal, () => {});
    assert.equal(result.risk, 'security'); assert.equal(result.findings.length, 1); assert.equal(result.summaries[0].text, 'Adds configuration');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
