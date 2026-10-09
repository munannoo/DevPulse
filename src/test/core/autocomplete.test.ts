import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createLlm, cleanCompletionText } from '../../core/llm/client';
import { autocompletePrompt } from '../../core/llm/prompts';
import { completionContext, stripCompletionPrefix } from '../../core/llm/completion';

test('completion context redacts before slicing, excludes a cursor in a secret, and bounds input', () => {
  const credential = 'sk_' + 'test_FAKEKEY0000000000';
  const source = credential + ' '.repeat(1490) + '\nfunction sum(a, b) {';
  const context = completionContext(source, source.length)!;
  assert.ok(context.prefix.length <= 1500); assert.ok(!context.prefix.includes('FAKEKEY'));
  assert.equal(completionContext(credential, 10), undefined);
  assert.equal(completionContext('x'.repeat(4000), 2000)?.suffix.length, 500);
  assert.equal(cleanCompletionText('Here is the code:\n```ts\n  return a + b;\n```\nExplanation'), '  return a + b;');
  assert.equal(cleanCompletionText('<think>unfinished reasoning'), '');
  assert.equal(cleanCompletionText('Here is a suggestion: use a loop.'), '');
  assert.equal(cleanCompletionText(credential), '');
  assert.equal(cleanCompletionText('<REDACTED_SECRET>'), '');
});

test('cleanCompletionText strips think blocks and markdown code fences', () => {
  const withThink = '<think>I should complete this function.</think>return a + b;';
  assert.equal(cleanCompletionText(withThink), 'return a + b;');

  const withFences = '```typescript\nconst result = true;\n```';
  assert.equal(cleanCompletionText(withFences), 'const result = true;');

  const plain = '  console.log("hello");';
  assert.equal(cleanCompletionText(plain), '  console.log("hello");');
});

test('createLlm complete performs low-temp completion with caching and redaction', async () => {
  let calls = 0;
  const payloads: string[] = [];
  const server = createServer((request, response) => {
    calls++;
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      payloads.push(body);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        choices: [{ message: { content: 'return x * 2;\n' } }],
      }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const llm = createLlm({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: 'gemma4:e4b',
    apiKey: 'secret-token',
    jsonMode: false,
  });

  try {
    const result = await llm.complete({
      system: autocompletePrompt,
      user: 'const token = "sk_test_FAKEKEY0000000000";\nfunction double(x) { ',
      model: 'gemma4:e2b',
      maxTokens: 64,
      timeoutMs: 4000,
    });

    assert.equal(result, 'return x * 2;');
    assert.equal(calls, 1);
    // Secret must be redacted in payload sent over HTTP
    assert.ok(!payloads[0].includes('FAKEKEY'));
    assert.ok(payloads[0].includes('<REDACTED_SECRET>'));
    assert.ok(payloads[0].includes('gemma4:e2b'));

    // Second identical request must hit cache and NOT invoke server again
    const cachedResult = await llm.complete({
      system: autocompletePrompt,
      user: 'const token = "sk_test_FAKEKEY0000000000";\nfunction double(x) { ',
      model: 'gemma4:e2b',
      maxTokens: 64,
    });
    assert.equal(cachedResult, 'return x * 2;');
    assert.equal(calls, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});


test('completion insertion strips echoed Python context and cursor indentation', () => {
  const prefix = 'from dataclasses import dataclass\n\ndef add(a,b):\n    ';
  assert.equal(stripCompletionPrefix('def add(a,b):\n    return a + b', prefix), 'return a + b');
  assert.equal(stripCompletionPrefix('    return a + b', prefix), 'return a + b');
  assert.equal(stripCompletionPrefix('        return a + b', prefix), '    return a + b');
  assert.equal(stripCompletionPrefix('return a + b', prefix), 'return a + b');
  assert.equal(stripCompletionPrefix('def add(a,b):\n    return a + b', prefix.replace(/\n/g, '\r\n')), 'return a + b');
  assert.equal(stripCompletionPrefix('  return a + b;', 'function sum(a, b) {\n'), '  return a + b;');
});
