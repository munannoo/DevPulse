import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { readFile, writeFile } from 'node:fs/promises';
import { getBranchStatus } from '../core/git/repo';
import { contentHash } from '../core/llm/cache';
import type { Finding } from '../core/llm/schemas';
import { applySuggestion } from '../vscode/features/applySuggestion';

suite('Suggestion edits in the Extension Host', () => {
  test('preview, cancellation, stale edits and Undo preserve user control', async function () {
    if (process.env.DEVPULSE_SECURITY_FIXTURE !== '1') { this.skip(); }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(root);
    const uri = vscode.Uri.joinPath(vscode.Uri.file(root), 'suggestion.ts');
    const source = 'const value = 1;\r\nconsole.log(value);\r\n';
    await writeFile(uri.fsPath, source);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    const branch = await getBranchStatus(root, false);
    const finding: Finding = { file: 'suggestion.ts', startLine: 1, endLine: 1, severity: 'warning',
      title: 'Update value', explanation: 'Use the corrected value.', replacement: 'const value = 2;' };
    const hash = contentHash(source);
    let previews = 0;
    assert.equal(await applySuggestion(finding, branch, hash, () => true, async preview => {
      previews++;
      assert.equal(preview.before, source);
      assert.equal(preview.after, source.replace('= 1', '= 2'));
      return false;
    }), false);
    assert.equal(previews, 1);
    assert.equal(document.getText(), source);
    assert.equal(await applySuggestion(finding, branch, hash, () => true, async () => {
      await writeFile(uri.fsPath, source.replace('= 1', '= 3'));
      return true;
    }), false, 'external edits during preview must be rejected');
    await writeFile(uri.fsPath, source);
    await vscode.commands.executeCommand('workbench.action.files.revert');
    assert.equal(await applySuggestion(finding, branch, hash, () => false, async () => {
      assert.fail('Stale finding reached confirmation');
    }), false);
    assert.equal(await applySuggestion(finding, branch, hash, () => true, async () => true), true);
    assert.equal(document.getText(), source.replace('= 1', '= 2'));
    assert.equal(await readFile(uri.fsPath, 'utf8'), source, 'suggestions must not auto-save');
    await vscode.commands.executeCommand('undo');
    assert.equal(document.getText(), source);
  });
});
