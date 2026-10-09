import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { securityPanelMessage, SecurityPanelMessage, SecurityState } from './messages';

export class SecurityPanelProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private state: SecurityState = { type: 'security', findings: [], message: 'Checking staged changes…' };

  constructor(private readonly context: vscode.ExtensionContext, private readonly receive: (message: SecurityPanelMessage) => void) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const nonce = randomBytes(16).toString('hex');
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const script = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'security.js'));
    const style = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'security.css'));
    const mascot = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'mascot.svg'));
    view.webview.html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${view.webview.cspSource}; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link rel="stylesheet" href="${style}"></head><body>
      <header><img src="${mascot}" width="28" height="28" alt=""><h1>DevPulse</h1></header>
      <main><h2>Security</h2><p id="status" role="status"></p>
      <button id="scan">Verify staged changes</button> <button id="install">Install pre-commit hook</button>
      <div id="findings"></div></main><script nonce="${nonce}" src="${script}"></script></body></html>`;
    this.context.subscriptions.push(view.webview.onDidReceiveMessage((value: unknown) => {
      const message = securityPanelMessage(value);
      if (message) { this.receive(message); }
    }));
    this.update(this.state);
    this.context.subscriptions.push(view.onDidChangeVisibility(() => { if (view.visible) { this.update(this.state); } }));
  }

  update(state: SecurityState): void {
    this.state = state;
    if (this.view) { void this.view.webview.postMessage(state).then(undefined, () => undefined); }
  }
}
