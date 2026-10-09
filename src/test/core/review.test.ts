import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redact } from '../../core/security/redact';
import { loadConfig } from '../../core/llm/config';
import { createLlm } from '../../core/llm/client';
import { RequestQueue } from '../../core/llm/queue';
import { validateReview } from '../../core/llm/schemas';
import { changedRanges, collectChanges } from '../../core/git/diff';
import { git, getBranchStatus } from '../../core/git/repo';

async function temporary<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'devpulse-test-'));
  try { return await run(directory); }
  finally {
    assert.ok(directory.startsWith(join(tmpdir(), 'devpulse-test-')));
    await rm(directory, { recursive: true, force: true });
  }
}

test('redaction removes secrets, credentials and multiline keys while preserving line counts', () => {
  const raw = 'const apiKey = "sk_test_FAKEKEY0000000000";\npostgres://user:password@host/db\n-----BEGIN PRIVATE KEY-----\nabc\ndef\n-----END PRIVATE KEY-----';
  const output = redact(raw);
  assert.ok(!output.includes('FAKEKEY') && !output.includes('password') && !output.includes('abc'));
  assert.equal(output.split('\n').length, raw.split('\n').length);
  assert.ok(output.includes('<REDACTED_SECRET>'));
  for (const value of ['sk-' + 'FAKE0000000000000000', 'AIza' + 'FAKE0000000000000000000000000000']) {
    assert.equal(redact(`const value = "${value}";`).includes(value), false);
  }
  assert.equal(redact('const appKey = "fake-generic-key";').includes('fake-generic-key'), false);
});

test('config resolves each value from env, nearest dotenv, settings, then defaults', async () => temporary(async directory => {
  await mkdir(join(directory, 'dist'));
  await writeFile(join(directory, '.env'), 'DEVPULSE_LLM_MODEL="fixture-model" # note\nDEVPULSE_LLM_API_KEY=fixture-token\n');
  const config = await loadConfig({ scriptDirectory: join(directory, 'dist'), env: { DEVPULSE_LLM_MODEL: 'override' }, settings: { baseUrl: 'http://localhost:1234/v1' } });
  assert.equal(config.model, 'override');
  assert.equal(config.apiKey, 'fixture-token');
  assert.equal(config.baseUrl, 'http://localhost:1234/v1');
  const fallback = await loadConfig({ scriptDirectory: directory, env: {} });
  assert.equal(fallback.model, 'fixture-model');
  const origin = await loadConfig({ scriptDirectory: directory, env: { DEVPULSE_LLM_BASE_URL: 'http://localhost:1234/' } });
  assert.equal(origin.baseUrl, 'http://localhost:1234/v1');
  const custom = await loadConfig({ scriptDirectory: directory, env: { DEVPULSE_LLM_BASE_URL: 'http://localhost:1234/custom/v1/' } });
  assert.equal(custom.baseUrl, 'http://localhost:1234/custom/v1');
  await assert.rejects(loadConfig({ scriptDirectory: directory, env: { DEVPULSE_LLM_BASE_URL: 'file:///tmp' } }));
}));

test('finding validation rejects untrusted paths and severities, clamps lines, filters unchanged lines', () => {
  const input = { file: 'app.ts', content: '', lineCount: 5, changedRanges: [{ start: 5, end: 5 }] };
  const finding = { file: 'app.ts', startLine: 200, endLine: 300, severity: 'warning', title: 'Bug', explanation: 'An edge case fails.' };
  const result = validateReview({ summary: 'Change summary', findings: [finding] }, input);
  assert.equal(result.findings[0].startLine, 5);
  assert.equal(result.findings[0].endLine, 5);
  assert.throws(() => validateReview({ findings: [{ ...finding, file: '../outside.ts' }] }, input));
  assert.throws(() => validateReview({ findings: [{ ...finding, severity: 'fatal' }] }, input));
  assert.equal(validateReview({ findings: [{ ...finding, startLine: 2 }] }, input).findings.length, 0);
  assert.deepEqual(changedRanges('@@ -1,2 +1,2 @@\n old\n-old\n+new', 2), [{ start: 2, end: 2 }]);
  assert.deepEqual(changedRanges('@@ -8 +7,0 @@\n-old', 7), [{ start: 7, end: 7 }]);
});

