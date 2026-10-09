import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { writeFile } from 'node:fs/promises';
import type { ReviewState } from '../vscode/panel/messages';

suite('Highlights in the Extension Host', () => {
  test('Review My Changes reviews more than twenty files', async function () {
    if (process.env.DEVPULSE_SECURITY_FIXTURE !== '1') { this.skip(); }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root);
    for (let index = 0; index < 25; index++) {
      await writeFile(vscode.Uri.joinPath(root, `many${index}.ts`).fsPath, 'export const value = 1;\n');
    }
    const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'devpulse');
    assert.ok(extension);
    const api = await extension.activate() as { getReviewState(): ReviewState };
    await vscode.commands.executeCommand('devpulse.reviewChanges');
    const state = api.getReviewState();
    assert.equal(state.phase, 'complete', state.message);
    assert.equal(state.summaries.filter(item => /^many\d+\.ts$/.test(item.file)).length, 25);
    assert.ok(!state.skipped.some(item => item.includes('20-file limit')));
  });
  test('Analyze File renders three severities, trusted own action, and invalidates old IDs', async function () {
    if (process.env.DEVPULSE_SECURITY_FIXTURE !== '1') { this.skip(); }
    const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'devpulse');
    assert.ok(extension);
    const api = await extension.activate() as { getReviewState(): ReviewState };
    const deadline = Date.now() + 20_000;
    while (api.getReviewState().phase === 'checking' && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root);
    const uri = vscode.Uri.joinPath(root, 'highlight.ts');
    await writeFile(uri.fsPath, 'const value = 1;\nvoid fetch("/fixture");\nexport {};\n');
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('devpulse.analyzeFile');
    const state = api.getReviewState();
    assert.equal(state.phase, 'complete', state.message);
    assert.deepEqual(state.findings.map(item => item.severity).sort(), ['context', 'security', 'warning']);
    assert.equal(vscode.languages.getDiagnostics(uri).filter(item => item.source === 'DevPulse').length, 3);
    const finding = state.findings.find(item => item.suggestionId);
    assert.ok(finding?.suggestionId);
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, new vscode.Position(0, 0));
    const markdown = hovers?.flatMap(hover => hover.contents).find(item =>
      item instanceof vscode.MarkdownString && item.value.includes('command:devpulse.applySuggestion')) as vscode.MarkdownString | undefined;
    assert.ok(markdown);
    assert.deepEqual(markdown.isTrusted, { enabledCommands: ['devpulse.applySuggestion'] });
    const edit = new vscode.WorkspaceEdit(); edit.insert(uri, new vscode.Position(0, 0), '// changed\n');
    await vscode.workspace.applyEdit(edit);
    const staleDeadline = Date.now() + 2000;
    while (api.getReviewState().findings.length && Date.now() < staleDeadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(api.getReviewState().findings.length, 0);
    assert.equal(vscode.languages.getDiagnostics(uri).filter(item => item.source === 'DevPulse').length, 0);
    const changed = document.getText();
    await vscode.commands.executeCommand('devpulse.applySuggestion', finding.suggestionId);
    assert.equal(document.getText(), changed);
    await vscode.commands.executeCommand('workbench.action.files.revert');
  });
});
