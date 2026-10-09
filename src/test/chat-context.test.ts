import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { readFile, writeFile } from 'node:fs/promises';
import { chatContext, insertChatReply } from '../vscode/assistant/context';

suite('Chat editor context', () => {
  test('context is opt-in and redacted; insertion preserves source and supports Undo', async function () {
    if (process.env.DEVPULSE_SECURITY_FIXTURE !== '1') { this.skip(); }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri; assert.ok(root);
    const uri = vscode.Uri.joinPath(root, 'chat-context.ts');
    const fake = 'sk_' + 'test_FAKEKEY0000000000';
    const source = `const value = "${fake}";\n`;
    await writeFile(uri.fsPath, source);
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    assert.equal(await chatContext(editor, false, false), '');
    await assert.rejects(chatContext(editor, false, true), /Select code/);
    editor.selection = new vscode.Selection(0, 0, 0, document.lineAt(0).text.length);
    const context = await chatContext(editor, false, true);
    assert.ok(context.includes('chat-context.ts:1')); assert.ok(!context.includes(fake));
    assert.equal(await insertChatReply(editor, 'Explanation only.'), false);
    assert.equal(await insertChatReply(editor, '```ts\n<REDACTED_SECRET>\n```'), false);
    assert.equal(await insertChatReply(editor, '```ts\n// inserted\n```'), true);
    assert.ok(document.getText().startsWith(source.trimEnd()));
    assert.equal(await readFile(uri.fsPath, 'utf8'), source);
    await vscode.commands.executeCommand('undo'); assert.equal(document.getText(), source);
  });
});
