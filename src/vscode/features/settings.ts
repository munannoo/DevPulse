import * as vscode from 'vscode';

export const settingsCommands = { open: 'devpulse.openSettings' } as const;

export function registerSettings(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand(settingsCommands.open, () =>
    vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`));
}
