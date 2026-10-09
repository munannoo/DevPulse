import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { writeFile } from 'node:fs/promises';
import { InlineCompletionProvider } from '../vscode/assistant/inlineCompletion';

suite('Inline autocomplete in the Extension Host', () => {
  test('opt-in suggestions support cancellation, private-file exclusion, stale edits and ghost-text acceptance', async function () {
    if (process.env.DEVPULSE_SECURITY_FIXTURE !== '1') { this.skip(); }
    const root = vscode.workspace.workspaceFolders![0].uri;
    const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'devpulse')!;
    await extension.activate();
    const output = vscode.window.createOutputChannel('Inline fixture');
    const context = { extensionPath: extension.extensionPath, secrets: { get: async () => undefined } } as unknown as vscode.ExtensionContext;
    const provider = new InlineCompletionProvider(context, output);
    const settings = vscode.workspace.getConfiguration('devpulse.assistant.inline');
    const previous = settings.inspect<boolean>('enabled')?.globalValue;
    const uri = vscode.Uri.joinPath(root, 'inline-fixture.ts');
    const source = 'function sum(a: number, b: number) {\n';
    await writeFile(uri.fsPath, source);
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    const position = document.positionAt(source.length);
    const select = () => { editor.selection = new vscode.Selection(position, position); };
    const request = (token: vscode.CancellationToken) => provider.provideInlineCompletionItems(document, position,
      { triggerKind: vscode.InlineCompletionTriggerKind.Invoke, selectedCompletionInfo: undefined }, token);
    const token = new vscode.CancellationTokenSource();
    try {
      await settings.update('enabled', false, vscode.ConfigurationTarget.Global); select();
      assert.equal((await request(token.token)).length, 0);
      await settings.update('enabled', true, vscode.ConfigurationTarget.Global);
      const result = await request(token.token);
      assert.equal(result.length, 1); assert.ok(String(result[0].insertText).includes('return a + b;'));
      assert.equal(document.getText(), source, 'Suggestions do not edit the file');
      token.cancel(); assert.equal((await request(token.token)).length, 0);
      const fresh = new vscode.CancellationTokenSource();
      const pending = request(fresh.token);
      await editor.edit(edit => edit.insert(position, '// changed'));
      assert.equal((await pending).length, 0); fresh.dispose();
      const privateUri = vscode.Uri.joinPath(root, '.env.inline-fixture');
      await writeFile(privateUri.fsPath, 'PRIVATE_FIXTURE=placeholder');
      const privateDocument = await vscode.workspace.openTextDocument(privateUri);
      const privateToken = new vscode.CancellationTokenSource();
      try { assert.equal((await provider.provideInlineCompletionItems(privateDocument, new vscode.Position(0, 0),
        { triggerKind: vscode.InlineCompletionTriggerKind.Invoke, selectedCompletionInfo: undefined }, privateToken.token)).length, 0); }
      finally { privateToken.dispose(); }
      await editor.edit(edit => edit.replace(new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), source)); select();
      await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
      await new Promise(resolve => setTimeout(resolve, 1500));
      await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
      assert.ok(document.getText().includes('return a + b;'), 'Registered provider renders an acceptable ghost completion');
      const pythonUri = vscode.Uri.joinPath(root, 'inline-fixture.py');
      await writeFile(pythonUri.fsPath, 'def add(a, b):\n    \n\ndef target_level(current):\n    return current\n');
      const pythonDocument = await vscode.workspace.openTextDocument(pythonUri);
      const pythonEditor = await vscode.window.showTextDocument(pythonDocument);
      pythonEditor.selection = new vscode.Selection(1, 4, 1, 4);
      await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
      await new Promise(resolve => setTimeout(resolve, 1500));
      await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
      assert.equal(pythonDocument.getText(), 'def add(a, b):\n    return a + b\n\ndef target_level(current):\n    return current\n',
        'Python ghost suggestions remove echoed signatures and preserve exact indentation and following code');
      provider.dispose();
      const messages: string[] = [];
      const logger = { appendLine: (message: string) => messages.push(message) } as unknown as vscode.OutputChannel;
      const timeoutProvider = new InlineCompletionProvider(context, logger);
      const timeoutToken = new vscode.CancellationTokenSource();
      const slowUri = vscode.Uri.joinPath(root, 'inline-timeout.ts');
      await writeFile(slowUri.fsPath, '// __hold_inline__\nfunction slow() {\n');
      const slowDocument = await vscode.workspace.openTextDocument(slowUri);
      const slowEditor = await vscode.window.showTextDocument(slowDocument);
      const slowPosition = slowDocument.positionAt(slowDocument.getText().length);
      slowEditor.selection = new vscode.Selection(slowPosition, slowPosition);
      try {
        assert.equal((await timeoutProvider.provideInlineCompletionItems(slowDocument, slowPosition,
          { triggerKind: vscode.InlineCompletionTriggerKind.Invoke, selectedCompletionInfo: undefined }, timeoutToken.token)).length, 0);
        assert.ok(messages.some(message => message.includes('timed out after 8 seconds')), 'Slow inference is reported without source or endpoint details');
      } finally { timeoutProvider.dispose(); timeoutToken.dispose(); }
    } finally { token.dispose(); provider.dispose(); output.dispose(); await settings.update('enabled', previous, vscode.ConfigurationTarget.Global); }
  });
});
