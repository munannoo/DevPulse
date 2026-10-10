import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { securityPanelMessage, SecurityPanelMessage, SecurityState } from './messages';

export class SecurityPanelProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private state: SecurityState = { type: 'security', findings: [], message: 'Checking staged changes…', phase: 'checking' };

  constructor(private readonly context: vscode.ExtensionContext, private readonly receive: (message: SecurityPanelMessage) => void) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const nonce = randomBytes(16).toString('hex');
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const script = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'security.js'));
    const style = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'security.css'));
    const mascot = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'mascot.svg'));
    view.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${view.webview.cspSource}; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link rel="stylesheet" href="${style}"></head><body>
      <div class="security-layout">
        <header class="security-header">
          <div class="brand">
            <div class="mascot-wrapper">
              <img src="${mascot}" width="34" height="34" alt="DevPulse Mascot" class="mascot-img">
            </div>
            <div class="brand-info">
              <span class="brand-name">DevPulse</span>
              <span class="brand-tag">Security Guard</span>
            </div>
          </div>
        </header>
        <div id="security-status" class="status-strip" data-phase="checking">
          <span class="status-dot"></span>
          <span id="status" class="status-message" role="status">Checking staged changes…</span>
        </div>
        <div class="security-actions">
          <button id="scan" class="btn-primary" title="Scan staged files for leaked API keys, tokens, or passwords">Verify Staged Changes</button>
          <button id="install" class="btn-secondary" title="Install a Git hook to automatically block commits containing leaked secrets">Install Pre-Commit Hook</button>
        </div>
        <div id="findings" class="findings-group"></div>
      </div>
      <script nonce="${nonce}" src="${script}"></script></body></html>`;
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
