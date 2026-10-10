import * as vscode from 'vscode';
import type { Finding } from '../../core/llm/schemas';
import type { PanelFinding } from '../panel/messages';
import { isSensitiveFile } from '../../core/git/diff';

export class Highlights implements vscode.Disposable {
  private readonly findings = new Map<string, PanelFinding[]>();
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('devpulse');
  private readonly lensChanges = new vscode.EventEmitter<void>();
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
      vscode.languages.registerCodeLensProvider({ scheme: 'file' }, {
        onDidChangeCodeLenses: this.lensChanges.event,
        provideCodeLenses: document => {
          if (!vscode.workspace.isTrusted || !vscode.workspace.getWorkspaceFolder(document.uri) || isSensitiveFile(document.fileName)) { return []; }
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
        provideHover: (document, position) => {
          const items = this.findings.get(document.uri.toString())?.filter(finding => position.line + 1 >= finding.startLine && position.line + 1 <= finding.endLine);
          if (!items?.length) { return undefined; }
          return new vscode.Hover(items.map(finding => {
            const markdown = new vscode.MarkdownString();
            const badge = finding.severity === 'security' ? 'Security' : finding.severity === 'warning' ? 'Warning' : 'Context';
            markdown.appendMarkdown(`**DevPulse** · **${badge}**\n\n`);
            markdown.appendText(`${finding.title}\n\n${finding.explanation}`);
            if (finding.suggestion) { markdown.appendText(`\n\nSuggestion: ${finding.suggestion}`); }
            if (finding.replacement) { markdown.appendCodeblock(finding.replacement, document.languageId); }
            if (finding.suggestionId) {
              const args = encodeURIComponent(JSON.stringify([finding.suggestionId]));
              markdown.appendMarkdown(`\n\n[Apply Suggestion](command:devpulse.applySuggestion?${args})`);
              markdown.isTrusted = { enabledCommands: ['devpulse.applySuggestion'] };
            } else { markdown.isTrusted = false; }
            return markdown;
          }));
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
    const findings = this.findings.get(editor.document.uri.toString()) ?? [];
    for (const severity of ['warning', 'security', 'context'] as const) {
      editor.setDecorations(this.decorations[severity], findings.filter(finding => finding.severity === severity).map(finding => this.range(finding, editor.document.lineCount)));
    }
  }
  clearFile(uri: vscode.Uri): void {
    this.findings.delete(uri.toString()); this.diagnostics.delete(uri);
    this.lensChanges.fire();
    vscode.window.visibleTextEditors.forEach(editor => this.render(editor));
  }
  clear(): void {
    this.findings.clear(); this.diagnostics.clear();
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
}
