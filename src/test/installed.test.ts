import assert from 'node:assert/strict';
import { relative, isAbsolute } from 'node:path';
import { access } from 'node:fs/promises';
import * as vscode from 'vscode';

suite('Installed VSIX', () => {
  test('activates the packaged bundle and contributed commands', async function () {
    const directory = process.env.DEVPULSE_INSTALLED_FIXTURE; if (!directory) { this.skip(); return; }
    const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'devpulse');
    assert.ok(extension, 'packaged extension is installed');
    const location = relative(directory, extension.extensionPath);
    assert.ok(location && !location.startsWith('..') && !isAbsolute(location), 'uses installed bundle');
    await access(vscode.Uri.joinPath(extension.extensionUri, 'dist/cli.js').fsPath);
    await extension.activate(); assert.ok(extension.isActive);
    const commands = await vscode.commands.getCommands(true);
    for (const command of ['devpulse.refreshAttention', 'devpulse.refreshPullRequests', 'devpulse.installPrecommitAiHook', 'devpulse.disablePrecommitAi', 'devpulse.generateCommitDescription', 'devpulse.toggleInlineCompletion']) {
      assert.ok(commands.includes(command), `${command} registered`);
    }
    await vscode.commands.executeCommand('devpulse.openPanel');
    await vscode.commands.executeCommand('devpulse.security.focus');
  });
});
