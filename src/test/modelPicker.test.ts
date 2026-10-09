import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { writeFile } from 'node:fs/promises';
import type { ChatState } from '../vscode/panel/messages';
import { InlineCompletionProvider } from '../vscode/assistant/inlineCompletion';

suite('Model selection in the Extension Host', () => {
  test('separate selections reach autocomplete and chat; unknown models and resets are safe', async function () {
    if (process.env.DEVPULSE_SECURITY_FIXTURE !== '1') { this.skip(); }
    const root = vscode.workspace.workspaceFolders![0].uri;
    const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'devpulse')!;
    await extension.activate();
    const uri = vscode.Uri.joinPath(root, 'model-choice.ts');
    await writeFile(uri.fsPath, 'function difference(a: number, b: number) {\n');
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    const position = document.positionAt(document.getText().length);
    editor.selection = new vscode.Selection(position, position);
    const settings = vscode.workspace.getConfiguration('devpulse.llm', root);
    const inline = vscode.workspace.getConfiguration('devpulse.assistant.inline', root);
    const oldModel = settings.inspect<string>('modelOverride')?.workspaceFolderValue;
    const oldInline = inline.inspect<string>('model')?.workspaceFolderValue;
    const oldEnabled = inline.inspect<boolean>('enabled')?.workspaceFolderValue;
    const output = vscode.window.createOutputChannel('Model fixture');
    const context = { extensionPath: extension.extensionPath, secrets: { get: async () => undefined } } as unknown as vscode.ExtensionContext;
    const provider = new InlineCompletionProvider(context, output);
    const api = extension.exports as { getReviewState(): { chat: ChatState } };
    const cancellation = new vscode.CancellationTokenSource();
    try {
      await vscode.commands.executeCommand('devpulse.selectModel', 'fixture-review');
      assert.equal(vscode.workspace.getConfiguration('devpulse.llm', root).get('modelOverride'), 'fixture-review');
      await vscode.commands.executeCommand('devpulse.selectInlineModel', 'fixture-small');
      assert.equal(vscode.workspace.getConfiguration('devpulse.assistant.inline', root).get('model'), 'fixture-small');
      await vscode.commands.executeCommand('devpulse.selectInlineModel', 'missing-model');
      assert.equal(vscode.workspace.getConfiguration('devpulse.assistant.inline', root).get('model'), 'fixture-small');
      await inline.update('enabled', true, vscode.ConfigurationTarget.WorkspaceFolder);
      const result = await provider.provideInlineCompletionItems(document, position,
        { triggerKind: vscode.InlineCompletionTriggerKind.Invoke, selectedCompletionInfo: undefined }, cancellation.token);
      assert.ok(String(result[0]?.insertText).includes('return a - b;'), 'Autocomplete uses its separate model');
      await vscode.commands.executeCommand('devpulse.chatSend', { type: 'chatSend', text: 'Explain subtraction.', includeFile: false, includeSelection: false });
      assert.ok(api.getReviewState().chat.messages.some(message => message.text.includes('Selected model answer.')), 'Chat uses editor selection over environment');
      await vscode.commands.executeCommand('devpulse.selectInlineModel', '');
      await vscode.commands.executeCommand('devpulse.selectModel', '');
      assert.equal(vscode.workspace.getConfiguration('devpulse.assistant.inline', root).get('model'), ''); assert.equal(vscode.workspace.getConfiguration('devpulse.llm', root).get('modelOverride'), '');
    } finally {
      cancellation.dispose(); provider.dispose(); output.dispose();
      await settings.update('modelOverride', oldModel, vscode.ConfigurationTarget.WorkspaceFolder);
      await inline.update('model', oldInline, vscode.ConfigurationTarget.WorkspaceFolder);
      await inline.update('enabled', oldEnabled, vscode.ConfigurationTarget.WorkspaceFolder);
    }
  });
});
