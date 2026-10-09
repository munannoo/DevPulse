import * as vscode from 'vscode';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { isPanelMessage, type PanelMessage, type ExtensionMessage, type ReviewState } from './messages';

export class PanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private listeners: vscode.Disposable[] = [];
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly getState: () => ReviewState,
    private readonly handle: (message: PanelMessage) => Promise<void>,
    private readonly output: vscode.OutputChannel,
    private readonly onReady: () => Promise<void> = async () => {},
  ) {}
  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    let frontendReady = false;
    const notifyReady = () => {
      if (frontendReady && view.visible) {
        void this.onReady().catch(() => this.output.appendLine('Could not report development host readiness.'));
      }
    };
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    this.listeners.push(view.webview.onDidReceiveMessage((message: unknown) => {
      if (!isPanelMessage(message)) { return; }
      if (message.type === 'ready') { frontendReady = true; this.update(); notifyReady(); return; }
      void this.handle(message).catch(() => this.output.appendLine('Panel action could not complete.'));
    }), view.onDidChangeVisibility(notifyReady), view.onDidDispose(() => { if (this.view === view) { this.view = undefined; } }));
    try {
      let html = await readFile(vscode.Uri.joinPath(media, 'panel.html').fsPath, 'utf8');
      const resources: Record<string, string> = {
        NONCE: randomBytes(16).toString('hex'), CSP: view.webview.cspSource,
        CSS: view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'panel.css')).toString(),
        JS: view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'panel.js')).toString(),
        CHATJS: view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'chat.js')).toString(),
        MASCOT: view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'mascot.svg')).toString(),
      };
      for (const [key, value] of Object.entries(resources)) { html = html.replaceAll(`{{${key}}}`, value); }
      view.webview.html = html;
    } catch { this.output.appendLine('Could not load DevPulse panel assets.'); }
  }
  update(): void {
    const message: ExtensionMessage = { type: 'state', state: this.getState() };
    if (this.view) { void this.view.webview.postMessage(message).then(undefined, () => {}); }
  }
  isVisible(): boolean { return this.view?.visible === true; }
  dispose(): void { this.listeners.forEach(listener => listener.dispose()); }
}
