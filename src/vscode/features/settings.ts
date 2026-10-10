import * as vscode from 'vscode';

export const settingsCommands = { open: 'devpulse.openSettings', setup: 'devpulse.openSetupGuide' } as const;

export function registerSettings(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand(settingsCommands.open, () =>
      vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`)),
    vscode.commands.registerCommand(settingsCommands.setup, () =>
      vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.joinPath(context.extensionUri, 'docs', 'ai-setup.md'))),
  );
}
