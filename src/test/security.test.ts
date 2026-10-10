import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import * as path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { git } from '../core/git/repo';
import { verifyStaged } from '../core/security/precommit';
import { planFix } from '../core/security/autofix';
import { applySecretFix } from '../vscode/features/applySecretFix';

suite('Pre-commit security in Extension Host', () => {
  test('launches, renders diagnostics, applies WorkspaceEdit and allows commit', async function () {
    if (process.env.DEVPULSE_SECURITY_FIXTURE !== '1') { this.skip(); }
    const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    assert.ok(root);
    assert.ok(path.basename(root).startsWith('.security-check-'), 'Use the disposable security fixture runner.');
    const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'devpulse');
    assert.ok(extension);
    await extension.activate();
    assert.ok(extension.isActive);
    await vscode.commands.executeCommand('devpulse.security.focus');
    await vscode.commands.executeCommand('devpulse.installPrecommitHook');
    const hook = await readFile(path.join(root, '.git', 'hooks', 'pre-commit'), 'utf8');
    assert.ok(!/Code\.exe/i.test(hook), 'hook must use standalone Node, not the Electron extension host');
    const file = path.join(root, 'config.ts');
    const fake = 'sk_test_' + 'FAKEKEY0000000000';
    await writeFile(file, `const apiKey = "${fake}";\n`);
    await git(root, ['add', 'config.ts']);
    await assert.rejects(git(root, ['commit', '-m', 'blocked']));
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('devpulse.verifyStaged');
    const deadline = Date.now() + 5000;
    while (!vscode.languages.getDiagnostics(document.uri).some(item => item.source === 'DevPulse') && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(vscode.languages.getDiagnostics(document.uri).some(item => item.source === 'DevPulse'));
    const scan = await verifyStaged(root);
    assert.equal(scan.findings.length, 1);
    const plan = await planFix(root, scan.findings[0].id);
    assert.equal(plan.preview.includes(fake), false);
    // Consent is supplied by the test; production calls this after the preview dialog.
    await applySecretFix(root, plan);
    assert.equal(await readFile(file, 'utf8'), 'const apiKey = process.env.API_KEY;\n');
    assert.equal(document.isDirty, false);
    assert.equal((await verifyStaged(root)).findings.length, 0);
    await vscode.commands.executeCommand('devpulse.verifyStaged');
    assert.equal(vscode.languages.getDiagnostics(document.uri).filter(item => item.source === 'DevPulse').length, 0);
    assert.equal((await git(root, ['ls-files', '--', '.env'])).trim(), '');
    await git(root, ['commit', '-m', 'fixed through editor']);
  });
});
