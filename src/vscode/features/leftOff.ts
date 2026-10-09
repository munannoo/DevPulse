import * as vscode from 'vscode';
import { relative } from 'node:path';
import { getBranchStatus, git } from '../../core/git/repo';
import { isSensitiveFile, safeFile } from '../../core/git/diff';
import { redact } from '../../core/security/redact';
import { loadConfig } from '../../core/llm/config';
import { createLlm } from '../../core/llm/client';
import { leftOffPrompt } from '../../core/llm/prompts';

export type LeftOffBanner = { file: string; line: number; branch: string; summary: string };
type SavedContext = LeftOffBanner & { folder: string; openFiles: string[]; commands: string[]; digest: string };
const key = 'devpulse.leftOff';

export class LeftOff implements vscode.Disposable {
  private saved?: SavedContext;
  private banner?: LeftOffBanner;
  private timer?: ReturnType<typeof setTimeout>;
  private writing = false;
  private disposed = false;
  private readonly abort = new AbortController();
  private commands: string[] = [];
  private readonly listeners: vscode.Disposable[] = [];
  private readonly resumeDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground'),
    borderWidth: '0 0 0 4px',
    borderStyle: 'solid',
    borderColor: new vscode.ThemeColor('focusBorder'),
    overviewRulerColor: new vscode.ThemeColor('focusBorder'),
    overviewRulerLane: vscode.OverviewRulerLane.Center,
  });
  private resumeTimer?: ReturnType<typeof setTimeout>;
  private resumeClearSubscriptions: vscode.Disposable[] = [];
  onUpdate: () => void = () => {};
  constructor(private readonly context: vscode.ExtensionContext, private readonly output: vscode.OutputChannel) {
    const saved = context.workspaceState.get<SavedContext>(key);
    if (saved && typeof saved.folder === 'string' && typeof saved.file === 'string' &&
      Number.isInteger(saved.line) && saved.line > 0 && typeof saved.branch === 'string') {
      this.saved = saved;
      this.banner = { file: saved.file, line: saved.line, branch: saved.branch,
        summary: `You were editing ${saved.file} at line ${saved.line}${saved.branch ? ` on ${saved.branch}` : ''}.` };
    }
    this.listeners.push(vscode.window.onDidChangeActiveTextEditor(() => this.schedule()),
      vscode.window.onDidChangeTextEditorSelection(() => this.schedule()),
      vscode.workspace.onDidChangeTextDocument(() => this.schedule()),
      vscode.commands.registerCommand('devpulse.resumeWork', () => this.resume()));
    if (vscode.window.onDidEndTerminalShellExecution) {
      this.listeners.push(vscode.window.onDidEndTerminalShellExecution(event => {
        this.commands = [...this.commands, redact(event.execution.commandLine.value).slice(0, 300)].slice(-8);
        this.schedule();
      }));
    }
    this.schedule();
  }
  getState(): LeftOffBanner | undefined { return this.banner; }
  schedule(): void {
    if (this.disposed) { return; }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.save(); }, 2000);
  }
  private async save(): Promise<void> {
    if (this.writing) { this.schedule(); return; }
    const editor = vscode.window.activeTextEditor;
    const folder = editor && vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!editor || !folder || editor.document.uri.scheme !== 'file' || !vscode.workspace.isTrusted) { return; }
    const file = relative(folder.uri.fsPath, editor.document.uri.fsPath).replace(/\\/g, '/');
    if (isSensitiveFile(file)) { return; }
    const line = editor.selection.active.line + 1;
    this.writing = true;
    try {
      const branch = await getBranchStatus(folder.uri.fsPath, false, this.abort.signal);
      const digest = await git(branch.root, ['diff', '--stat', 'HEAD'], this.abort.signal).catch(() => '');
      const gitFile = relative(branch.root, editor.document.uri.fsPath).replace(/\\/g, '/');
      const diff = await git(branch.root, ['diff', '--unified=0', 'HEAD', '--', gitFile], this.abort.signal).catch(() => '');
      const openFiles = vscode.workspace.textDocuments.filter(document => document.uri.scheme === 'file' &&
        vscode.workspace.getWorkspaceFolder(document.uri)?.uri.toString() === folder.uri.toString())
        .map(document => relative(folder.uri.fsPath, document.uri.fsPath).replace(/\\/g, '/'))
        .filter(name => !isSensitiveFile(name)).slice(0, 20);
      if (this.disposed) { return; }
      await this.context.workspaceState.update(key, { folder: folder.uri.toString(), file, line,
        branch: redact(branch.branch), openFiles, commands: this.commands,
        digest: redact(`${digest}\n${diff}`).slice(0, 4000) });
    } catch { if (!this.disposed) { this.output.appendLine('Could not save editing context.'); } }
    finally { this.writing = false; }
  }
  async restore(): Promise<void> {
    if (!this.saved || !this.banner) { return; }
    try {
      const settings = vscode.workspace.getConfiguration('devpulse.llm');
      const config = await loadConfig({ scriptDirectory: this.context.extensionPath + '/dist',
        settings: { baseUrl: settings.get<string>('baseUrl'), model: settings.get<string>('model'), jsonMode: settings.get<boolean>('jsonMode') },
        secretApiKey: await this.context.secrets.get('devpulse.llm.apiKey') });
      const summary = await createLlm(config).chat({ system: leftOffPrompt, signal: this.abort.signal,
        user: JSON.stringify({ file: this.saved.file, line: this.saved.line, branch: this.saved.branch, digest: this.saved.digest }),
        timeoutMs: 8000, maxTokens: 100, json: value => {
          const text = (value as { summary?: unknown })?.summary;
          if (typeof text !== 'string' || !text.trim()) { throw new Error('Invalid summary.'); }
          return redact(text.trim()).slice(0, 240);
        } });
      if (!this.disposed) { this.banner = { ...this.banner, summary }; this.onUpdate(); }
    } catch { if (!this.disposed) { this.output.appendLine('Gemma summary unavailable; saved file and line remain available.'); } }
  }
  async resume(): Promise<void> {
    if (!this.saved) { return; }
    try {
      const folder = vscode.workspace.workspaceFolders?.find(item => item.uri.toString() === this.saved!.folder);
      if (!folder || isSensitiveFile(this.saved.file)) { throw new Error('Missing workspace.'); }
      const document = await vscode.workspace.openTextDocument(await safeFile(folder.uri.fsPath, this.saved.file));
      const editor = await vscode.window.showTextDocument(document);
      const targetLine = Math.max(0, Math.min(document.lineCount - 1, this.saved.line - 1));
      const position = new vscode.Position(targetLine, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
      this.highlightResume(editor, targetLine);
    } catch {
      this.output.appendLine('Saved file is unavailable. It may have moved or been deleted.');
      if (this.banner) { this.banner = { ...this.banner, summary: 'Saved file is unavailable. It may have moved or been deleted.' }; this.onUpdate(); }
    }
  }
  private highlightResume(editor: vscode.TextEditor, line: number): void {
    if (this.disposed) { return; }
    this.clearResumeHighlight(editor);
    const lineRange = new vscode.Range(line, 0, line, editor.document.lineAt(line).text.length);
    editor.setDecorations(this.resumeDecoration, [lineRange]);

    const clear = () => {
      this.clearResumeHighlight(editor);
    };

    this.resumeClearSubscriptions = [
      vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document.uri.toString() === editor.document.uri.toString() && e.contentChanges.length) {
          clear();
        }
      }),
      vscode.window.onDidChangeTextEditorSelection(e => {
        if (e.textEditor === editor && e.selections[0]?.active.line !== line) {
          clear();
        }
      }),
    ];

    this.resumeTimer = setTimeout(clear, 4000);
  }
  private clearResumeHighlight(editor?: vscode.TextEditor): void {
    clearTimeout(this.resumeTimer);
    this.resumeTimer = undefined;
    this.resumeClearSubscriptions.forEach(d => d.dispose());
    this.resumeClearSubscriptions = [];
    if (editor && !this.disposed) {
      editor.setDecorations(this.resumeDecoration, []);
    }
  }
  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.clearResumeHighlight();
    this.resumeDecoration.dispose();
    this.abort.abort();
    this.listeners.forEach(item => item.dispose());
  }
}
