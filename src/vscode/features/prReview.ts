import * as vscode from 'vscode';
import { GitHubClient, GitHubError } from '../../core/github/client';
import { githubRepository, type GitHubRepository } from '../../core/github/repository';
import { PullReviewer } from '../../core/review/pullRequest';
import type { LlmConfig } from '../../core/llm/config';
import { loadEditorConfig as loadConfig } from '../configuration';
import { LlmError } from '../../core/llm/client';
import type { PanelMessage, PullRequestState } from '../panel/messages';

export const prCommands = {
  connect: 'devpulse.connectGitHub', refresh: 'devpulse.refreshPullRequests',
  review: 'devpulse.reviewPullRequest', cancel: 'devpulse.cancelPullReview',
} as const;
type Services = {
  now: () => number;
  session: (interactive: boolean) => Promise<{ accessToken: string } | undefined>;
  repository: (cwd: string, signal: AbortSignal) => Promise<GitHubRepository>;
  client: (token: string) => GitHubClient;
  config: (root: vscode.Uri) => Promise<LlmConfig>;
  reviewer: PullReviewer;
};

export class PullRequests implements vscode.Disposable {
  private state: PullRequestState = { phase: 'idle', message: 'Connect GitHub to view requested PR reviews.', items: [], truncated: false };
  private operation?: AbortController;
  private signingIn = false;
  private disposed = false;
  private nextAuto = 0;
  private failures = 0;
  private folder?: vscode.Uri;
  private readonly interval: ReturnType<typeof setInterval>;
  private readonly services: Services;
  private readonly subscriptions: vscode.Disposable[];
  onUpdate: () => void = () => {};
  constructor(context: vscode.ExtensionContext, private readonly output: vscode.OutputChannel, services: Partial<Services> = {}) {
    this.services = {
      now: Date.now,
      session: async interactive => vscode.authentication.getSession('github', ['repo'], interactive ? { createIfNone: true } : { silent: true }),
      repository: githubRepository, client: token => new GitHubClient(token), reviewer: new PullReviewer(),
      config: async root => {
        const settings = vscode.workspace.getConfiguration('devpulse.llm', root);
        return loadConfig({ scriptDirectory: context.extensionPath + '/dist', settings: {
          baseUrl: settings.get<string>('baseUrl'), model: settings.get<string>('model'), modelOverride: settings.get<string>('modelOverride'), jsonMode: settings.get<boolean>('jsonMode'),
        }, secretApiKey: await context.secrets.get('devpulse.llm.apiKey') }, root);
      }, ...services,
    };
    this.subscriptions = [
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.reset()),
      vscode.authentication.onDidChangeSessions(event => { if (event.provider.id === 'github' && !this.signingIn) { this.reset(); } }),
      vscode.window.onDidChangeWindowState(state => { if (state.focused) { void this.refreshAutomatically(); } }),
    ];
    this.interval = setInterval(() => { void this.refreshAutomatically(); }, 5 * 60_000);
  }
  registerCommands(): vscode.Disposable[] {
    return [
      vscode.commands.registerCommand(prCommands.connect, () => this.refresh(true)),
      vscode.commands.registerCommand(prCommands.refresh, () => this.refresh()),
      vscode.commands.registerCommand(prCommands.review, (number: unknown) => Number.isSafeInteger(number) && Number(number) > 0 ? this.review(Number(number)) : undefined),
      vscode.commands.registerCommand(prCommands.cancel, () => this.operation?.abort()),
    ];
  }
  getState(): PullRequestState { return this.state; }
  private update(patch: Partial<PullRequestState>): void { this.state = { ...this.state, ...patch }; this.onUpdate(); }
  private reset(): void {
    this.folder = undefined; this.nextAuto = 0;
    this.operation?.abort(); this.services.reviewer = new PullReviewer();
    this.update({ phase: 'idle', message: 'GitHub session or workspace changed. Refresh requested reviews.', repository: undefined, items: [], result: undefined, selected: undefined, truncated: false, offline: false });
  }
  private async workspace(background = false): Promise<vscode.WorkspaceFolder> {
    if (!vscode.workspace.isTrusted) { throw new GitHubError('Trust this workspace before reviewing pull requests.'); }
    const folders = vscode.workspace.workspaceFolders?.filter(folder => folder.uri.scheme === 'file') ?? [];
    if (!folders.length) { throw new GitHubError('Open a local GitHub repository first.'); }
    const active = vscode.window.activeTextEditor?.document.uri;
    const folder = (background && this.folder && vscode.workspace.getWorkspaceFolder(this.folder)) || (active && vscode.workspace.getWorkspaceFolder(active))
      || (background ? (folders.length === 1 ? folders[0] : undefined) : undefined)
      || (!background ? (folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Choose a repository for PR reviews' })) : undefined);
    if (!folder) { throw new GitHubError('No repository selected.'); }
    this.folder = folder.uri; return folder;
  }
  private error(error: unknown, signal: AbortSignal): void {
    if (signal.aborted) { this.update({ phase: 'cancelled', message: 'PR operation cancelled. Refresh or review again.' }); return; }
    const message = error instanceof GitHubError || error instanceof LlmError ? error.message : 'Could not review PRs. Check the repository and LLM configuration.';
    this.output.appendLine(message); this.update({ phase: 'failed', message, offline: error instanceof LlmError && error.offline });
  }
  async refreshAutomatically(): Promise<void> {
    if (this.disposed || this.operation || !vscode.workspace.isTrusted || this.services.now() < this.nextAuto) { return; }
    await this.refresh(false, true);
  }
  async refresh(interactive = false, background = false): Promise<void> {
    if (this.operation || this.disposed) { return; }
    const operation = new AbortController(); this.operation = operation;
    this.update({ phase: 'loading', message: 'Loading requested PR reviews…', ...(!background ? { items: [], repository: undefined, result: undefined, selected: undefined, truncated: false } : {}), offline: false });
    try {
      const folder = await this.workspace(background); operation.signal.throwIfAborted();
      let repository: GitHubRepository;
      try { repository = await this.services.repository(folder.uri.fsPath, operation.signal); }
      catch (error) { throw new GitHubError(error instanceof Error && /^(No GitHub remote|PR reviews currently)/.test(error.message) ? error.message : 'Could not identify this GitHub repository.'); }
      this.signingIn = interactive;
      let session: { accessToken: string } | undefined;
      try { session = await this.services.session(interactive); }
      finally { this.signingIn = false; }
      operation.signal.throwIfAborted();
      if (!session) { this.update({ phase: 'disconnected', repository, items: [], result: undefined, selected: undefined, message: 'Connect GitHub to view requested PR reviews.' }); return; }
      const list = await this.services.client(session.accessToken).requested(repository, operation.signal); operation.signal.throwIfAborted();
      const preserve = background && repository.owner === this.state.repository?.owner && repository.name === this.state.repository?.name && list.items.some(item => item.number === this.state.selected);
      this.update({ phase: 'ready', repository, ...list, ...(!preserve ? { result: undefined, selected: undefined } : {}), message: list.items.length ? `${list.items.length} PR(s) awaiting your review.${list.truncated ? ' Results are incomplete; narrow your search on GitHub.' : ''}` : 'No PRs currently request your review in this repository.' });
    } catch (error) { this.error(error, operation.signal); }
    finally {
      this.failures = this.state.phase === 'failed' ? Math.min(5, this.failures + 1) : 0;
      this.nextAuto = this.services.now() + (this.failures ? Math.min(30 * 60_000, 60_000 * 2 ** this.failures) : 30_000);
      this.operation = undefined;
    }
  }
  async review(number: number): Promise<void> {
    if (this.operation || !this.state.items.some(item => item.number === number) || !this.state.repository) { return; }
    const repository = this.state.repository;
    const operation = new AbortController(); this.operation = operation;
    this.update({ phase: 'reviewing', selected: number, result: undefined, offline: false, message: `Loading PR #${number}…` });
    try {
      const folder = await this.workspace();
      const actual = await this.services.repository(folder.uri.fsPath, operation.signal);
      if (actual.owner !== repository.owner || actual.name !== repository.name) { throw new GitHubError('Repository changed. Refresh requested reviews first.'); }
      const session = await this.services.session(false); operation.signal.throwIfAborted();
      if (!session) { this.update({ phase: 'disconnected', items: [], message: 'Connect GitHub to review this PR.' }); return; }
      let config: LlmConfig;
      try { config = await this.services.config(folder.uri); }
      catch { throw new GitHubError('Could not load LLM configuration. Check your DevPulse .env or settings.'); }
      const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `DevPulse PR #${number}`, cancellable: true }, async (progress, token) => {
        const cancellation = token.onCancellationRequested(() => operation.abort());
        try {
          return await this.services.reviewer.review(this.services.client(session.accessToken), repository, number, config, operation.signal,
            message => { progress.report({ message }); this.update({ message }); });
        } finally { cancellation.dispose(); }
      });
      operation.signal.throwIfAborted();
      this.update({ phase: 'complete', result, message: `Reviewed ${result.summaries.length} file(s): ${result.findings.length} finding(s).${result.skipped.length ? ` ${result.skipped.length} file(s) skipped; review is partial.` : ''}` });
    } catch (error) { this.error(error, operation.signal); }
    finally { this.operation = undefined; }
  }
  private async openFinding(index: number): Promise<void> {
    const { result, repository, selected } = this.state;
    const finding = result?.findings[index];
    if (!finding || !result || !repository || !selected) { return; }
    // Open the reviewed immutable remote revision, never unrelated local working-tree lines.
    const file = finding.file.split('/').map(encodeURIComponent).join('/');
    await vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${repository.owner}/${repository.name}/blob/${result.head}/${file}#L${finding.startLine}-L${finding.endLine}`));
  }
  async handle(message: PanelMessage): Promise<void> {
    if (message.type === 'connectGitHub') { await this.refresh(true); }
    else if (message.type === 'refreshPullRequests') { await this.refresh(); }
    else if (message.type === 'reviewPullRequest') { await this.review(message.number); }
    else if (message.type === 'cancelPullReview') { this.operation?.abort(); }
    else if (message.type === 'openPullFinding') { await this.openFinding(message.index); }
  }
  dispose(): void { this.disposed = true; clearInterval(this.interval); this.operation?.abort(); this.subscriptions.forEach(item => item.dispose()); }
}
