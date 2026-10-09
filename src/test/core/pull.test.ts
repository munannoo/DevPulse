import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { getBranchStatus, git, pullFastForward } from '../../core/git/repo';

test('pull fast-forwards clean branches and preserves dirty, diverged and untracked-upstream branches', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'devpulse-pull-'));
  const source = path.join(root, 'source'), remote = path.join(root, 'remote.git'), workspace = path.join(root, 'workspace');
  try {
    await mkdir(source); await git(root, ['init', '--bare', '-b', 'main', remote]); await git(source, ['init', '-b', 'main']);
    for (const args of [['config', 'user.name', 'Pull Test'], ['config', 'user.email', 'test@example.invalid']]) { await git(source, args); }
    await writeFile(path.join(source, 'file.ts'), 'initial'); await git(source, ['add', 'file.ts']); await git(source, ['commit', '-m', 'initial']);
    await git(source, ['remote', 'add', 'origin', remote]); await git(source, ['push', '-u', 'origin', 'main']); await git(root, ['clone', remote, workspace]);
    for (const args of [['config', 'user.name', 'Pull Test'], ['config', 'user.email', 'test@example.invalid']]) { await git(workspace, args); }
    await writeFile(path.join(source, 'file.ts'), 'remote update'); await git(source, ['commit', '-am', 'update']); await git(source, ['push']);
    const behind = await getBranchStatus(workspace, true); assert.equal(behind.behind, 1);
    await writeFile(path.join(workspace, 'file.ts'), 'unsaved work');
    await assert.rejects(pullFastForward(behind), /Commit or stash/);
    assert.equal((await git(workspace, ['rev-parse', 'HEAD'])).trim(), behind.head);
    await git(workspace, ['restore', 'file.ts']);
    await assert.rejects(pullFastForward(behind, undefined, () => { throw new Error('New unsaved edit'); }), /New unsaved edit/);
    assert.equal((await git(workspace, ['rev-parse', 'HEAD'])).trim(), behind.head);
    assert.equal(await pullFastForward(behind), true);
    const synced = await getBranchStatus(workspace, true); assert.equal(synced.behind, 0);
    assert.equal(await pullFastForward(synced), false);
    await writeFile(path.join(source, 'file.ts'), 'remote again'); await git(source, ['commit', '-am', 'remote again']); await git(source, ['push']);
    await writeFile(path.join(workspace, 'local.ts'), 'local'); await git(workspace, ['add', 'local.ts']); await git(workspace, ['commit', '-m', 'local']);
    const diverged = await getBranchStatus(workspace, true);
    await assert.rejects(pullFastForward(diverged), /diverged/);
    assert.equal((await git(workspace, ['rev-parse', 'HEAD'])).trim(), diverged.head);
    await git(workspace, ['checkout', '-b', 'no-upstream']);
    await assert.rejects(pullFastForward(await getBranchStatus(workspace, true)), /No upstream/);
  } finally {
    assert.equal(path.dirname(root), path.resolve(tmpdir())); assert.ok(path.basename(root).startsWith('devpulse-pull-'));
    await rm(root, { recursive: true, force: true });
  }
});
