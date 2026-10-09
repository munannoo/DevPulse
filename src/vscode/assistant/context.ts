import * as vscode from 'vscode';
import { relative } from 'node:path';
import { safeFile, isSensitiveFile } from '../../core/git/diff';
import { redact } from '../../core/security/redact';
export class ChatContextError extends Error {}

export async function chatContext(editor: vscode.TextEditor | undefined, includeFile: boolean, includeSelection: boolean): Promise<string> {
  if (!includeFile && !includeSelection) { return ''; }
  if (!editor || editor.document.uri.scheme !== 'file' || editor.document.isClosed) { throw new ChatContextError('Open a workspace file to include context.'); }
  const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!folder) { throw new ChatContextError('Choose a file inside this workspace.'); }
  const file = relative(folder.uri.fsPath, editor.document.uri.fsPath).replace(/\\/g, '/');
  if (isSensitiveFile(file)) { throw new ChatContextError('Private environment and key files are excluded from chat.'); }
  try { await safeFile(folder.uri.fsPath, file); } catch { throw new ChatContextError('Chat context must stay inside the workspace.'); }
  const parts: string[] = [];
  if (includeFile) {
    const text = editor.document.getText();
    if (text.length > 24_000) { throw new ChatContextError('This file is too large for chat. Include a selection instead.'); }
    parts.push(`Current file: ${file}\n${text}`);
  }
  if (includeSelection) {
    if (editor.selection.isEmpty) { throw new ChatContextError('Select code before including a selection.'); }
    const text = editor.document.getText(editor.selection);
    if (text.length > 12_000) { throw new ChatContextError('Selection is too large. Choose a smaller section.'); }
    parts.push(`Selection: ${file}:${editor.selection.start.line + 1}\n${text}`);
  }
  return redact(parts.join('\n\n'));
}

export async function insertChatReply(editor: vscode.TextEditor | undefined, text: string): Promise<boolean> {
  if (!vscode.workspace.isTrusted || !editor || editor.document.isClosed || editor.document.uri.scheme !== 'file'
    || !vscode.workspace.getWorkspaceFolder(editor.document.uri) || isSensitiveFile(editor.document.fileName)) { return false; }
  const blocks = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(match => match[1].replace(/\r?\n$/, ''));
  if (!blocks.length) { return false; }
  const choice = blocks.length === 1 ? blocks[0] : (await vscode.window.showQuickPick(
    blocks.map((code, index) => ({ label: `Code block ${index + 1}`, description: code.split('\n')[0].slice(0, 80), code })),
    { placeHolder: 'Choose code to insert' }))?.code;
  if (!choice || choice.includes('<REDACTED_SECRET>') || redact(choice) !== choice || editor.document.isClosed) { return false; }
  const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri)!;
  await safeFile(folder.uri.fsPath, relative(folder.uri.fsPath, editor.document.uri.fsPath));
  const edit = new vscode.WorkspaceEdit(); edit.insert(editor.document.uri, editor.selection.active, choice);
  return vscode.workspace.applyEdit(edit);
}
