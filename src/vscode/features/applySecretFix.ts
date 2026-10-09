import * as vscode from 'vscode';
import * as path from 'node:path';
import { FixPlan, validatePlan, stageFix, safeFile } from '../../core/security/autofix';

// Called only after preview consent. Shared with Extension Host acceptance tests.
export async function applySecretFix(root: string, plan: FixPlan): Promise<void> {
  await validatePlan(root, plan);
  const changes = [[plan.file, plan.replacement, plan.original], ['.env', plan.env, plan.originalEnv], ['.gitignore', plan.ignore, plan.originalIgnore]];
  const edit = new vscode.WorkspaceEdit();
  for (const [file, content, original] of changes) {
    const uri = vscode.Uri.file(path.join(root, file));
    let exists = true;
    try { await vscode.workspace.fs.stat(uri); } catch (error) {
      if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') { throw error; }
      exists = false;
      edit.createFile(uri, { overwrite: false });
    }
    let range = new vscode.Range(0, 0, 0, 0);
    if (exists) {
      await safeFile(root, file);
      const document = await vscode.workspace.openTextDocument(uri);
      if (document.isDirty || document.getText() !== original) { throw new Error('Files changed while previewing. Scan and preview again.'); }
      range = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
    }
    edit.replace(uri, range, content);
  }
  if (!await vscode.workspace.applyEdit(edit)) { throw new Error('Could not apply edit.'); }
  for (const [file] of changes) {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, file)));
    if (!await document.save()) { throw new Error('Could not save fix.'); }
  }
  await stageFix(root, plan);
}
