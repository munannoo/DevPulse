import * as vscode from 'vscode';
import { loadConfig, type ConfigOptions, type LlmConfig } from '../core/llm/config';

// Installed extensions live outside the user's project. Resolve its .env from
// the relevant workspace while keeping the shared environment/settings order.
export function loadEditorConfig(options: ConfigOptions, resource = vscode.window.activeTextEditor?.document.uri): Promise<LlmConfig> {
  const folder = resource ? vscode.workspace.getWorkspaceFolder(resource) : undefined;
  const workspace = folder ?? vscode.workspace.workspaceFolders?.[0];
  return loadConfig({ ...options, scriptDirectory: vscode.workspace.isTrusted && workspace?.uri.scheme === 'file'
    ? workspace.uri.fsPath : options.scriptDirectory });
}
