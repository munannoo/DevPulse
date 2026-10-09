import * as vscode from 'vscode';
import { dirname } from 'node:path';
import { gitPath, type BranchStatus } from '../../core/git/repo';

export function pullReminder(branch?: BranchStatus): string | undefined {
  if (!branch?.upstream || !branch.behind) { return undefined; }
  const freshness = branch.fresh ? '' : ' Counts use the last fetched upstream.';
  return branch.ahead
    ? `${branch.branch} has diverged: ${branch.behind} behind, ${branch.ahead} ahead. Reconcile the branches before pulling.${freshness}`
    : `${branch.branch} is ${branch.behind} commit(s) behind. Run git pull to catch up.${freshness}`;
}

export class PullReminder implements vscode.Disposable {
  private readonly listeners: vscode.Disposable[] = [];
  private readonly notified = new Set<string>();
  private readonly watched = new Set<string>();
  private readonly interval: ReturnType<typeof setInterval>;
  private debounce?: ReturnType<typeof setTimeout>;
  private disposed = false;
  constructor(private readonly refresh: () => Promise<void>, private readonly output: vscode.OutputChannel) {
    this.interval = setInterval(() => this.check(), 60_000);
    this.listeners.push(vscode.window.onDidChangeWindowState(state => { if (state.focused) { this.check(); } }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => { this.check(); void this.watchRepositories(); }));
    void this.watchRepositories();
  }
  private check(): void {
    if (!this.disposed && vscode.workspace.isTrusted) {
      void this.refresh().catch(() => this.output.appendLine('Could not refresh the pull reminder.'));
    }
  }
  private async watchRepositories(): Promise<void> {
    if (!vscode.workspace.isTrusted) { return; }
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (folder.uri.scheme !== 'file') { continue; }
      try {
        const directory = dirname(await gitPath(folder.uri.fsPath, 'HEAD'));
        if (this.disposed) { return; }
        if (this.watched.has(directory)) { continue; }
        this.watched.add(directory);
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(directory, '{HEAD,packed-refs,refs/**}'));
        const changed = () => { clearTimeout(this.debounce); this.debounce = setTimeout(() => this.check(), 2000); };
        this.listeners.push(watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed));
      } catch { /* A non-Git workspace has no pull reminder. */ }
    }
  }
  observe(branch?: BranchStatus): void {
    const message = pullReminder(branch);
    if (!message || !branch?.fresh || this.disposed) { return; }
    const issue = `${branch.root}\0${branch.branch}\0${branch.upstream}`;
    if (this.notified.has(issue)) { return; }
    this.notified.add(issue);
    void vscode.window.showInformationMessage(`DevPulse: ${message}`, 'Open DevPulse').then(action => {
      if (action) { void vscode.commands.executeCommand('devpulse.openPanel').then(undefined, () => {}); }
    }, () => {});
  }
  dispose(): void {
    this.disposed = true; clearInterval(this.interval); clearTimeout(this.debounce);
    this.listeners.forEach(item => item.dispose());
  }
}
