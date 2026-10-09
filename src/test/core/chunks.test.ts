import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { chunkReview, ReviewLimitError } from '../../core/review/chunks';
import { analyze } from '../../core/review/analyze';
import { createServer } from 'node:http';
import { once } from 'node:events';

test('large code is reviewed in bounded parts preserving selection coordinates', () => {
  const content = Array.from({ length: 60 }, (_, index) => `const value${index} = ${index};`).join('\n');
  const chunks = chunkReview({ file: 'large.ts', content, lineCount: 200, changedRanges: [{ start: 101, end: 160 }], kind: 'code', sourceHash: 'snapshot' }, 400);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.content.length <= 400 && chunk.sourceHash === 'snapshot'));
  assert.ok(chunks[0].content.includes('101: const value0'));
  assert.ok(chunks.at(-1)?.content.includes('160: const value59'));
  assert.ok(chunks.every(chunk => chunk.changedRanges!.every(range => range.start >= 101 && range.end <= 160)));
});

test('large diff parts preserve destination lines and removal anchors', () => {
  const content = 'diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -90,1 +90,40 @@\n-old code\n' +
    Array.from({ length: 40 }, (_, index) => `+const value${index} = ${index};`).join('\n');
  const chunks = chunkReview({ file: 'app.ts', content, lineCount: 200, changedRanges: [{ start: 90, end: 129 }], kind: 'diff' }, 400);
  assert.ok(chunks.length > 1);
  assert.ok(chunks[0].content.includes('90: -old code\n90: +const value0'));
  assert.ok(chunks.at(-1)?.content.includes('129: +const value39'));
  assert.ok(chunks.every(chunk => chunk.content.length <= 400));
});

test('chunking refuses an oversized line instead of truncating code', () => {
  assert.throws(() => chunkReview({ file: 'x.ts', content: 'x'.repeat(600), lineCount: 1 }, 400), ReviewLimitError);
});

test('analysis sends bounded redacted chunks and preserves lines after multiline credentials', async () => {
  const lines = [
    ...Array.from({ length: 700 }, (_, index) => `+const before${index} = ${index};`),
    '+-----BEGIN PRIVATE KEY-----',
    ...Array.from({ length: 500 }, () => '+FAKE_PRIVATE_BODY_FOR_REDACTION_TEST'),
    '+-----END PRIVATE KEY-----',
    ...Array.from({ length: 700 }, (_, index) => `+const after${index} = ${index};`),
  ];
  const content = `diff --git a/large.ts b/large.ts\n--- a/large.ts\n+++ b/large.ts\n@@ -0,0 +1,${lines.length} @@\n${lines.join('\n')}`;
  const payloads: string[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      payloads.push(body);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: 'A bounded part was reviewed.', findings: [
        { file: 'large.ts', startLine: lines.length, endLine: lines.length, severity: 'warning', title: 'Tail finding', explanation: 'The final line has an issue.' },
      ] }) } }] }));
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const parts: number[] = [];
  try {
    const result = await analyze({ file: 'large.ts', content, kind: 'diff', lineCount: lines.length, changedRanges: [{ start: 1, end: lines.length }] },
      { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'chunk-fixture', jsonMode: true }, undefined, part => parts.push(part));
    assert.ok(payloads.length > 1);
    assert.ok(payloads.every(body => !body.includes('FAKE_PRIVATE_BODY')));
    assert.ok(payloads.some(body => body.includes(`${lines.length}: +const after699`)));
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].startLine, lines.length);
    assert.deepEqual(parts, Array.from({ length: parts.length }, (_, index) => index + 1));
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
