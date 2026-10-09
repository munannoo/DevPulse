import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { writeFile } from 'node:fs/promises';
import { git } from '../core/git/repo';

suite('Commit drafts in the Extension Host', () => {
  test('staged changes produce an editable draft; repetition reuses cache and clearing forces analysis', async function () {
    if (process.env.DEVPULSE_SECURITY_FIXTURE !== '1') { this.skip(); }
    const root = vscode.workspace.workspaceFolders![0].uri;
    const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'devpulse')!;
    await extension.activate();
    const uri = vscode.Uri.joinPath(root, 'commit-helper.ts');
    await writeFile(uri.fsPath, 'export const helper = () => 1;\n');
    await git(root.fsPath, ['reset']); await git(root.fsPath, ['add', '--', 'commit-helper.ts']);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
    const staged = await git(root.fsPath, ['diff', '--cached']);
    const head = await git(root.fsPath, ['rev-parse', 'HEAD']);
    const calls = async () => {
      const response = await fetch(`${process.env.DEVPULSE_LLM_BASE_URL}/fixture-commit-calls`, { signal: AbortSignal.timeout(2000) });
      return (await response.json() as { calls: number }).calls;
    };
    await vscode.commands.executeCommand('devpulse.clearAiCache');
    await vscode.commands.executeCommand('devpulse.generateCommitDescription');
    const document = vscode.window.activeTextEditor!.document;
    assert.equal(document.uri.scheme, 'untitled'); assert.equal(document.languageId, 'plaintext');
    assert.ok(document.getText().includes('feat: add staged helper')); assert.ok(document.getText().includes('ANALYSIS'));
    assert.ok(document.getText().includes('Verification: not run by this command.'));
    assert.equal(await calls(), 1);
    await vscode.commands.executeCommand('devpulse.generateCommitDescription'); assert.equal(await calls(), 1);
    await vscode.commands.executeCommand('devpulse.clearAiCache');
    await vscode.commands.executeCommand('devpulse.generateCommitDescription'); assert.equal(await calls(), 2);
    assert.equal(await git(root.fsPath, ['diff', '--cached']), staged);
    assert.equal(await git(root.fsPath, ['rev-parse', 'HEAD']), head);
  });
});
