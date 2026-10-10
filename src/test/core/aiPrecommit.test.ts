import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reviewStagedRisks } from '../../core/security/aiPrecommit';
import { git } from '../../core/git/repo';
import { installHook } from '../../core/git/hook';

const diff = (source: string) => `diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -0,0 +1 @@\n+${source}\n`;
test('AI guard uses redacted staged input, shared validation, bounded cancellation and fail-open errors', async () => {
  const payloads: string[] = [];
  const server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) { body += chunk; } payloads.push(body);
    if (body.includes('slow_fixture')) { return; }
    if (body.includes('failure_fixture')) { response.writeHead(503); response.end('private server error'); return; }
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: 'Runtime risk.', findings: [{ file: 'app.ts', startLine: 1, endLine: 1,
      severity: 'warning', title: 'Unhandled network failure', explanation: 'Handle rejected network requests.' }] }) } }] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const config = { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'fixture', jsonMode: true };
  try {
    const credential = 'sk_' + 'test_FAKEKEY0000000000';
    const result = await reviewStagedRisks(diff(`fetch("${credential}")`), config);
    assert.equal(result.findings.length, 1); assert.ok(!payloads[0].includes(credential));
    assert.ok(payloads[0].includes('high-confidence fatal risks'));
    const slow = await reviewStagedRisks(diff('slow_fixture()'), config, undefined, 50);
    assert.equal(slow.findings.length, 0); assert.match(slow.warning!, /budget/);
    const unavailable = await reviewStagedRisks(diff('failure_fixture()'), config);
    assert.equal(unavailable.findings.length, 0); assert.match(unavailable.warning!, /unavailable/);
    assert.ok(!unavailable.warning!.includes('private server error'));
    const controller = new AbortController(); controller.abort();
    assert.equal((await reviewStagedRisks(diff('cancelled()'), config, controller.signal)).findings.length, 0);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('optional AI hook mode preserves existing hook chains and can be disabled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'devpulse-ai-hook-'));
  try {
    await git(root, ['init']);
    const hook = join(root, '.git/hooks/pre-commit');
    await writeFile(hook, '#!/bin/sh\nexit 0\n');
    await installHook(root, join(root, 'cli.js'), true);
    assert.match(await readFile(hook, 'utf8'), /precommit --ai/);
    const original = await readFile(hook, 'utf8');
    await writeFile(hook, original.replace(/^.+ precommit --ai \|\| exit \$\?$/m, "'C:/broken/Code.exe' 'C:/old/cli.js' precommit --ai || exit $?"));
    await installHook(root, join(root, 'cli.js'));
    assert.equal(await readFile(hook, 'utf8'), original, 'reinstallation repairs Electron runtime while preserving AI mode and chaining');
    await installHook(root, join(root, 'cli.js'), false);
    assert.ok(!(await readFile(hook, 'utf8')).includes('precommit --ai'));
    assert.equal(await readFile(hook + '.devpulse-backup', 'utf8'), '#!/bin/sh\nexit 0\n');
  } finally { await rm(root, { recursive: true, force: true }); }
});
