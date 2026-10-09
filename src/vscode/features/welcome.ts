import * as vscode from 'vscode';
import { getCommitsSince, pullFastForward, PullBlockedError, type BranchStatus } from '../../core/git/repo';
import { relative } from 'node:path';
import { loadConfig } from '../../core/llm/config';
import { createLlm, LlmError } from '../../core/llm/client';
import { welcomePrompt } from '../../core/llm/prompts';
import { redact } from '../../core/security/redact';

export type WelcomeState = { loading: boolean; summary: string; changedCommits: number; offline: boolean; pulling: boolean; pullMessage?: string };
type Visit = { root: string; branch: string; head: string };

export class Welcome implements vscode.Disposable {
  private state: WelcomeState = { loading: false, summary: 'Open a Git repository to see your welcome summary.', changedCommits: 0, offline: false, pulling: false };
  private readonly visited = new Set<string>();
  private operation?: AbortController;
  private pullOperation?: AbortController;
  private disposed = false;
  onUpdate: () => void = () => {};
  constructor(private readonly context: vscode.ExtensionContext, private readonly output: vscode.OutputChannel) {}
  getState(): WelcomeState { return this.state; }
  private update(patch: Partial<WelcomeState>): void {
    if (!this.disposed) { this.state = { ...this.state, ...patch }; this.onUpdate(); }
  }
  async visit(branch: BranchStatus): Promise<void> {
    const identity = `${branch.root}\0${branch.branch}`;
    if (this.visited.has(identity) || this.disposed || this.state.pulling) { return; }
    this.visited.add(identity);
    this.operation?.abort();
    const operation = new AbortController(); this.operation = operation;
    this.update({ loading: true, offline: false, changedCommits: 0, summary: 'Checking changes since your last visit…' });
    try {
      if (!branch.head) { this.update({ summary: 'This repository has no commits yet.' }); return; }
      const previous = this.context.workspaceState.get<Visit>('devpulse.lastSeenHead');
      if (!previous || previous.root !== branch.root || previous.branch !== branch.branch) {
        this.update({ summary: `Welcome to ${branch.branch}. Your next visit will show what changed.` });
      } else {
        try {
          const changes = await getCommitsSince(branch.root, previous.head, branch.head, operation.signal);
          const fallback = changes.count ? `${changes.count} new commit(s) since your last visit.` : 'No new commits since your last visit.';
          this.update({ changedCommits: changes.count, summary: fallback });
          if (changes.count) {
            try {
              const settings = vscode.workspace.getConfiguration('devpulse.llm', vscode.Uri.file(branch.root));
              const config = await loadConfig({ scriptDirectory: this.context.extensionPath + '/dist',
                settings: { baseUrl: settings.get<string>('baseUrl'), model: settings.get<string>('model'), modelOverride: settings.get<string>('modelOverride'), jsonMode: settings.get<boolean>('jsonMode') },
                secretApiKey: await this.context.secrets.get('devpulse.llm.apiKey') });
              const summary = await createLlm(config).chat({ system: welcomePrompt, user: redact(changes.metadata),
                signal: operation.signal, timeoutMs: 15_000, maxTokens: 250, json: value => {
                  const text = (value as { summary?: unknown })?.summary;
                  if (typeof text !== 'string' || !text.trim()) { throw new Error('Invalid summary.'); }
                  return redact(text.trim()).slice(0, 600);
                } });
              if (!operation.signal.aborted) { this.update({ summary }); }
            } catch (error) {
              if (!operation.signal.aborted) {
                this.output.appendLine('Welcome summary unavailable; commit counts remain available.');
                this.update({ offline: error instanceof LlmError && error.offline, summary: `${fallback} Gemma summary unavailable.` });
              }
            }
          }
        } catch {
          if (!operation.signal.aborted) { this.update({ summary: 'Saved history is unavailable or has changed. This visit starts a new baseline.' }); }
        }
      }
      if (!operation.signal.aborted) { await this.context.workspaceState.update('devpulse.lastSeenHead', { root: branch.root, branch: branch.branch, head: branch.head }); }
    } catch { this.output.appendLine('Could not save the welcome visit.'); }
    finally { if (this.operation === operation) { this.update({ loading: false }); this.operation = undefined; } }
  }
  async pull(branch: BranchStatus, refresh: () => Promise<BranchStatus | undefined>): Promise<void> {
    if (this.state.pulling || this.disposed || !vscode.workspace.isTrusted) { return; }
    const unsaved = () => vscode.workspace.textDocuments.some(document => document.isDirty && document.uri.scheme === 'file' &&
      !relative(branch.root, document.uri.fsPath).startsWith('..'));
    if (unsaved()) { this.update({ pullMessage: 'Save your edited files before pulling.' }); return; }
    this.operation?.abort();
    const operation = new AbortController(); this.pullOperation = operation;
    this.update({ loading: false, pulling: true, pullMessage: 'Pulling with fast-forward only…' });
    try {
      const changed = await pullFastForward(branch, operation.signal, () => {
        if (unsaved()) { throw new PullBlockedError('Save your edited files before pulling.'); }
      });
      this.update({ pullMessage: changed ? 'Pulled successfully. Branch is up to date.' : 'Branch is already up to date.' });
      if (changed) { this.visited.delete(`${branch.root}\0${branch.branch}`); }
      const synced = await refresh();
      this.update({ pulling: false });
      if (changed && synced) { await this.visit(synced); }
    } catch (error) {
      const message = error instanceof PullBlockedError ? error.message : 'Pull failed or timed out. Check the remote and retry.';
      this.output.appendLine(message); this.update({ pullMessage: message });
    } finally { this.pullOperation = undefined; this.update({ pulling: false }); }
  }
  dispose(): void { this.disposed = true; this.operation?.abort(); this.pullOperation?.abort(); }
}
