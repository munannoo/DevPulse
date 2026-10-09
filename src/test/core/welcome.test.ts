import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { getCommitsSince, git } from '../../core/git/repo';

test('welcome history is bounded, names authors and files, and rejects missing or unrelated saved revisions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'devpulse-welcome-'));
  try {
    for (const args of [['init'], ['config', 'user.name', 'Welcome Author'], ['config', 'user.email', 'test@example.invalid']]) { await git(root, args); }
    await writeFile(path.join(root, 'file.ts'), 'initial'); await git(root, ['add', 'file.ts']); await git(root, ['commit', '-m', 'initial']);
    const previous = (await git(root, ['rev-parse', 'HEAD'])).trim();
    await writeFile(path.join(root, 'file.ts'), 'changed'); await git(root, ['commit', '-am', 'fix logic']);
    const head = (await git(root, ['rev-parse', 'HEAD'])).trim();
    const result = await getCommitsSince(root, previous, head);
    assert.equal(result.count, 1); assert.match(result.metadata, /Welcome Author/); assert.match(result.metadata, /fix logic/); assert.match(result.metadata, /file.ts/);
    assert.equal((await getCommitsSince(root, head, head)).count, 0);
    await assert.rejects(getCommitsSince(root, '--all', head));
    await assert.rejects(getCommitsSince(root, '0'.repeat(40), head));
    await assert.rejects(getCommitsSince(root, head, previous));
  } finally {
    assert.equal(path.dirname(root), path.resolve(tmpdir())); assert.ok(path.basename(root).startsWith('devpulse-welcome-'));
    await rm(root, { recursive: true, force: true });
  }
});
