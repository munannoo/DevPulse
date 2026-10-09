import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { listModels } from '../../core/llm/models';
import { loadConfig } from '../../core/llm/config';
import { clearCached } from '../../core/llm/cache';

test('model catalog validates IDs, deduplicates, sanitizes errors and honors cancellation', async () => {
  let fail = false, calls = 0;
  const server = createServer((_request, response) => {
    calls++;
    if (fail) { response.writeHead(500); response.end('private server details'); return; }
    response.end(JSON.stringify({ data: [{ id: 'gemma4:e2b' }, { id: 'gemma4:e2b' }, { id: 'gemma4:12b' }, { id: '<script>' }, { id: 123 }] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const config = { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'fixture', jsonMode: true };
  try {
    assert.deepEqual(await listModels(config), ['gemma4:12b', 'gemma4:e2b']);
    assert.deepEqual(await listModels(config), ['gemma4:12b', 'gemma4:e2b']); assert.equal(calls, 1);
    clearCached();
    fail = true; await assert.rejects(listModels(config), /HTTP 500/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(listModels(config, controller.signal), /cancelled/);
    const common = { env: { DEVPULSE_LLM_MODEL: 'environment-model' } };
    assert.equal((await loadConfig(common)).model, 'environment-model');
    assert.equal((await loadConfig({ ...common, settings: { modelOverride: 'chosen-model' } })).model, 'chosen-model');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
