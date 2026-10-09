import * as vscode from 'vscode';
import type { Finding } from '../../core/llm/schemas';
import type { PanelFinding } from '../panel/messages';

export class Highlights implements vscode.Disposable {
  private readonly findings = new Map<string, PanelFinding[]>();
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('devpulse');
  private readonly decorations: Record<Finding['severity'], vscode.TextEditorDecorationType>;
  private readonly listeners: vscode.Disposable[];
  constructor(extensionUri: vscode.Uri, onStale: (uri: vscode.Uri) => void) {
    const create = (severity: Finding['severity'], color: string) => vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.joinPath(extensionUri, 'media', 'icons', `${severity}.svg`),
      gutterIconSize: 'contain', isWholeLine: true, backgroundColor: `${color}12`,
      overviewRulerColor: color, overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
    this.decorations = { warning: create('warning', '#eab308'), security: create('security', '#ef4444'), context: create('context', '#3b82f6') };
    this.listeners = [
      vscode.window.onDidChangeVisibleTextEditors(editors => editors.forEach(editor => this.render(editor))),
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
    this.diagnostics.set(uri, findings.map(finding => {
      const diagnostic = new vscode.Diagnostic(this.range(finding), `${finding.title}: ${finding.explanation}`,
        finding.severity === 'security' ? vscode.DiagnosticSeverity.Error : finding.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information);
      diagnostic.source = 'DevPulse'; return diagnostic;
    }));
    vscode.window.visibleTextEditors.forEach(editor => this.render(editor));
  }
  private range(finding: Finding): vscode.Range {
    return new vscode.Range(finding.startLine - 1, 0, finding.endLine - 1, 100_000);
  }
  private render(editor: vscode.TextEditor): void {
    const findings = this.findings.get(editor.document.uri.toString()) ?? [];
    for (const severity of ['warning', 'security', 'context'] as const) {
      editor.setDecorations(this.decorations[severity], findings.filter(finding => finding.severity === severity).map(finding => this.range(finding)));
    }
  }
  clearFile(uri: vscode.Uri): void {
    this.findings.delete(uri.toString()); this.diagnostics.delete(uri);
    vscode.window.visibleTextEditors.forEach(editor => this.render(editor));
  }
  clear(): void {
    this.findings.clear(); this.diagnostics.clear();
    vscode.window.visibleTextEditors.forEach(editor => this.render(editor));
  }
  dispose(): void {
    this.listeners.forEach(listener => listener.dispose()); this.diagnostics.dispose();
    Object.values(this.decorations).forEach(decoration => decoration.dispose());
  }
}
