import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { writeFile } from 'node:fs/promises';
import type { ReviewState } from '../vscode/panel/messages';
import { Focus } from '../vscode/features/focus';

suite('Focus in the Extension Host', () => {
  test('starts tracking on activation before an editor event', () => {
    const output = vscode.window.createOutputChannel('Focus startup fixture');
    const focus = new Focus({ globalState: { get: () => undefined, update: async () => {} } } as unknown as vscode.ExtensionContext, output);
    try {
      assert.equal(focus.getState().active, vscode.window.state.focused);
      assert.equal(focus.getState().inFlow, false);
    } finally { focus.dispose(); output.dispose(); }
  });
  test('editor activity updates focus and file switches update the daily count', async function () {
    if (process.env.DEVPULSE_SECURITY_FIXTURE !== '1') { this.skip(); }
    const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'devpulse'); assert.ok(extension);
    const api = await extension.activate() as { getReviewState(): ReviewState };
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri; assert.ok(folder);
    const first = vscode.Uri.joinPath(folder, 'focus-first.ts'), second = vscode.Uri.joinPath(folder, 'focus-second.ts');
    await writeFile(first.fsPath, 'export {};\n'); await writeFile(second.fsPath, 'export {};\n');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(first));
    await new Promise(resolve => setTimeout(resolve, 100));
    const before = api.getReviewState().focus; assert.ok(before);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(second));
    await new Promise(resolve => setTimeout(resolve, 100));
    const after = api.getReviewState().focus; assert.ok(after);
    if (vscode.window.state.focused) {
      assert.equal(after.active, true); assert.ok(after.milliseconds > before.milliseconds);
      assert.ok(after.switches > before.switches);
    } else { assert.equal(after.active, false); }
    assert.equal(after.inFlow, false);
  });
});
