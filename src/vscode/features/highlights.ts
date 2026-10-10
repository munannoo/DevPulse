import * as vscode from 'vscode';
import type { Finding } from '../../core/llm/schemas';
import type { PanelFinding } from '../panel/messages';
import { isSensitiveFile } from '../../core/git/diff';
import { relative } from 'node:path';
import { recentFileCommits, type FileCommit } from '../../core/git/history';
import { flowDiagram } from '../../core/review/flow';

export const analysisCommands = { inspect: 'devpulse.inspectAnalysisStep' } as const;

export class Highlights implements vscode.Disposable {
  private readonly findings = new Map<string, PanelFinding[]>();
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('devpulse');
  private readonly lensChanges = new vscode.EventEmitter<void>();
  private readonly history = new Map<string, { expires: number; promise: Promise<FileCommit[]> }>();
  private readonly decorations: Record<Finding['severity'], vscode.TextEditorDecorationType>;
  private readonly focusDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground'),
    borderWidth: '0 0 0 4px',
    borderStyle: 'solid',
    borderColor: new vscode.ThemeColor('focusBorder'),
  });
  private focusTimer?: ReturnType<typeof setTimeout>;
  private readonly listeners: vscode.Disposable[];
  constructor(extensionUri: vscode.Uri, onStale: (uri: vscode.Uri) => void) {
    const create = (severity: Finding['severity'], color: string) => vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.joinPath(extensionUri, 'media', 'icons', `${severity}.svg`),
      gutterIconSize: 'contain',
      isWholeLine: true,
      backgroundColor: `${color}1a`,
      borderWidth: '0 0 0 3px',
      borderStyle: 'solid',
      borderColor: color,
      overviewRulerColor: color,
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
    this.decorations = { warning: create('warning', '#eab308'), security: create('security', '#ef4444'), context: create('context', '#3b82f6') };
    this.listeners = [
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('devpulse.analysis')) {
          this.lensChanges.fire(); this.history.clear();
          vscode.window.visibleTextEditors.forEach(editor => this.render(editor));
        }
      }),
      vscode.commands.registerCommand(analysisCommands.inspect, async (target: unknown, line: unknown) => {
        if (typeof target !== 'string' || !Number.isSafeInteger(line) || !vscode.workspace.isTrusted) { return; }
        const items = this.findings.get(target);
        if (!items?.some(item => item.flow?.nodes.some(node => node.line === line))) { return; }
        try {
          const uri = vscode.Uri.parse(target);
          if (!vscode.workspace.getWorkspaceFolder(uri) || isSensitiveFile(uri.fsPath)) { return; }
          const document = await vscode.workspace.openTextDocument(uri);
          if (this.findings.get(target) !== items || Number(line) > document.lineCount) { return; }
          const editor = await vscode.window.showTextDocument(document);
          const range = new vscode.Range(Number(line) - 1, 0, Number(line) - 1, document.lineAt(Number(line) - 1).text.length);
          editor.selection = new vscode.Selection(range.start, range.end);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        } catch { /* Missing files and stale flow steps are expected. */ }
      }),
      vscode.languages.registerCodeLensProvider({ scheme: 'file' }, {
        onDidChangeCodeLenses: this.lensChanges.event,
        provideCodeLenses: document => {
          if (!vscode.workspace.isTrusted || !vscode.workspace.getWorkspaceFolder(document.uri) || isSensitiveFile(document.fileName)
            || !vscode.workspace.getConfiguration('devpulse.analysis', document.uri).get<boolean>('codeLens', true)) { return []; }
          const findings = this.findings.get(document.uri.toString());
          const status = findings === undefined ? 'Analyze file' : findings.length ? `${findings.length} finding${findings.length === 1 ? '' : 's'} · Analyze again` : 'No findings · Analyze again';
          return [new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
            title: `DevPulse · ${status}`, command: 'devpulse.analyzeFile', arguments: [document.uri],
          })];
        },
      }),
      vscode.window.onDidChangeVisibleTextEditors(editors => editors.forEach(editor => this.render(editor))),
      vscode.window.onDidChangeActiveTextEditor(editor => { if (editor) { this.render(editor); } }),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (!event.contentChanges.length || !this.findings.has(event.document.uri.toString())) { return; }
        this.clearFile(event.document.uri); onStale(event.document.uri);
      }),
      vscode.languages.registerHoverProvider({ scheme: 'file' }, {
        provideHover: async (document, position, token) => {
          const settings = vscode.workspace.getConfiguration('devpulse.analysis', document.uri);
          if (!settings.get<boolean>('hovers', true)) { return undefined; }
          const items = this.findings.get(document.uri.toString())?.filter(finding => position.line + 1 >= finding.startLine && position.line + 1 <= finding.endLine);
          if (!items?.length) { return undefined; }
          const version = document.version;
          const commits = settings.get<boolean>('history', true) ? await this.fileHistory(document, token) : [];
          if (token.isCancellationRequested || document.version !== version || !this.findings.has(document.uri.toString())) { return undefined; }
          return new vscode.Hover(items.map(finding => {
            const markdown = new vscode.MarkdownString();
            const enabledCommands: string[] = [];
            const badge = finding.severity === 'security' ? '🔴 Security' : finding.severity === 'warning' ? '🟡 Warning' : '🔵 Context';
            markdown.appendMarkdown(`**DevPulse** · **${badge}**\n\n`);
            markdown.appendText(`${finding.title}\n\n${finding.explanation}`);
            if (finding.suggestion) { markdown.appendText(`\n\nSuggestion: ${finding.suggestion}`); }
            if (finding.replacement) { markdown.appendCodeblock(finding.replacement, document.languageId); }
            if (finding.flow && settings.get<boolean>('diagrams', true)) {
              markdown.appendMarkdown('\n\n**Code flow · AI analysis**\n\n');
              markdown.appendCodeblock(flowDiagram(finding.flow), 'text');
              finding.flow.nodes.forEach((node, index) => {
                const args = encodeURIComponent(JSON.stringify([document.uri.toString(), node.line]));
                markdown.appendMarkdown(`\n\n[Inspect step ${index + 1} · line ${node.line}](command:${analysisCommands.inspect}?${args})`);
              });
              enabledCommands.push(analysisCommands.inspect);
            }
            if (settings.get<boolean>('history', true)) {
              markdown.appendMarkdown('\n\n**Recent file commits**\n\n');
              if (!commits.length) { markdown.appendText('No available Git history for this file.'); }
              for (const commit of commits) { markdown.appendText(`${commit.hash} · ${commit.author} · ${commit.date}\n${commit.subject}\n\n`); }
            }
            if (finding.suggestionId) {
              const args = encodeURIComponent(JSON.stringify([finding.suggestionId]));
              markdown.appendMarkdown(`\n\n[Apply Suggestion](command:devpulse.applySuggestion?${args})`);
              enabledCommands.push('devpulse.applySuggestion');
            }
            markdown.isTrusted = enabledCommands.length ? { enabledCommands } : false;
            return markdown;
          }), this.range(items[0], document.lineCount));
        },
      }),
    ];
  }
  set(uri: vscode.Uri, findings: PanelFinding[]): void {
    this.findings.set(uri.toString(), findings);
    this.lensChanges.fire();
    this.diagnostics.set(uri, findings.map(finding => {
      const diagnostic = new vscode.Diagnostic(this.range(finding), `${finding.title}: ${finding.explanation}`,
        finding.severity === 'security' ? vscode.DiagnosticSeverity.Error : finding.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information);
      diagnostic.source = 'DevPulse'; return diagnostic;
    }));
    vscode.window.visibleTextEditors.forEach(editor => this.render(editor));
  }
  pulseFinding(editor: vscode.TextEditor, finding: Finding): void {
    clearTimeout(this.focusTimer);
    const range = this.range(finding, editor.document.lineCount);
    editor.setDecorations(this.focusDecoration, [range]);
    this.focusTimer = setTimeout(() => {
      editor.setDecorations(this.focusDecoration, []);
    }, 3000);
  }
  private range(finding: Finding, lineCount?: number): vscode.Range {
    const maxLine = lineCount !== undefined ? Math.max(0, lineCount - 1) : 100_000;
    const start = Math.max(0, Math.min(maxLine, finding.startLine - 1));
    const end = Math.max(start, Math.min(maxLine, finding.endLine - 1));
    return new vscode.Range(start, 0, end, 100_000);
  }
  private render(editor: vscode.TextEditor): void {
    const findings = vscode.workspace.getConfiguration('devpulse.analysis', editor.document.uri).get<boolean>('highlights', true)
      ? this.findings.get(editor.document.uri.toString()) ?? [] : [];
    for (const severity of ['warning', 'security', 'context'] as const) {
      editor.setDecorations(this.decorations[severity], findings.filter(finding => finding.severity === severity).map(finding => this.range(finding, editor.document.lineCount)));
    }
  }
  clearFile(uri: vscode.Uri): void {
    this.findings.delete(uri.toString()); this.diagnostics.delete(uri);
    this.history.delete(uri.toString());
    this.lensChanges.fire();
    vscode.window.visibleTextEditors.forEach(editor => this.render(editor));
  }
  clear(): void {
    this.findings.clear(); this.diagnostics.clear();
    this.history.clear();
    this.lensChanges.fire();
    vscode.window.visibleTextEditors.forEach(editor => this.render(editor));
  }
  dispose(): void {
    clearTimeout(this.focusTimer);
    this.focusDecoration.dispose();
    this.listeners.forEach(listener => listener.dispose()); this.diagnostics.dispose();
    this.lensChanges.dispose();
    Object.values(this.decorations).forEach(decoration => decoration.dispose());
  }
  private async fileHistory(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<FileCommit[]> {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder || !vscode.workspace.isTrusted) { return []; }
    const key = document.uri.toString(), cached = this.history.get(key);
    if (cached && cached.expires > Date.now()) { return cached.promise; }
    const controller = new AbortController();
    const cancellation = token.onCancellationRequested(() => controller.abort());
    if (token.isCancellationRequested) { controller.abort(); }
    const promise = recentFileCommits(folder.uri.fsPath, relative(folder.uri.fsPath, document.uri.fsPath), controller.signal)
      .catch(() => []).finally(() => cancellation.dispose());
    if (this.history.size >= 100) { this.history.delete(this.history.keys().next().value!); }
    this.history.set(key, { expires: Date.now() + 60_000, promise });
    return promise;
  }
}
