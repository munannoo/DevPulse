import * as vscode from 'vscode';
import { loadConfig } from '../../core/llm/config';
import { listModels, ModelListError, validModelId } from '../../core/llm/models';

export function registerModelPicker(context: vscode.ExtensionContext, output: vscode.OutputChannel): vscode.Disposable {
  const operations = new Set<AbortController>();
  const commands = [false, true].map(inline => vscode.commands.registerCommand(
    inline ? 'devpulse.selectInlineModel' : 'devpulse.selectModel', async (requested?: unknown) => {
      if (!vscode.workspace.isTrusted) { void vscode.window.showInformationMessage('Trust this workspace to select a Gemma model.'); return; }
      const operation = new AbortController(); operations.add(operation);
      try {
        const folder = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor?.document.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri ?? context.extensionUri);
        const scope = folder?.uri;
        const settings = vscode.workspace.getConfiguration('devpulse.llm', scope);
        const config = await loadConfig({ scriptDirectory: context.extensionPath + '/dist',
          settings: { baseUrl: settings.get<string>('baseUrl'), model: settings.get<string>('model'), modelOverride: settings.get<string>('modelOverride') },
          secretApiKey: await context.secrets.get('devpulse.llm.apiKey') });
        const target = inline ? vscode.workspace.getConfiguration('devpulse.assistant.inline', scope) : settings;
        const key = inline ? 'model' : 'modelOverride';
        const current = target.get<string>(key)?.trim() || config.model;
        const models = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Loading installed Gemma models…', cancellable: true }, async (_progress, token) => {
          const cancellation = token.onCancellationRequested(() => operation.abort());
          if (token.isCancellationRequested) { operation.abort(); }
          try { return await listModels(config, operation.signal); } finally { cancellation.dispose(); }
        });
        if (operation.signal.aborted) { return; }
        const choices = [{ label: 'Use configured model', description: 'Clear this override', model: '' },
          ...models.map(model => ({ label: model, description: model === current ? 'Current model' : '', model }))];
        const picked = requested === undefined ? await vscode.window.showQuickPick(choices, {
          title: inline ? 'Autocomplete model' : 'Review and chat model', placeHolder: `Current: ${validModelId(current) ? current : 'configured default'}`, matchOnDescription: true,
        }) : choices.find(choice => choice.model === requested);
        if (!picked || operation.signal.aborted) { return; }
        await target.update(key, picked.model, folder ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global);
        void vscode.window.showInformationMessage(`DevPulse ${inline ? 'autocomplete' : 'review and chat'} model: ${picked.model || 'configured default'}.`);
      } catch (error) {
        if (!operation.signal.aborted) {
          const message = error instanceof ModelListError ? error.message : 'Could not save the model selection. Check DevPulse settings.';
          output.appendLine(message); void vscode.window.showInformationMessage(message);
        }
      } finally { operations.delete(operation); }
    }));
  return vscode.Disposable.from(...commands, new vscode.Disposable(() => { for (const operation of operations) { operation.abort(); } }));
}
