import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { writeFile } from 'node:fs/promises';
import type { ReviewState } from '../vscode/panel/messages';

suite('Chat in the Extension Host', () => {
  test('selection chat streams a reply, rejects invalid input and cancels a pending response', async function () {
    if (process.env.DEVPULSE_SECURITY_FIXTURE !== '1') { this.skip(); }
    const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'devpulse'); assert.ok(extension);
    const api = await extension.activate() as { getReviewState(): ReviewState };
    const root = vscode.workspace.workspaceFolders?.[0]?.uri; assert.ok(root);
    const uri = vscode.Uri.joinPath(root, 'chat-qa.ts'); await writeFile(uri.fsPath, 'export const value = 1;\n');
    const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
    editor.selection = new vscode.Selection(0, 0, 0, 23);
    await vscode.commands.executeCommand('devpulse.chatSend', { type: 'chatSend', text: 'Explain this selection.', includeFile: false, includeSelection: true });
    const state = api.getReviewState().chat; assert.ok(state);
    assert.equal(state.busy, false); assert.equal(state.offline, false);
    const reply = state.messages.at(-1); assert.equal(reply?.complete, true); assert.match(reply?.text ?? '', /fixture reply/);
    await vscode.commands.executeCommand('devpulse.chatSend', { type: 'chatSend', text: 'x'.repeat(8001), includeFile: false, includeSelection: false });
    assert.equal(api.getReviewState().chat?.messages.length, state.messages.length);
    const pending = vscode.commands.executeCommand('devpulse.chatSend', { type: 'chatSend', text: '__hold_chat__', includeFile: false, includeSelection: false });
    const deadline = Date.now() + 5000;
    while (!api.getReviewState().chat?.busy && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 20)); }
    await new Promise(resolve => setTimeout(resolve, 100));
    await vscode.commands.executeCommand('devpulse.chatCancel'); await pending;
    assert.equal(api.getReviewState().chat?.busy, false); assert.match(api.getReviewState().chat?.status ?? '', /cancelled/);
    assert.ok(api.getReviewState().focus);
  });
});
