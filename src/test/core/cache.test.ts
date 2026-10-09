import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { clearCached, getCached, setCached } from '../../core/llm/cache';
import { createLlm } from '../../core/llm/client';
import { requestQueue } from '../../core/llm/queue';

test('cache expires, refreshes recently used entries and bounds memory', t => {
  clearCached(); let now = 1000; t.mock.method(Date, 'now', () => now);
  setCached('expires', 'value', 10); now += 10; assert.equal(getCached('expires'), undefined);
  for (let i = 0; i < 64; i++) { setCached(String(i), 'value'); }
  getCached('0'); setCached('new', 'value');
  assert.equal(getCached('0'), 'value'); assert.equal(getCached('1'), undefined);
  clearCached(); setCached('large', 'x'.repeat(1_100_000)); setCached('second', 'x'.repeat(1_100_000));
  assert.equal(getCached('large'), undefined); assert.ok(getCached('second'));
  setCached('oversized', 'x'.repeat(2_100_000)); assert.equal(getCached('oversized'), undefined); clearCached();
});

test('warm completions and validated reviews bypass busy inference; changed models miss cache', async () => {
  clearCached(); let calls = 0;
  const server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) { body += chunk; } calls++;
    const payload = JSON.parse(body) as { response_format?: unknown };
    response.end(JSON.stringify({ choices: [{ message: { content: payload.response_format ? '{"ok":true}' : 'return 1;' } }] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const config = { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'fixture', jsonMode: true };
  const llm = createLlm(config);
  const request = { system: 'fixture', user: 'cached input' };
  const json = (value: unknown) => { assert.deepEqual(value, { ok: true }); return value; };
  let release: () => void = () => {};
  let blocked: Promise<void> | undefined;
  try {
    await llm.complete(request); await llm.chat({ ...request, json }); assert.equal(calls, 2);
    blocked = requestQueue.run(() => new Promise<void>(resolve => { release = resolve; }), new AbortController().signal);
    assert.equal(await llm.complete({ ...request, timeoutMs: 50 }), 'return 1;');
    assert.deepEqual(await llm.chat({ ...request, json, timeoutMs: 50 }), { ok: true }); assert.equal(calls, 2);
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(llm.complete({ ...request, signal: cancelled.signal }), /cancelled/);
    release(); await blocked;
    await llm.complete({ ...request, model: 'different' }); assert.equal(calls, 3);
    await llm.complete({ ...request, user: 'changed input' }); assert.equal(calls, 4);
    clearCached(); await llm.complete(request); assert.equal(calls, 5);
  } finally { release(); await blocked; clearCached(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
