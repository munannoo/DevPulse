import * as vscode from 'vscode';
import { readFile } from 'node:fs/promises';
import type { Finding } from '../../core/llm/schemas';
import type { BranchStatus } from '../../core/git/repo';
import { getBranchStatus } from '../../core/git/repo';
import { safeFile, isSensitiveFile } from '../../core/git/diff';
import { contentHash } from '../../core/llm/cache';
import { redact } from '../../core/security/redact';
import { suggestionEdit } from '../../core/review/suggestion';

type Preview = { before: string; after: string; language: string };

async function confirmSuggestion(preview: Preview): Promise<boolean> {
  const before = await vscode.workspace.openTextDocument({ content: preview.before, language: preview.language });
  const after = await vscode.workspace.openTextDocument({ content: preview.after, language: preview.language });
  await vscode.commands.executeCommand('vscode.diff', before.uri, after.uri, 'DevPulse suggestion preview');
  return await vscode.window.showInformationMessage('Apply this suggestion? Review the diff first.',
    { modal: true }, 'Apply suggestion') === 'Apply suggestion';
}

/** Confirmation is separate so Extension Host tests can exercise the same edit and stale checks. */
export async function applySuggestion(finding: Finding, branch: BranchStatus, hash: string,
  isCurrent: () => boolean, confirm: (preview: Preview) => Promise<boolean> = confirmSuggestion): Promise<boolean> {
  if (!vscode.workspace.isTrusted || isSensitiveFile(finding.file)) { return false; }
  const uri = vscode.Uri.file(await safeFile(branch.root, finding.file));
  const document = await vscode.workspace.openTextDocument(uri);
  const version = document.version;
  const current = async () => {
    const status = await getBranchStatus(branch.root, false);
    const disk = await readFile(await safeFile(branch.root, finding.file), 'utf8');
    return isCurrent() && !document.isClosed && !document.isDirty && document.version === version
      && status.head === branch.head && status.branch === branch.branch
      && contentHash(document.getText()) === hash && contentHash(disk) === hash;
  };
  if (!await current()) { return false; }
  const edit = suggestionEdit(document.getText(), finding);
  if (!edit || !await confirm({ before: redact(document.getText()), after: redact(edit.proposed), language: document.languageId })) { return false; }
  if (!await current()) { return false; }
  const changes = new vscode.WorkspaceEdit();
  changes.replace(uri, new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)), edit.replacement);
  // Leave saving and staging to the user; the text edit participates in normal Undo.
  return vscode.workspace.applyEdit(changes);
}
