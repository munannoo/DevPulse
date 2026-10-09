import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '../core/git/repo';
import { installHook } from '../core/git/hook';
import { Attention } from '../vscode/features/attention';

suite('Attention reminders in the Extension Host', () => {
  test('old work, missing guard and requested PRs update without reload and clear after resolution', async function () {
    if (process.env.DEVPULSE_SECURITY_FIXTURE !== '1') { this.skip(); }
    const root = join(vscode.workspace.workspaceFolders![0].uri.fsPath, 'attention-fixture');
    await mkdir(root); await git(root, ['init']); await writeFile(join(root, 'work.ts'), '// work\n');
    const state = new Map<string, unknown>([[`devpulse.dirtySince:${root}`, Date.now() - 2 * 86400_000]]);
    const context = { workspaceState: { get: (key: string) => state.get(key), update: async (key: string, value: unknown) => { state.set(key, value); } } } as unknown as vscode.ExtensionContext;
    const output = vscode.window.createOutputChannel('Attention fixture');
    let shielded = true;
    const attention = new Attention(context, output, () => shielded);
    const waitFor = async (count: number) => {
      const deadline = Date.now() + 5000;
      while (attention.getState().length !== count && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 25)); }
      assert.equal(attention.getState().length, count);
    };
    try {
      attention.observe(root, 2); await waitFor(3);
      assert.deepEqual(attention.getState().map(item => item.id), ['hook', 'prs', 'uncommitted']);
      await installHook(root, join(root, 'fixture-cli.js'));
      await git(root, ['add', '.']);
      await git(root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=', 'commit', '-m', 'fixture']);
      attention.observe(root, 0); await waitFor(0); assert.equal(state.get(`devpulse.dirtySince:${root}`), undefined);
      shielded = false; attention.flush();
    } finally { attention.dispose(); output.dispose(); }
  });
});
