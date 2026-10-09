import * as vscode from 'vscode';
import { repositoryAttention, attentionItems, type AttentionItem } from '../../core/git/reminders';

export class Attention implements vscode.Disposable {
  private items: AttentionItem[] = [];
  private root?: string;
  private prs = 0;
  private operation?: AbortController;
  private pending = false;
  private disposed = false;
  private debounce?: ReturnType<typeof setTimeout>;
  private readonly notified = new Set<string>();
  private readonly listeners: vscode.Disposable[];
  private readonly interval: ReturnType<typeof setInterval>;
  onUpdate: () => void = () => {};
  constructor(private readonly context: vscode.ExtensionContext, private readonly output: vscode.OutputChannel, private readonly shielded: () => boolean) {
    const schedule = () => { clearTimeout(this.debounce); this.debounce = setTimeout(() => { void this.refresh(); }, 2000); };
    this.listeners = [vscode.window.onDidChangeWindowState(state => { if (state.focused) { void this.refresh(); } }),
      vscode.workspace.onDidSaveTextDocument(schedule), vscode.workspace.onDidCreateFiles(schedule),
      vscode.workspace.onDidDeleteFiles(schedule), vscode.workspace.onDidRenameFiles(schedule),
      vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('devpulse.reminders')) { schedule(); } })];
    this.interval = setInterval(() => { void this.refresh(); }, 60_000);
  }
  getState(): AttentionItem[] { return this.items; }
  observe(root: string | undefined, prs: number): void {
    if (root !== this.root) { this.operation?.abort(); this.items = []; this.root = root; this.onUpdate(); }
    this.prs = prs; void this.refresh();
  }
  async refresh(): Promise<void> {
    if (this.disposed || !vscode.workspace.isTrusted || !this.root) { return; }
    if (this.operation) { this.pending = true; return; }
    const root = this.root, operation = new AbortController(); this.operation = operation;
    try {
      const state = await repositoryAttention(root, operation.signal);
      const key = `devpulse.dirtySince:${root}`;
      let since = this.context.workspaceState.get<number>(key);
      if (since !== undefined && (!Number.isFinite(since) || since > Date.now())) { since = undefined; }
      if (state.dirty && since === undefined) { since = Date.now(); await this.context.workspaceState.update(key, since); }
      if (!state.dirty && since !== undefined) { await this.context.workspaceState.update(key, undefined); since = undefined; }
      operation.signal.throwIfAborted();
      const minutes = vscode.workspace.getConfiguration('devpulse.reminders', vscode.Uri.file(root)).get<number>('uncommittedMinutes', 1440);
      this.items = attentionItems(state, since, Date.now(), Math.max(1, Math.min(10080, minutes)), this.prs);
      this.onUpdate(); this.flush();
    } catch { if (!operation.signal.aborted) { this.output.appendLine('Attention check unavailable. Other features remain available.'); } }
    finally { this.operation = undefined; if (this.pending) { this.pending = false; void this.refresh(); } }
  }
  flush(): void {
    if (this.disposed || this.shielded()) { return; }
    for (const item of this.items) {
      const key = `${this.root}:${item.id}`; if (this.notified.has(key)) { continue; }
      this.notified.add(key); void vscode.window.showInformationMessage(`DevPulse: ${item.text}`);
    }
  }
  dispose(): void { this.disposed = true; this.operation?.abort(); clearInterval(this.interval); clearTimeout(this.debounce); this.listeners.forEach(item => item.dispose()); }
}
