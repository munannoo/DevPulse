import * as vscode from 'vscode';
import { redact } from '../../core/security/redact';
import { loadConfig } from '../../core/llm/config';
import { createLlm } from '../../core/llm/client';
import { autocompletePrompt } from '../../core/llm/prompts';

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider, vscode.Disposable {
  private disposed = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[]> {
    // 1. Gate check: configuration and workspace trust
    const config = vscode.workspace.getConfiguration('devpulse.assistant.inline');
    if (!config.get<boolean>('enabled', true)) {
      return [];
    }
    if (!vscode.workspace.isTrusted || this.disposed) {
      return [];
    }
    if (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled') {
      return [];
    }

    // 2. Debounce (~400ms) with immediate cancellation abort
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 400);
        token.onCancellationRequested(() => {
          clearTimeout(timer);
          reject(new Error('Cancelled'));
        });
      });
    } catch {
      return [];
    }
    if (token.isCancellationRequested || this.disposed) {
      return [];
    }

    // 3. Extract bounded context: roughly 1500 chars before, 500 chars after cursor
    const offset = document.offsetAt(position);
    const fullText = document.getText();
    const prefix = fullText.slice(Math.max(0, offset - 1500), offset);
    const suffix = fullText.slice(offset, Math.min(fullText.length, offset + 500));

    if (!prefix.trim()) {
      return [];
    }

    // Redact detected secrets to keep sensitive tokens out of prompts
    const safePrefix = redact(prefix);
    const safeSuffix = redact(suffix);

    // Current line up to the cursor to check for repeated prefix output
    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);

    // 4. Load LLM configuration with optional autocomplete model override (e.g. gemma4:e2b)
    const abortController = new AbortController();
    token.onCancellationRequested(() => abortController.abort());

    try {
      const llmSettings = vscode.workspace.getConfiguration('devpulse.llm');
      const modelOverride = config.get<string>('model')?.trim();
      const llmConfig = await loadConfig({
        scriptDirectory: this.context.extensionPath + '/dist',
        settings: {
          baseUrl: llmSettings.get<string>('baseUrl'),
          model: modelOverride || llmSettings.get<string>('model'),
          jsonMode: false,
        },
        secretApiKey: await this.context.secrets.get('devpulse.llm.apiKey'),
      });

      const userPayload = `Language: ${document.languageId}\n### Code before cursor:\n${safePrefix}\n### Code after cursor:\n${safeSuffix}\n### Continue code at cursor:`;

      const rawCompletion = await createLlm(llmConfig).complete({
        system: autocompletePrompt,
        user: userPayload,
        model: modelOverride || undefined,
        maxTokens: 64,
        timeoutMs: 8000,
        temperature: 0.1,
        signal: abortController.signal,
      });

      if (token.isCancellationRequested || !rawCompletion || !rawCompletion.trim()) {
        return [];
      }

      let completionText = rawCompletion;
      // Strip linePrefix repetition if model echoed the line start
      if (linePrefix.trim() && completionText.startsWith(linePrefix)) {
        completionText = completionText.slice(linePrefix.length);
      }

      if (!completionText.trim()) {
        return [];
      }

      const item = new vscode.InlineCompletionItem(
        completionText,
        new vscode.Range(position, position),
      );

      return [item];
    } catch (error) {
      if (!abortController.signal.aborted && !token.isCancellationRequested) {
        const message = error instanceof Error ? error.message : String(error);
        this.output.appendLine(`DevPulse inline completion: ${message}`);
      }
      return [];
    }
  }

  dispose(): void {
    this.disposed = true;
  }
}

export function registerInlineCompletion(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): vscode.Disposable {
  const provider = new InlineCompletionProvider(context, output);
  const registration = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: '**' },
    provider,
  );
  return vscode.Disposable.from(provider, registration);
}
