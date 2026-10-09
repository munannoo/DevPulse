import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createLlm } from '../../core/llm/client';
import { reviewResponseSchema, validateReview } from '../../core/llm/schemas';

test('structured review falls back through unsupported controls and schema while preserving JSON mode', async () => {
  const formats: string[] = [];
  let calls = 0;
  const server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) { body += chunk; }
    const payload = JSON.parse(body); calls++;
    formats.push(payload.response_format?.type);
    if (payload.reasoning_effort || payload.response_format?.type === 'json_schema') {
      response.writeHead(422); response.end(); return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: '{"summary":"No risk.","findings":[]}' } }] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const input = { file: 'app.py', content: '', lineCount: 3 };
  try {
    const llm = createLlm({ baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'fixture-schema', jsonMode: true });
    const request = { system: 'Review', user: 'Fixture', responseSchema: reviewResponseSchema(input),
      json: (value: unknown) => validateReview(value, input) };
    assert.equal((await llm.chat(request)).findings.length, 0);
    assert.deepEqual(formats, ['json_schema', 'json_schema', 'json_object']);
    await llm.chat(request); assert.equal(calls, 3);
    await llm.chat({ ...request, responseSchema: undefined });
    assert.equal(calls, 5, 'schema is part of the cache identity');
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('server failures retry once within the existing deadline and keep private errors out of messages', async () => {
  let calls = 0; let fail = false;
  const server = createServer((_request, response) => {
    calls++;
    if (fail || calls === 1) { response.writeHead(500); response.end('private server diagnostics'); return; }
    response.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const llm = createLlm({ baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'retry-fixture', jsonMode: true });
  const request = { system: 'JSON only', user: 'Recover', json: (value: unknown) => value };
  try {
    assert.deepEqual(await llm.chat(request), { ok: true }); assert.equal(calls, 2);
    fail = true; calls = 0;
    await assert.rejects(llm.chat({ ...request, user: 'Fail' }), (error: unknown) => {
      assert.ok(error instanceof Error); assert.match(error.message, /server.*HTTP 500/);
      assert.ok(!error.message.includes('private')); assert.ok(!error.message.includes('authentication')); return true;
    });
    assert.equal(calls, 2);
    calls = 0;
    await assert.rejects(llm.chat({ ...request, user: 'Deadline', timeoutMs: 50 }), /timed out/);
    assert.equal(calls, 1, 'The retry delay must respect the original deadline');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
