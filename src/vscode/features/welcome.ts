import * as vscode from 'vscode';
import { getCommitsSince, type BranchStatus } from '../../core/git/repo';
import { loadConfig } from '../../core/llm/config';
import { createLlm, LlmError } from '../../core/llm/client';
import { welcomePrompt } from '../../core/llm/prompts';
import { redact } from '../../core/security/redact';

export type WelcomeState = { loading: boolean; summary: string; changedCommits: number; offline: boolean };
type Visit = { root: string; branch: string; head: string };

export class Welcome implements vscode.Disposable {
  private state: WelcomeState = { loading: false, summary: 'Open a Git repository to see your welcome summary.', changedCommits: 0, offline: false };
  private readonly visited = new Set<string>();
  private operation?: AbortController;
  private disposed = false;
  onUpdate: () => void = () => {};
  constructor(private readonly context: vscode.ExtensionContext, private readonly output: vscode.OutputChannel) {}
  getState(): WelcomeState { return this.state; }
  private update(patch: Partial<WelcomeState>): void {
    if (!this.disposed) { this.state = { ...this.state, ...patch }; this.onUpdate(); }
  }
  async visit(branch: BranchStatus): Promise<void> {
    const identity = `${branch.root}\0${branch.branch}`;
    if (this.visited.has(identity) || this.disposed) { return; }
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
                settings: { baseUrl: settings.get<string>('baseUrl'), model: settings.get<string>('model'), jsonMode: settings.get<boolean>('jsonMode') },
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
  dispose(): void { this.disposed = true; this.operation?.abort(); }
}
