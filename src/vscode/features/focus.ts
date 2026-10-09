import * as vscode from 'vscode';
import { FocusTracker, type FocusState } from '../../core/focus/tracker';

export class Focus implements vscode.Disposable {
  private readonly tracker: FocusTracker;
  private readonly listeners: vscode.Disposable[] = [];
  private readonly interval: ReturnType<typeof setInterval>;
  private file?: string;
  private branch?: string;
  private writes = Promise.resolve();
  onUpdate: () => void = () => {};
  constructor(private readonly context: vscode.ExtensionContext, private readonly output: vscode.OutputChannel) {
    this.tracker = new FocusTracker(Date.now(), vscode.window.state.focused, context.globalState.get('focus.days'));
    const active = vscode.window.activeTextEditor?.document.uri;
    this.file = active?.scheme === 'file' ? active.toString() : undefined;
    const heartbeat = () => { this.tracker.heartbeat(Date.now()); this.onUpdate(); };
    this.listeners.push(
      vscode.workspace.onDidChangeTextDocument(event => { if (event.contentChanges.length && event.document.uri.scheme === 'file') { heartbeat(); } }),
      vscode.window.onDidChangeTextEditorSelection(heartbeat),
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor?.document.uri.scheme !== 'file') { return; }
        const next = editor.document.uri.toString();
        if (this.file && this.file !== next) { this.tracker.switchContext(Date.now()); }
        this.file = next; heartbeat();
      }),
      vscode.window.onDidChangeWindowState(state => { this.tracker.windowFocus(state.focused, Date.now()); this.persist(); this.onUpdate(); }),
      vscode.debug.onDidStartDebugSession(heartbeat), vscode.debug.onDidTerminateDebugSession(heartbeat),
      vscode.debug.onDidChangeActiveStackItem(heartbeat),
      vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('devpulse.focus')) { this.onUpdate(); } }),
    );
    this.interval = setInterval(() => { this.tracker.tick(Date.now()); this.persist(); this.onUpdate(); }, 5000);
  }
  getState(): FocusState {
    const settings = vscode.workspace.getConfiguration('devpulse.focus');
    const minutes = settings.get<number>('flowMinutes', 30);
    return this.tracker.state(Date.now(), Math.max(1, Math.min(240, minutes)) * 60_000, settings.get<boolean>('shield', true));
  }
  observeBranch(branch?: string): void {
    if (!branch || branch === this.branch) { return; }
    if (this.branch) { this.tracker.switchContext(Date.now()); }
    this.branch = branch;
  }
  private persist(): void {
    const snapshot = this.tracker.snapshot();
    this.writes = this.writes.then(() => this.context.globalState.update('focus.days', snapshot))
      .catch(() => this.output.appendLine('Could not save daily focus totals.'));
  }
  dispose(): void {
    clearInterval(this.interval); this.tracker.tick(Date.now()); this.persist();
    this.listeners.forEach(item => item.dispose());
  }
}
