import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attentionItems } from '../../core/git/reminders';

test('attention is deterministic and waits for old work rather than nagging on new edits', () => {
  const state = { dirty: true, hookInstalled: false };
  assert.deepEqual(attentionItems(state, 0, 60_000, 2, 3).map(item => item.id), ['hook', 'prs']);
  assert.deepEqual(attentionItems(state, 0, 120_000, 2, 3).map(item => item.id), ['hook', 'prs', 'uncommitted']);
  assert.deepEqual(attentionItems({ dirty: false, hookInstalled: true }, 0, 120_000, 2, 0), []);
});
