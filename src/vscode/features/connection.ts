import * as vscode from 'vscode';
import { loadConfig } from '../../core/llm/config';
import { listModels, ModelListError } from '../../core/llm/models';
import type { ConnectionState } from '../panel/messages';

export class Connection implements vscode.Disposable {
  private state: ConnectionState = { phase: 'idle', message: 'Check your server and configured models.' };
  private operation?: AbortController;
  private disposed = false;
  private readonly listeners: vscode.Disposable[];
  onUpdate = () => {};
  constructor(private readonly context: vscode.ExtensionContext, private readonly output: vscode.OutputChannel) {
    this.listeners = [vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('devpulse.llm') || event.affectsConfiguration('devpulse.assistant.inline')) {
        this.cancel(); this.state = { phase: 'idle', message: 'Settings changed. Check the connection again.' }; this.onUpdate();
      }
    })];
  }
  getState(): ConnectionState { return this.state; }
  cancel(): void {
    if (!this.operation) { return; }
    this.operation.abort(); this.operation = undefined;
    this.state = { phase: 'idle', message: 'Connection check cancelled.' }; this.onUpdate();
  }
  async check(): Promise<void> {
    if (this.operation || this.disposed || !vscode.workspace.isTrusted) { return; }
    const operation = new AbortController(); this.operation = operation;
    this.state = { phase: 'checking', message: 'Checking model availability…' }; this.onUpdate();
    try {
      const scope = vscode.window.activeTextEditor?.document.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
      const settings = vscode.workspace.getConfiguration('devpulse.llm', scope);
      const config = await loadConfig({ scriptDirectory: this.context.extensionPath + '/dist',
        settings: { baseUrl: settings.get<string>('baseUrl'), model: settings.get<string>('model'), modelOverride: settings.get<string>('modelOverride') },
        secretApiKey: await this.context.secrets.get('devpulse.llm.apiKey') });
      const inlineModel = vscode.workspace.getConfiguration('devpulse.assistant.inline', scope).get<string>('model')?.trim() || config.model;
      const started = Date.now();
      // Bypass the catalog cache so the displayed latency measures a real request.
      const models = await listModels(config, operation.signal, true);
      if (operation.signal.aborted || this.disposed) { return; }
      this.state = { phase: 'ready', latencyMs: Date.now() - started, reviewFound: models.includes(config.model), inlineFound: models.includes(inlineModel),
        message: 'Server responded. Model availability does not measure generation speed.' };
    } catch (error) {
      if (operation.signal.aborted || this.disposed) { return; }
      const message = error instanceof ModelListError ? error.message : 'Connection configuration unavailable. Check DevPulse settings.';
      this.state = { phase: 'failed', message }; this.output.appendLine(message);
    } finally {
      if (this.operation === operation) { this.operation = undefined; if (!this.disposed) { this.onUpdate(); } }
    }
  }
  dispose(): void { this.disposed = true; this.operation?.abort(); this.listeners.forEach(listener => listener.dispose()); }
}
