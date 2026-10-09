import * as vscode from 'vscode';
import { relative, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig } from '../../core/llm/config';
import { createLlm } from '../../core/llm/client';
import { autocompletePrompt } from '../../core/llm/prompts';
import { completionContext } from '../../core/llm/completion';
import { isSensitiveFile, safeFile } from '../../core/git/diff';

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider, vscode.Disposable {
  private disposed = false;
  private operation?: AbortController;
  private reported = false;
  private readonly listeners: vscode.Disposable[];
  constructor(private readonly context: vscode.ExtensionContext, private readonly output: vscode.OutputChannel) {
    this.listeners = [vscode.workspace.onDidChangeTextDocument(() => this.operation?.abort()),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('devpulse')) { this.operation?.abort(); }
      })];
  }
  async provideInlineCompletionItems(document: vscode.TextDocument, position: vscode.Position,
    _context: vscode.InlineCompletionContext, token: vscode.CancellationToken): Promise<vscode.InlineCompletionItem[]> {
    this.operation?.abort();
    const settings = vscode.workspace.getConfiguration('devpulse.assistant.inline', document.uri);
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!settings.get<boolean>('enabled', false) || !vscode.workspace.isTrusted || this.disposed
      || token.isCancellationRequested || document.isClosed || document.uri.scheme !== 'file' || !folder
      || isSensitiveFile(document.fileName)) { return []; }
    const version = document.version, controller = new AbortController(); this.operation = controller;
    const cancellation = token.onCancellationRequested(() => controller.abort());
    const timer = setTimeout(() => controller.abort(), 8000);
    const current = () => !controller.signal.aborted && !token.isCancellationRequested && !this.disposed
      && !document.isClosed && document.version === version && settings.get<boolean>('enabled', false);
    try {
      await delay(400, undefined, { signal: controller.signal });
      await safeFile(folder.uri.fsPath, relative(folder.uri.fsPath, document.uri.fsPath));
      if (!current()) { return []; }
      const text = document.getText(); if (text.length > 1_000_000) { return []; }
      const snippet = completionContext(text, document.offsetAt(position));
      if (!snippet?.prefix.trim()) { return []; }
      const llmSettings = vscode.workspace.getConfiguration('devpulse.llm', document.uri);
      const config = await loadConfig({ scriptDirectory: join(this.context.extensionPath, 'dist'),
        settings: { baseUrl: llmSettings.get<string>('baseUrl'), model: llmSettings.get<string>('model'), jsonMode: false },
        secretApiKey: await this.context.secrets.get('devpulse.llm.apiKey') });
      if (!current()) { return []; }
      const raw = await createLlm(config).complete({ system: autocompletePrompt,
        user: `Language: ${document.languageId}\nCode before cursor:\n${snippet.prefix}\nCode after cursor:\n${snippet.suffix}\nContinue at cursor:`,
        model: settings.get<string>('model')?.trim() || undefined,
        maxTokens: 64, temperature: 0.1, timeoutMs: 8000, signal: controller.signal });
      if (!current()) { return []; }
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document !== document || !editor.selection.isEmpty || !editor.selection.active.isEqual(position)) { return []; }
      const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
      let code = linePrefix.trim() && raw.startsWith(linePrefix) ? raw.slice(linePrefix.length) : raw;
      if (snippet.suffix && code.endsWith(snippet.suffix)) { code = code.slice(0, -snippet.suffix.length); }
      if (document.eol === vscode.EndOfLine.CRLF) { code = code.replace(/\r?\n/g, '\r\n'); }
      this.reported = false;
      return code.trim() ? [new vscode.InlineCompletionItem(code, new vscode.Range(position, position))] : [];
    } catch {
      if (!controller.signal.aborted && !this.reported) {
        this.reported = true; this.output.appendLine('Inline completion unavailable. Check Gemma configuration; other features remain available.');
      }
      return [];
    } finally {
      clearTimeout(timer); cancellation.dispose();
      if (this.operation === controller) { this.operation = undefined; }
    }
  }
  dispose(): void { this.disposed = true; this.operation?.abort(); this.listeners.forEach(item => item.dispose()); }
}
export function registerInlineCompletion(context: vscode.ExtensionContext, output: vscode.OutputChannel): vscode.Disposable {
  const provider = new InlineCompletionProvider(context, output);
  return vscode.Disposable.from(provider, vscode.languages.registerInlineCompletionItemProvider({ scheme: 'file' }, provider));
}
