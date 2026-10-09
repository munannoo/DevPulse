import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeChatText, streamEvents } from '../../core/llm/sse';

test('SSE handles byte fragments, Unicode, comments, CRLF and multiline data', async () => {
  const data = new TextEncoder().encode(': heartbeat\r\n\r\ndata: {"text":\r\ndata: "héllo"}\r\n\r\ndata: [DONE]\n\n');
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of data) { controller.enqueue(Uint8Array.of(byte)); }
    controller.close();
  } });
  const events: string[] = [];
  for await (const item of streamEvents(new Response(stream))) { events.push(item); }
  assert.deepEqual(events, ['{"text":\n"héllo"}']);
  await assert.rejects(async () => { for await (const _item of streamEvents(new Response('data: {}\n\n'))) { /* Consume. */ } }, /before completion/);
  await assert.rejects(async () => { for await (const _item of streamEvents(new Response('data: ' + 'x'.repeat(70_000)))) { /* Consume. */ } }, /size limit/);
});

test('streamed text withholds incomplete credentials, redacts complete lines and hides reasoning', () => {
  const fake = 'sk_' + 'test_FAKEKEY0000000000';
  assert.equal(safeChatText('Hello\n' + fake.slice(0, 10)), 'Hello\n');
  assert.ok(!safeChatText('Hello\n' + fake + '\n').includes('FAKEKEY'));
  assert.equal(safeChatText('<think>private reasoning\n'), '');
  assert.equal(safeChatText('<think>private</think>Answer', true), 'Answer');
});
