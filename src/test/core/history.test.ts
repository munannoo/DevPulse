import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../../core/git/repo';
import { recentFileCommits } from '../../core/git/history';

test('hover history returns real bounded authors and excludes unrelated files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'devpulse-history-'));
  try {
    await git(root, ['init']);
    await git(root, ['config', 'user.name', 'Fixture Author']);
    await git(root, ['config', 'user.email', 'fixture@example.invalid']);
    await writeFile(join(root, 'app.ts'), 'export {};\n');
    await git(root, ['add', '--', 'app.ts']); await git(root, ['commit', '-m', 'Add app']);
    const commits = await recentFileCommits(root, 'app.ts');
    assert.equal(commits.length, 1); assert.equal(commits[0].author, 'Fixture Author');
    assert.equal(commits[0].subject, 'Add app'); assert.match(commits[0].hash, /^[a-f0-9]{7,40}$/);
    await writeFile(join(root, 'new.ts'), 'export {};\n');
    assert.deepEqual(await recentFileCommits(root, 'new.ts'), []);
    await assert.rejects(recentFileCommits(root, '../outside.ts'));
    const cancellation = new AbortController(); cancellation.abort();
    await assert.rejects(recentFileCommits(root, 'app.ts', cancellation.signal));
  } finally {
    assert.ok(root.startsWith(join(tmpdir(), 'devpulse-history-')));
    await rm(root, { recursive: true, force: true });
  }
});