test('Git fetch detects behind; review collects saved staged, unstaged and new files', async () => temporary(async directory => {
  const remote = join(directory, 'remote.git');
  const local = join(directory, 'local');
  const peer = join(directory, 'peer');
  await git(directory, ['init', '--bare', remote]);
  await git(directory, ['clone', remote, local]);
  await git(local, ['checkout', '-b', 'main']);
  await writeFile(join(local, 'app.ts'), 'export const value = 1;\n');
  await git(local, ['add', '.']);
  await git(local, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'initial']);
  await git(local, ['push', '-u', 'origin', 'main']);
  await git(directory, ['clone', '--branch', 'main', remote, peer]);
  await writeFile(join(peer, 'remote.ts'), 'export {};\n');
  await git(peer, ['add', '.']);
  await git(peer, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'remote change']);
  await git(peer, ['push']);
  const status = await getBranchStatus(local, true);
  assert.equal(status.behind, 1); assert.equal(status.ahead, 0); assert.equal(status.fresh, true);
  await writeFile(join(local, 'app.ts'), 'export const value = 2;\n');
  await git(local, ['add', 'app.ts']);
  await writeFile(join(local, 'app.ts'), 'export const value = 3;\n');
  await writeFile(join(local, 'new file.ts'), 'export const added = true;\n');
  await writeFile(join(local, '.env'), 'SECRET=fixture\n');
  const changes = await collectChanges(local, true);
  assert.deepEqual(changes.inputs.map(input => input.file).sort(), ['app.ts', 'new file.ts']);
  assert.ok(changes.inputs.find(input => input.file === 'app.ts')?.content.includes('+export const value = 3;'));
  assert.ok(changes.skipped.some(file => file.startsWith('.env:')));
  for (let index = 0; index < 3; index++) {
    await writeFile(join(local, `large${index}.ts`), 'const largeValue = 1;\n'.repeat(2500));
  }
  const largeChanges = await collectChanges(local, true);
  assert.equal(largeChanges.inputs.filter(input => input.file.startsWith('large')).length, 3);
  assert.ok(!largeChanges.skipped.some(file => file.includes('review size limit')));
  for (let index = 0; index < 25; index++) {
    await writeFile(join(local, `extra${index}.ts`), 'export const extra = true;\n');
  }
  const manyChanges = await collectChanges(local, true);
  assert.equal(manyChanges.inputs.filter(input => input.file.startsWith('extra')).length, 25);
  assert.ok(!manyChanges.skipped.some(file => file.includes('20-file limit')));
  await git(local, ['remote', 'set-url', 'origin', join(directory, 'missing.git')]);
  const offline = await getBranchStatus(local, true);
  assert.equal(offline.fresh, false); assert.equal(offline.behind, 1);
  await git(local, ['branch', '--unset-upstream']);
  assert.equal((await getBranchStatus(local, true)).upstream, undefined);
}));

test('LLM HTTP flow redacts, repairs JSON once, supports servers without JSON mode, caches, and times out', async () => {
  let calls = 0;
  const payloads: string[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      calls++; payloads.push(body);
      assert.equal(request.headers.authorization, 'Bearer fixture-token');
      if (JSON.parse(body).response_format) { response.writeHead(400); response.end(); return; }
      const content = calls === 3 ? 'invalid JSON' : '<think>reasoning</think>{"findings":[]}';
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const llm = createLlm({ baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'fixture', apiKey: 'fixture-token', jsonMode: true });
  const request = { system: 'Review', user: 'const apiKey = "sk_test_FAKEKEY0000000000";', json: (value: unknown) => validateReview(value, { file: 'app.ts', content: '', lineCount: 1 }) };
  try {
    assert.deepEqual((await llm.chat(request)).findings, []);
    assert.equal(calls, 4);
    assert.ok(payloads.every(body => !body.includes('FAKEKEY')));
    assert.ok(payloads[0].includes('response_format'));
    assert.ok(payloads[1].includes('response_format'));
    assert.ok(!payloads[2].includes('response_format'));
    assert.equal(JSON.parse(payloads[0]).reasoning_effort, 'none');
    assert.equal(JSON.parse(payloads[0]).chat_template_kwargs.enable_thinking, false);
    assert.ok(!payloads[1].includes('reasoning_effort'));
    await llm.chat(request); assert.equal(calls, 4);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  const hanging = createServer(() => { /* The abort must end this response. */ });
  hanging.listen(0, '127.0.0.1'); await once(hanging, 'listening');
  const hangingAddress = hanging.address(); assert.ok(hangingAddress && typeof hangingAddress !== 'string');
  try {
    await assert.rejects(createLlm({ baseUrl: `http://127.0.0.1:${hangingAddress.port}/v1`, model: 'fixture', jsonMode: true }).chat({ ...request, timeoutMs: 40 }), /timed out/);
  } finally { hanging.closeAllConnections(); await new Promise<void>(resolve => hanging.close(() => resolve())); }
});

test('queued requests cancel immediately without disturbing the active request', async () => {
  const queue = new RequestQueue();
  let finish!: () => void;
  const first = queue.run(() => new Promise<void>(resolve => { finish = resolve; }), new AbortController().signal);
  const cancellation = new AbortController();
  const second = queue.run(async () => assert.fail('Cancelled work ran'), cancellation.signal);
  cancellation.abort();
  await assert.rejects(second, /cancelled/); finish(); await first;
});

test('LLM route and authentication errors are fatal configuration failures without retry', async () => {
  let calls = 0;
  const server = createServer((_request, response) => { calls++; response.writeHead(404); response.end('private server details'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    const llm = createLlm({ baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'missing', jsonMode: true });
    await assert.rejects(llm.chat({ system: 'JSON only', user: 'ping', json: value => value }), (error: unknown) => {
      assert.ok(error instanceof Error && 'configuration' in error && error.configuration === true);
      assert.ok(!error.message.includes('private server details'));
      return true;
    });
    assert.equal(calls, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
