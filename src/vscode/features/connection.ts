import * as vscode from 'vscode';
import { join } from 'node:path';
import { loadEditorConfig as loadConfig } from '../configuration';
import { listModels, ModelListError } from '../../core/llm/models';
import type { ConnectionState } from '../panel/messages';

export class Connection implements vscode.Disposable {
  private state: ConnectionState = {
    phase: 'idle',
    message: 'Check your AI connection to verify endpoint reachability and models.',
  };
  private operation?: AbortController;
  private readonly subscriptions: vscode.Disposable[] = [];
  private startupTimer?: NodeJS.Timeout;
  private pollTimer?: NodeJS.Timeout;
  onUpdate: () => void = () => {};

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {
    this.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('devpulse.llm') || event.affectsConfiguration('devpulse.assistant.inline')) {
          this.cancel();
          this.update({
            phase: 'idle',
            message: 'Settings changed. Checking AI connection…',
            latencyMs: undefined,
            reviewModel: undefined,
            inlineModel: undefined,
            modelsCount: undefined,
          });
          void this.check();
        }
      }),
      vscode.window.onDidChangeWindowState(windowState => {
        if (windowState.focused) {
          void this.check();
        }
      }),
    );

    // Initial probe runs in background shortly after startup
    this.startupTimer = setTimeout(() => {
      void this.check();
    }, 200);
    this.startupTimer.unref?.();

    // Periodic diagnostics heartbeat every 30 seconds
    this.pollTimer = setInterval(() => {
      void this.check();
    }, 30_000);
    this.pollTimer.unref?.();
  }

  getState(): ConnectionState {
    return this.state;
  }

  private update(patch: Partial<ConnectionState>): void {
    this.state = { ...this.state, ...patch };
    this.onUpdate();
  }

  cancel(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = undefined;
    }
    if (this.operation) {
      this.operation.abort();
      this.operation = undefined;
    }
  }

  async check(): Promise<void> {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = undefined;
    }
    if (this.state.phase === 'checking' || this.operation) {
      return;
    }

    const controller = new AbortController();
    this.operation = controller;
    this.update({
      phase: 'checking',
      message: 'Checking connection to AI endpoint…',
    });

    const startTime = Date.now();
    try {
      const llmSettings = vscode.workspace.getConfiguration('devpulse.llm');
      const inlineSettings = vscode.workspace.getConfiguration('devpulse.assistant.inline');
      const config = await loadConfig({
        scriptDirectory: join(this.context.extensionPath, 'dist'),
        settings: {
          baseUrl: llmSettings.get<string>('baseUrl'),
          model: llmSettings.get<string>('model'),
          modelOverride: llmSettings.get<string>('modelOverride'),
          jsonMode: false,
        },
        secretApiKey: await this.context.secrets.get('devpulse.llm.apiKey'),
      });

      controller.signal.throwIfAborted();
      const models = await listModels(config, controller.signal, true);
      const latencyMs = Math.max(1, Date.now() - startTime);

      const reviewModelId = config.model;
      const inlineModelId = inlineSettings.get<string>('model')?.trim() || config.model;

      this.update({
        phase: 'ready',
        message: `Connected (${latencyMs}ms). ${models.length} model(s) available.`,
        latencyMs,
        reviewModel: { id: reviewModelId, available: models.includes(reviewModelId) },
        inlineModel: { id: inlineModelId, available: models.includes(inlineModelId) },
        modelsCount: models.length,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        this.update({
          phase: 'cancelled',
          message: 'Connection check cancelled.',
        });
        return;
      }

      const message = error instanceof ModelListError
        ? error.message
        : 'Could not reach Gemma endpoint. Check server and settings.';
      this.output.appendLine(`[DevPulse AI Connection] Check failed: ${message}`);
      this.update({
        phase: 'failed',
        message,
        latencyMs: undefined,
        reviewModel: undefined,
        inlineModel: undefined,
        modelsCount: undefined,
      });
    } finally {
      if (this.operation === controller) {
        this.operation = undefined;
      }
    }
  }

  dispose(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = undefined;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.cancel();
    this.subscriptions.forEach(s => s.dispose());
  }
}
