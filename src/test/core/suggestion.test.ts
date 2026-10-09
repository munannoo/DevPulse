import assert from 'node:assert/strict';
import { test } from 'node:test';
import { suggestionEdit } from '../../core/review/suggestion';
import { validateReview, type Finding } from '../../core/llm/schemas';

const finding: Finding = { file: 'app.ts', startLine: 2, endLine: 2, severity: 'warning',
  title: 'Handle failure', explanation: 'Handle the rejected request.', replacement: '  await safeFetch();' };
const fakeCredential = 'sk_' + 'test_FAKEKEY0000000000';

test('suggestion edits preserve surrounding lines and Windows EOL', () => {
  assert.equal(suggestionEdit('before\r\n  await fetch();\r\nafter\r\n', finding)?.proposed,
    'before\r\n  await safeFetch();\r\nafter\r\n');
  assert.equal(suggestionEdit('before\nold', { ...finding, replacement: 'new\n' })?.proposed, 'before\nnew');
  assert.equal(suggestionEdit('before\nold\nlast', { ...finding, endLine: 3, replacement: 'new' })?.proposed, 'before\nnew');
});

test('instructions, invalid ranges and secrets cannot become edits', () => {
  const source = 'before\nold\n';
  for (const item of [{ ...finding, replacement: undefined, suggestion: 'Add a catch.' },
    { ...finding, startLine: 0 }, { ...finding, endLine: 9 },
    { ...finding, replacement: '```ts\nnew\n```' },
    { ...finding, replacement: `const value = "${fakeCredential}";` },
    { ...finding, replacement: '<REDACTED_SECRET>' }]) {
    assert.equal(suggestionEdit(source, item), undefined);
  }
  assert.equal(suggestionEdit(`before\nconst value = "${fakeCredential}";`, finding), undefined);
});

test('schema preserves code indentation and withholds edits for clamped lines', () => {
  const input = { file: 'app.ts', content: '', lineCount: 3, changedRanges: [{ start: 2, end: 2 }] };
  assert.equal(validateReview({ findings: [finding] }, input).findings[0].replacement, finding.replacement);
  assert.equal(validateReview({ findings: [{ ...finding, endLine: 99 }] }, input).findings[0].replacement, undefined);
  assert.equal(validateReview({ findings: [{ ...finding, replacement: '<REDACTED_SECRET>' }] }, input).findings[0].replacement, undefined);
});
