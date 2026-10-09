import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ping } from '../../core/llm/ping';

test('ping distinguishes installed, missing and unavailable models without exposing connection details', async () => {
  let status = 200;
  const server = createServer((request, response) => {
    assert.equal(request.url, '/v1/models'); assert.equal(request.headers.authorization, 'Bearer fixture');
    response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ data: [{ id: 'fixture-model' }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, model: 'fixture-model', apiKey: 'fixture', jsonMode: true };
  try {
    assert.equal((await ping(config)).modelFound, true);
    assert.equal((await ping({ ...config, model: 'missing' })).modelFound, false);
    status = 401;
    const denied = await ping(config); assert.equal(denied.reachable, true); assert.equal(denied.modelFound, undefined);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  assert.equal((await ping(config)).reachable, false);
});
