import * as vscode from 'vscode';
import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import { repository, gitPath } from '../../core/git/repo';
import { installHook } from '../../core/git/hook';
import { verifyStaged } from '../../core/security/precommit';
import { planFix, safeFile } from '../../core/security/autofix';
import { applySecretFix } from './applySecretFix';
import { SecretFinding } from '../../core/security/secretScan';
import { PanelProvider } from '../panel/PanelProvider';

export function registerPrecommit(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('DevPulse');
  let root = '';
  let findings: SecretFinding[] = [];
  let scanning = false;
  let pending = false;
  let fixing = false;
  const decoration = vscode.window.createTextEditorDecorationType({
    gutterIconPath: vscode.Uri.joinPath(context.extensionUri, 'media', 'icons', 'security.svg'),
    gutterIconSize: 'contain', isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('inputValidation.errorBackground'),
    overviewRulerColor: new vscode.ThemeColor('editorError.foreground'),
  });
  const diagnostics = vscode.languages.createDiagnosticCollection('DevPulse Security');
  const panel = new PanelProvider(context, message => {
    if (message.type === 'scan') { void run(scan); }
    if (message.type === 'install') { void run(install); }
    if (message.type === 'fix') { void run(() => fix(message.id)); }
  });
  context.subscriptions.push(output, decoration, diagnostics,
    vscode.window.registerWebviewViewProvider('devpulse.security', panel));

  function paint(): void {
    diagnostics.clear();
    if (!root) { return; }
    for (const editor of vscode.window.visibleTextEditors) {
      const items = findings.filter(item => path.resolve(root, item.file) === editor.document.uri.fsPath && !editor.document.isDirty);
      editor.setDecorations(decoration, items.map(item => new vscode.Range(Math.min(item.startLine - 1, editor.document.lineCount - 1), 0, Math.min(item.startLine - 1, editor.document.lineCount - 1), 0)));
    }
    for (const item of findings) {
      const uri = vscode.Uri.file(path.join(root, item.file));
      const document = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === uri.fsPath);
      if (document?.isDirty) { continue; }
      const line = Math.min(item.startLine - 1, (document?.lineCount ?? item.startLine) - 1);
      const diagnostic = new vscode.Diagnostic(new vscode.Range(line, 0, line, 0), item.explanation, vscode.DiagnosticSeverity.Error);
      diagnostic.source = 'DevPulse';
      diagnostics.set(uri, [...(diagnostics.get(uri) ?? []), diagnostic]);
    }
  }

  function show(message?: string): void {
    panel.update({ type: 'security', findings, message: message ?? (findings.length ? `${findings.length} possible credential(s). Commit blocked.` : 'All clear. No secrets found in staged additions.') });
    paint();
  }

  async function run(action: () => Promise<void>): Promise<void> {
    try { await action(); } catch (error) {
      output.appendLine('Security operation failed; check the repository, saved files and staging state.');
      // Only our own known errors are surfaced. Filesystem/Git errors can include sensitive data.
      const message = error instanceof Error && /^(This file has unstaged|\.gitignore has unstaged|Untrack \.env|Files changed while|Scan again\.|The source changed|Symlink fixes)/.test(error.message)
        ? error.message : 'Security check unavailable. Check Git and file permissions, then retry.';
      show(message);
      await vscode.window.showWarningMessage(message);
    }
  }

  async function requireRoot(): Promise<string> {
    if (!root) {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder || folder.uri.scheme !== 'file') { throw new Error('Open a local Git workspace.'); }
      root = await repository(folder.uri.fsPath);
    }
    return root;
  }

  async function scan(): Promise<void> {
    if (scanning || fixing) { pending = true; return; }
    scanning = true;
    try { findings = (await verifyStaged(await requireRoot())).findings; show(); }
    finally { scanning = false; if (pending && !fixing) { pending = false; void run(scan); } }
  }

  async function install(): Promise<void> {
    await installHook(await requireRoot(), vscode.Uri.joinPath(context.extensionUri, 'dist', 'cli.js').fsPath);
    show('Pre-commit guard installed. Staged secrets will block commits.');
  }

  async function fix(id: string): Promise<void> {
    if (fixing) { return; }
    fixing = true;
    try {
      const base = await requireRoot();
      const plan = await planFix(base, id);
      const files = [plan.file, '.env', '.gitignore'];
      const dirty = () => vscode.workspace.textDocuments.some(doc => files.some(file => path.join(base, file) === doc.uri.fsPath) && doc.isDirty);
      if (dirty()) { throw new Error('This file has unstaged or unsaved edits. Save and stage them separately before fixing.'); }
      const preview = await vscode.workspace.openTextDocument({ content: plan.preview, language: 'diff' });
      await vscode.window.showTextDocument(preview, { preview: true });
      if (await vscode.window.showInformationMessage('Apply the previewed fix and re-stage it? Set the value in your local .env afterward.', { modal: true }, 'Apply fix') !== 'Apply fix') { return; }
      if (dirty()) { throw new Error('Files changed while previewing. Scan and preview again.'); }
      await applySecretFix(base, plan);
      findings = (await verifyStaged(base)).findings;
      show('Fix saved and re-staged. Configure the value in your local .env, then commit again.');
    } finally { fixing = false; if (pending) { pending = false; void run(scan); } }
  }

  async function loadScan(target: string): Promise<void> {
    try {
      const value: unknown = JSON.parse(await readFile(target, 'utf8'));
      if (!value || typeof value !== 'object' || !Array.isArray((value as { findings?: unknown }).findings)) { return; }
      const items = (value as { findings: unknown[] }).findings;
      const valid: SecretFinding[] = [];
      for (const value of items.slice(0, 1000)) {
        if (!value || typeof value !== 'object') { continue; }
        const item = value as Record<string, unknown>;
        if (typeof item.file !== 'string' || typeof item.id !== 'string' || !/^[a-f0-9]{64}$/.test(item.id) || !Number.isSafeInteger(item.startLine) || Number(item.startLine) < 1) { continue; }
        try { await safeFile(root, item.file); } catch { continue; }
        valid.push({ id: item.id, file: item.file, startLine: Number(item.startLine), endLine: Number(item.startLine), severity: 'security', title: 'Possible hardcoded credential', explanation: 'Move this possible secret to an environment variable before committing.', canFix: item.canFix === true });
      }
      findings = valid;
      show();
    } catch { output.appendLine('Security scan report unavailable; verify staged changes again.'); }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('devpulse.verifyStaged', () => run(scan)),
    vscode.commands.registerCommand('devpulse.installPrecommitHook', () => run(install)),
    vscode.commands.registerCommand('devpulse.fixSecret', (id: unknown) => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id) ? run(() => fix(id)) : undefined),
    vscode.window.onDidChangeVisibleTextEditors(paint),
    vscode.workspace.onDidChangeTextDocument(paint),
    vscode.window.onDidChangeWindowState(state => { if (state.focused) { void run(scan); } }),
  );
  void run(async () => {
    const base = await requireRoot();
    const target = await gitPath(base, 'devpulse/last-scan.json');
    const report = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(path.dirname(target), path.basename(target)));
    const indexPath = await gitPath(base, 'index');
    const index = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(path.dirname(indexPath), 'index'));
    context.subscriptions.push(report, index, report.onDidChange(() => { void loadScan(target); }), report.onDidCreate(() => { void loadScan(target); }), index.onDidChange(() => { void run(scan); }), index.onDidCreate(() => { void run(scan); }));
    await scan();
  });
}
