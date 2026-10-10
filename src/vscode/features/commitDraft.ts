import * as vscode from 'vscode';
import { repository, GitError } from '../../core/git/repo';
import { stagedCommitInput, stagedFingerprint, generateCommitDraft, CommitDraftError } from '../../core/review/commit';
import { loadEditorConfig as loadConfig } from '../configuration';
import { LlmError } from '../../core/llm/client';
import { clearCached } from '../../core/llm/cache';

export function registerCommitDraft(context: vscode.ExtensionContext, output: vscode.OutputChannel): vscode.Disposable {
  let operation: AbortController | undefined;
  let previousFolder: vscode.WorkspaceFolder | undefined;
  const generate = vscode.commands.registerCommand('devpulse.generateCommitDescription', async () => {
    if (operation) { return; }
    const active = vscode.window.activeTextEditor?.document.uri;
    const folder = (active ? vscode.workspace.getWorkspaceFolder(active) : undefined)
      ?? (previousFolder && vscode.workspace.getWorkspaceFolder(previousFolder.uri)) ?? vscode.workspace.workspaceFolders?.[0];
    if (!folder || !vscode.workspace.isTrusted) { void vscode.window.showInformationMessage('Open a trusted Git workspace to draft a commit.'); return; }
    previousFolder = folder;
    const controller = new AbortController(); operation = controller;
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Drafting commit description and analysis…', cancellable: true }, async (_progress, token) => {
        const cancellation = token.onCancellationRequested(() => controller.abort());
        if (token.isCancellationRequested) { controller.abort(); }
        try {
          const root = await repository(folder.uri.fsPath);
          const input = await stagedCommitInput(root, controller.signal);
          const settings = vscode.workspace.getConfiguration('devpulse.llm', folder.uri);
          const config = await loadConfig({ scriptDirectory: context.extensionPath + '/dist',
            settings: { baseUrl: settings.get<string>('baseUrl'), model: settings.get<string>('model'), modelOverride: settings.get<string>('modelOverride'), jsonMode: settings.get<boolean>('jsonMode') },
            secretApiKey: await context.secrets.get('devpulse.llm.apiKey') });
          const draft = await generateCommitDraft(input, config, controller.signal);
          if (await stagedFingerprint(root, controller.signal) !== input.fingerprint) { throw new CommitDraftError('Staged changes moved. Run the command again.'); }
          controller.signal.throwIfAborted();
          const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content:
            `COMMIT MESSAGE (draft — review before use)\n\n${draft.title}\n\n${draft.description}\n\nANALYSIS\n\n${draft.analysis}\n\nVerification: not run by this command.\n${input.skipped.length ? `\nExcluded: ${input.skipped.join(', ')}\n` : ''}` });
          await vscode.window.showTextDocument(document, { preview: false });
        } finally { cancellation.dispose(); }
      });
    } catch (error) {
      const message = controller.signal.aborted ? 'Commit draft cancelled.' : error instanceof CommitDraftError || error instanceof GitError || error instanceof LlmError
        ? error.message : 'Could not draft this commit. Check Git and Gemma configuration.';
      output.appendLine(message); void vscode.window.showInformationMessage(message);
    } finally { operation = undefined; }
  });
  const clear = vscode.commands.registerCommand('devpulse.clearAiCache', () => {
    clearCached(); void vscode.window.showInformationMessage('DevPulse AI response cache cleared.');
  });
  return vscode.Disposable.from(generate, clear, new vscode.Disposable(() => operation?.abort()));
}
