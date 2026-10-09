import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../../core/git/repo';
import { stagedCommitInput, stagedFingerprint, validateCommitDraft } from '../../core/review/commit';

test('commit input reads only staging, redacts secrets, excludes private files and detects changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'devpulse-commit-'));
  try {
    await git(root, ['init']);
    await assert.rejects(stagedCommitInput(root), /Stage the changes/);
    const credential = 'sk_' + 'test_FAKEKEY0000000000';
    await writeFile(join(root, 'feature.ts'), `const value = "${credential}";\n`);
    await writeFile(join(root, '.env'), 'PRIVATE_CONFIG=never-send-me');
    await git(root, ['add', '--', 'feature.ts', '.env']);
    await writeFile(join(root, 'feature.ts'), '// unstaged marker\n');
    const input = await stagedCommitInput(root);
    assert.ok(input.content.includes('<REDACTED_SECRET>'));
    assert.ok(!input.content.includes(credential)); assert.ok(!input.content.includes('unstaged marker'));
    assert.ok(!input.content.includes('never-send-me')); assert.deepEqual(input.skipped, ['.env']);
    assert.equal(await stagedFingerprint(root), input.fingerprint);
    await git(root, ['add', '--', 'feature.ts']);
    assert.notEqual(await stagedFingerprint(root), input.fingerprint);
    await writeFile(join(root, 'feature.ts'), 'x'.repeat(25_000)); await git(root, ['add', '--', 'feature.ts']);
    await assert.rejects(stagedCommitInput(root), /24,000/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('commit drafts require bounded conventional titles and redact output', () => {
  const draft = { title: 'feat: add a helper', description: 'Add a helper.', analysis: 'Review edge cases; tests are unknown.' };
  assert.deepEqual(validateCommitDraft(draft), draft);
  for (const title of ['plain title', 'fix: first\nsecond', 'feat: ' + 'x'.repeat(72)]) {
    assert.throws(() => validateCommitDraft({ ...draft, title }));
  }
  assert.throws(() => validateCommitDraft({ ...draft, analysis: 'command:untrusted' }));
  assert.throws(() => validateCommitDraft({ ...draft, description: 'x'.repeat(1601) }));
  const credential = 'sk_' + 'test_FAKEKEY0000000000';
  assert.ok(!validateCommitDraft({ ...draft, analysis: credential }).analysis.includes(credential));
});
