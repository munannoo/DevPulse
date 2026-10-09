import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { chunkReview, ReviewLimitError } from '../../core/review/chunks';

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
