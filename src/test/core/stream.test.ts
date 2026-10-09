import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createLlm } from '../../core/llm/client';

test('chat streams redacted text, falls back on unsupported thinking and honors cancellation', async () => {
  const fake = 'sk_' + 'test_FAKEKEY0000000000';
  const received: string[] = [], published: string[] = [];
  const server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) { body += chunk; }
    received.push(body);
    const payload = JSON.parse(body);
    if (payload.reasoning_effort) { response.writeHead(422); response.end(); return; }
    response.setHeader('Content-Type', 'text/event-stream');
    for (const content of ['Hello\n', fake.slice(0, 8), fake.slice(8) + '\n', 'Done']) {
      response.write('data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n');
    }
    response.end('data: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const llm = createLlm({ baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'fixture-stream', jsonMode: true });
  try {
    const result = await llm.stream({ system: 'Help', user: fake, onText: text => published.push(text) });
    assert.equal(result, 'Hello\n<REDACTED_SECRET>\nDone');
    assert.ok(received.every(body => !body.includes(fake)));
    assert.ok(published.every(text => !text.includes(fake.slice(0, 8))));
    assert.ok(published.length >= 2);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(llm.stream({ system: 'Help', user: 'Hi', signal: controller.signal, onText: () => {} }), /cancelled/);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
