import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { loadEditorConfig } from '../vscode/configuration';
import { readFile, writeFile, unlink } from 'node:fs/promises';

suite('DevPulse settings', () => {
  test('opens native settings and uses edited host settings when environment overrides are absent', async function () {
    if (process.env.DEVPULSE_SECURITY_FIXTURE !== '1') { this.skip(); return; }
    const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'devpulse'); assert.ok(extension);
    await extension.activate();
    assert.ok((await vscode.commands.getCommands()).includes('devpulse.openSettings'));
    assert.ok((await vscode.commands.getCommands()).includes('devpulse.openSetupGuide'));
    await vscode.commands.executeCommand('devpulse.openSetupGuide');
    const guide = vscode.Uri.joinPath(extension.extensionUri, 'docs', 'ai-setup.md');
    assert.ok((await vscode.workspace.openTextDocument(guide)).getText().includes('ollama pull gemma4:e2b'));
    await vscode.commands.executeCommand('devpulse.openSettings');
    const config = vscode.workspace.getConfiguration('devpulse.llm');
    const previous = config.inspect<string>('baseUrl')?.globalValue;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri; assert.ok(root);
    const envFile = vscode.Uri.joinPath(root, '.env').fsPath;
    const oldEnv = await readFile(envFile, 'utf8').catch(() => undefined);
    try {
      // Stop fixture lookup at its own workspace, not the developer's parent .env.
      await writeFile(envFile, '');
      await config.update('baseUrl', 'https://ai.example.com/v1', vscode.ConfigurationTarget.Global);
      const updated = vscode.workspace.getConfiguration('devpulse.llm', root);
      assert.equal(updated.get<string>('baseUrl'), 'https://ai.example.com/v1');
      const result = await loadEditorConfig({ scriptDirectory: extension.extensionPath, env: {}, settings: { baseUrl: updated.get<string>('baseUrl') } }, root);
      assert.equal(result.baseUrl, 'https://ai.example.com/v1');
    } finally {
      await config.update('baseUrl', previous, vscode.ConfigurationTarget.Global);
      if (oldEnv === undefined) { await unlink(envFile); } else { await writeFile(envFile, oldEnv); }
    }
  });
});
