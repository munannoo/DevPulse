import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '../core/git/repo';

suite('AI pre-commit guard in the Extension Host', () => {
  test('AI risks block and render; slow AI never blocks; regex protection stays enabled', async function () {
    if (process.env.DEVPULSE_SECURITY_FIXTURE !== '1') { this.skip(); }
    const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'devpulse')!; await extension.activate();
    await git(root, ['reset']);
    const file = join(root, 'ai-guard.ts'); await writeFile(file, 'fetch("fixture");\n');
    const document = await vscode.workspace.openTextDocument(file); await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('devpulse.installPrecommitAiHook');
    assert.match(await readFile(join(root, '.git/hooks/pre-commit'), 'utf8'), /precommit --ai/);
    await git(root, ['add', '--', 'ai-guard.ts']);
    await assert.rejects(git(root, ['commit', '-m', 'AI risk blocked'], undefined, 20_000));
    const deadline = Date.now() + 5000;
    while (!vscode.languages.getDiagnostics(document.uri).some(item => item.message.includes('rejected network')) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(vscode.languages.getDiagnostics(document.uri).some(item => item.message.includes('rejected network')));
    await writeFile(file, '// __hold_ai__\n'); await vscode.commands.executeCommand('workbench.action.files.revert');
    await git(root, ['add', '--', 'ai-guard.ts']);
    await git(root, ['commit', '-m', 'slow AI is optional'], undefined, 20_000);
    await vscode.commands.executeCommand('devpulse.disablePrecommitAi');
    assert.ok(!(await readFile(join(root, '.git/hooks/pre-commit'), 'utf8')).includes('precommit --ai'));
    const fake = 'sk_test_' + 'FAKEKEY0000000000'; await writeFile(file, `const value = "${fake}";\n`);
    await git(root, ['add', '--', 'ai-guard.ts']);
    await assert.rejects(git(root, ['commit', '-m', 'regex remains active']));
    await git(root, ['reset']);
  });
});
