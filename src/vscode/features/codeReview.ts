import * as vscode from 'vscode';
import { dirname, relative } from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { getBranchStatus, git, GitError } from '../../core/git/repo';
import { collectChanges, isSensitiveFile, safeFile, type ReviewInput } from '../../core/git/diff';
import { loadConfig } from '../../core/llm/config';
import { contentHash } from '../../core/llm/cache';
import { LlmError } from '../../core/llm/client';
import { analyze } from '../../core/review/analyze';
import { ReviewLimitError } from '../../core/review/chunks';
import { Highlights } from './highlights';
import { suggestionEdit } from '../../core/review/suggestion';
import { applySuggestion } from './applySuggestion';
import type { PanelMessage, ReviewState } from '../panel/messages';

export class CodeReview implements vscode.Disposable {
  readonly highlights: Highlights;
  private state: ReviewState = {
    phase: 'idle', message: 'Review your saved local changes with Gemma.', findings: [],
    summaries: [], skipped: [], offline: false, reviewedFiles: 0,
  };
  private operation?: AbortController;
  private applying = false;
  private snapshots = new Map<string, string>();
  private readonly subscriptions: vscode.Disposable[] = [];
  onUpdate: () => void = () => {};
  constructor(private readonly context: vscode.ExtensionContext, private readonly output: vscode.OutputChannel) {
    this.highlights = new Highlights(context.extensionUri, uri => this.markStale(uri));
    this.subscriptions.push(
      vscode.commands.registerCommand('devpulse.reviewChanges', () => this.review('changes')),
      vscode.commands.registerCommand('devpulse.analyzeFile', () => this.review('file')),
      vscode.commands.registerCommand('devpulse.reviewSelection', () => this.review('selection')),
      vscode.commands.registerCommand('devpulse.refreshBranch', () => this.refreshBranch()),
      vscode.commands.registerCommand('devpulse.cancelReview', () => this.operation?.abort()),
      vscode.commands.registerCommand('devpulse.applySuggestion', (id: unknown) => this.apply(id)),
      vscode.commands.registerCommand('devpulse.setApiKey', async () => {
        const key = await vscode.window.showInputBox({ prompt: 'Gemma server API key (leave empty to remove)', password: true, ignoreFocusOut: true });
        if (key === undefined) { return; }
        try {
          if (key.trim()) { await context.secrets.store('devpulse.llm.apiKey', key.trim()); }
          else { await context.secrets.delete('devpulse.llm.apiKey'); }
          void vscode.window.showInformationMessage('DevPulse API key updated.');
        } catch { output.appendLine('Could not update API key storage.'); }
      }),
    );
  }
  getState(): ReviewState { return this.state; }
  private update(patch: Partial<ReviewState>): void {
    this.state = { ...this.state, ...patch }; this.onUpdate();
  }
  private failure(error: unknown): string {
    return error instanceof LlmError || error instanceof GitError || error instanceof ReviewLimitError ? error.message : 'Could not complete the review. Check repository and LLM configuration.';
  }
  private async repository(): Promise<string | undefined> {
    if (!vscode.workspace.isTrusted) {
      this.update({ phase: 'failed', message: 'Trust this workspace to run Git and review code.' }); return undefined;
    }
    const active = vscode.window.activeTextEditor?.document.uri;
    const activeFolder = active?.scheme === 'file' ? vscode.workspace.getWorkspaceFolder(active) : undefined;
    if (activeFolder) { return activeFolder.uri.fsPath; }
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) { this.update({ phase: 'failed', message: 'Open a Git repository folder first.' }); return undefined; }
    const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Choose a repository to review' });
    return folder?.uri.fsPath;
  }
  async refreshBranch(): Promise<void> {
    if (this.operation) { return; }
    const cwd = await this.repository(); if (!cwd || this.operation) { return; }
    const operation = new AbortController(); this.operation = operation;
    this.update({ phase: 'checking', message: 'Checking branch and fetching upstream status…' });
    try {
      const branch = await getBranchStatus(cwd, true, operation.signal);
      if (this.state.branch && (branch.root !== this.state.branch.root || branch.head !== this.state.branch.head || branch.branch !== this.state.branch.branch)) {
        this.highlights.clear(); this.snapshots.clear();
        this.update({ findings: [], summaries: [], reviewedFiles: 0, skipped: [] });
      }
      this.update({ branch, phase: 'idle', message: branch.upstream
        ? `${branch.behind ? `${branch.behind} commit(s) behind upstream.` : 'Branch is up to date with upstream.'} ${branch.note ?? ''}`
        : branch.note ?? 'No upstream configured.' });
    } catch (error) {
      const message = operation.signal.aborted ? 'Branch check cancelled.' : this.failure(error);
      this.output.appendLine(message); this.update({ phase: 'failed', message });
    } finally { this.operation = undefined; }
  }
  async review(mode: 'changes' | 'file' | 'selection'): Promise<void> {
    if (this.operation) { return; }
    // Capture the editor before focusing the sidebar.
    const editor = vscode.window.activeTextEditor;
    const cwd = await this.repository(); if (!cwd || this.operation) { return; }
    const operation = new AbortController(); this.operation = operation;
    this.highlights.clear(); this.snapshots.clear();
    this.update({ phase: 'checking', message: 'Checking branch before review…', findings: [], summaries: [], skipped: [], reviewedFiles: 0, offline: false });
    void vscode.commands.executeCommand('devpulse.panel.focus').then(undefined, () => {});
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'DevPulse review', cancellable: true }, async (progress, token) => {
        const cancellation = token.onCancellationRequested(() => operation.abort());
        try {
          const branch = await getBranchStatus(cwd, true, operation.signal);
          if (!branch.branch) {
            this.update({ phase: 'failed', message: branch.note ?? 'Open a Git repository to review code.' });
            return;
          }
          this.update({ branch, message: branch.behind ? `Branch is ${branch.behind} commit(s) behind. Reviewing local changes against HEAD.` : 'Branch checked. Collecting changes…' });
          let inputs: ReviewInput[];
          let skipped: string[] = [];
          if (mode === 'changes') {
            ({ inputs, skipped } = await collectChanges(branch.root, Boolean(branch.head), operation.signal));
            const dirty = vscode.workspace.textDocuments.filter(document => document.isDirty && document.uri.scheme === 'file');
            for (const document of dirty) {
              const file = relative(branch.root, document.uri.fsPath).replace(/\\/g, '/');
              if (file.startsWith('..')) { continue; }
              inputs = inputs.filter(input => input.file !== file);
              skipped.push(`${file}: unsaved edits; save and review again`);
            }
          } else {
            if (!editor || editor.document.uri.scheme !== 'file') { throw new LlmError('Open a file in this repository first.'); }
            const file = relative(branch.root, editor.document.uri.fsPath).replace(/\\/g, '/');
            await safeFile(branch.root, file);
            if (isSensitiveFile(file)) { throw new LlmError('Private environment and key files are excluded from review.'); }
            const full = editor.document.getText();
            const selection = mode === 'selection' ? editor.selection : undefined;
            if (selection?.isEmpty) { throw new LlmError('Select some code to review first.'); }
            // Number selection lines in document coordinates without sending unrelated text.
            const start = selection ? selection.start.line + 1 : 1;
            const end = selection ? selection.end.line + (selection.end.character ? 1 : 0) : editor.document.lineCount;
            inputs = [{ file, content: selection ? editor.document.getText(selection) : full,
              lineCount: editor.document.lineCount, changedRanges: [{ start, end: Math.max(start, end) }], sourceHash: contentHash(full) }];
          }
          this.update({ skipped });
          if (!inputs.length) {
            this.update({ phase: 'complete', message: skipped.length ? 'No reviewable changes. See skipped files below.' : 'No local changes to review.' }); return;
          }
          let config;
          try {
            const settings = vscode.workspace.getConfiguration('devpulse.llm', vscode.Uri.file(branch.root));
            config = await loadConfig({ scriptDirectory: this.context.extensionPath + '/dist',
              settings: { baseUrl: settings.get<string>('baseUrl'), model: settings.get<string>('model'), jsonMode: settings.get<boolean>('jsonMode') },
              secretApiKey: await this.context.secrets.get('devpulse.llm.apiKey') });
          } catch { throw new LlmError('Could not load LLM configuration. Check your DevPulse .env or settings.'); }
          this.update({ phase: 'reviewing', message: `Reviewing ${inputs.length} file(s)…` });
          for (const [index, input] of inputs.entries()) {
            operation.signal.throwIfAborted();
            progress.report({ message: `${input.file} (${index + 1}/${inputs.length})`, increment: 100 / inputs.length });
            try {
              const result = await analyze(input, config, operation.signal, (part, total) => {
                const message = `Reviewing ${input.file}${total > 1 ? ` (part ${part}/${total})` : ''}…`;
                progress.report({ message });
                this.update({ message });
              });
              operation.signal.throwIfAborted();
              const uri = vscode.Uri.file(await safeFile(branch.root, input.file));
              const document = await vscode.workspace.openTextDocument(uri);
              if (contentHash(document.getText()) !== input.sourceHash) {
                this.update({ skipped: [...this.state.skipped, `${input.file}: changed during review; review again`] }); continue;
              }
              this.snapshots.set(uri.toString(), input.sourceHash!);
              // Partial selections lack complete line context, so keep their suggestions read-only.
              const findings = result.findings.map(finding => ({ ...finding,
                ...(mode !== 'selection' && !document.isDirty && suggestionEdit(document.getText(), finding)
                  ? { suggestionId: randomUUID() } : {}) }));
              this.highlights.set(uri, findings);
              this.update({ findings: [...this.state.findings, ...findings], reviewedFiles: this.state.reviewedFiles + 1,
                summaries: [...this.state.summaries, { file: input.file, text: result.summary || `${result.findings.length} finding(s).` }] });
            } catch (error) {
              if (operation.signal.aborted || (error instanceof LlmError && (error.offline || error.configuration))) { throw error; }
              const message = this.failure(error);
              this.output.appendLine(message);
              this.update({ skipped: [...this.state.skipped, `${input.file}: ${message}`] });
            }
          }
          if (branch.head && (await git(branch.root, ['rev-parse', 'HEAD'], operation.signal)).trim() !== branch.head) {
            this.highlights.clear(); this.snapshots.clear();
            this.update({ findings: [], summaries: [], reviewedFiles: 0 });
            throw new LlmError('Repository HEAD changed during review. Review again on the current branch.');
          }
          this.update({ phase: this.state.reviewedFiles ? 'complete' : 'failed', message: this.state.reviewedFiles
            ? `Reviewed ${this.state.reviewedFiles} file(s): ${this.state.findings.length} finding(s).${this.state.skipped.length ? ' Some files were skipped.' : ''}`
            : 'No files could be reviewed. See skipped files below.' });
        } finally { cancellation.dispose(); }
      });
    } catch (error) {
      const cancelled = operation.signal.aborted;
      const message = cancelled ? 'Review cancelled. Any results shown are partial.' : this.failure(error);
      this.output.appendLine(message);
      this.update({ phase: cancelled ? 'cancelled' : 'failed', message, offline: error instanceof LlmError && error.offline });
    } finally { this.operation = undefined; }
  }
  private async apply(id: unknown): Promise<void> {
    if (this.applying || this.operation) { return; }
    this.applying = true;
    try {
      if (id === undefined) {
        const choice = await vscode.window.showQuickPick(this.state.findings.filter(item => item.suggestionId)
          .map(item => ({ label: item.title, description: `${item.file}:${item.startLine}`, id: item.suggestionId })),
        { placeHolder: 'Choose a suggestion to preview' });
        id = choice?.id;
      }
      if (typeof id !== 'string') { return; }
      const finding = this.state.findings.find(item => item.suggestionId === id);
      const branch = this.state.branch;
      if (!finding || !branch) { return; }
      const uri = vscode.Uri.file(await safeFile(branch.root, finding.file));
      const hash = this.snapshots.get(uri.toString());
      if (!hash) { return; }
      const applied = await applySuggestion(finding, branch, hash,
        () => this.state.findings.includes(finding) && !this.operation);
      this.update({ message: applied ? 'Suggestion applied. Review the edit and save when ready.'
        : 'Suggestion not applied. If the file changed, save and review it again.' });
    } catch {
      this.output.appendLine('Could not apply this suggestion. Save and review the file again.');
      this.update({ message: 'Could not apply this suggestion. Save and review the file again.' });
    } finally { this.applying = false; }
  }
  private markStale(uri: vscode.Uri): void {
    const branch = this.state.branch; if (!branch) { return; }
    const file = relative(branch.root, uri.fsPath).replace(/\\/g, '/');
    const hadReview = this.state.summaries.some(summary => summary.file === file);
    this.snapshots.delete(uri.toString());
    this.update({ findings: this.state.findings.filter(finding => finding.file !== file),
      summaries: this.state.summaries.filter(summary => summary.file !== file),
      reviewedFiles: Math.max(0, this.state.reviewedFiles - (hadReview ? 1 : 0)),
      skipped: [...this.state.skipped.filter(item => !item.startsWith(`${file}:`)), `${file}: changed after review; review again`],
      phase: this.state.phase === 'reviewing' ? 'reviewing' : 'idle',
      message: 'Code changed after review. Review again for current findings.' });
  }
  async handle(message: PanelMessage): Promise<void> {
    if (message.type === 'reviewChanges') { await this.review('changes'); }
    else if (message.type === 'analyzeFile') { await this.review('file'); }
    else if (message.type === 'refreshBranch') { await this.refreshBranch(); }
    else if (message.type === 'cancelReview') { this.operation?.abort(); }
    else if (message.type === 'applySuggestion') { await this.apply(message.id); }
    else if (message.type === 'openFinding') {
      const finding = this.state.findings[message.index]; const root = this.state.branch?.root;
      if (!finding || !root) { return; }
      try {
        const uri = vscode.Uri.file(await safeFile(root, finding.file));
        const document = await vscode.workspace.openTextDocument(uri);
        // Detect external disk edits too; navigation must not use stale line numbers.
        const disk = await readFile(uri.fsPath, 'utf8');
        const hash = this.snapshots.get(uri.toString());
        if (!hash || contentHash(document.getText()) !== hash || (!document.isDirty && contentHash(disk) !== hash)) {
          this.highlights.clearFile(uri); this.markStale(uri); return;
        }
        const editor = await vscode.window.showTextDocument(document);
        const startLine = Math.max(0, Math.min(document.lineCount - 1, finding.startLine - 1));
        const endLine = Math.max(startLine, Math.min(document.lineCount - 1, finding.endLine - 1));
        const startPos = new vscode.Position(startLine, 0);
        const endPos = new vscode.Position(endLine, document.lineAt(endLine).text.length);
        editor.selection = new vscode.Selection(startPos, endPos);
        editor.revealRange(new vscode.Range(startPos, endPos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        this.highlights.pulseFinding(editor, finding);
      } catch { this.output.appendLine('Could not open this finding. The file may have moved.'); }
    }
  }
  dispose(): void {
    this.operation?.abort(); this.subscriptions.forEach(subscription => subscription.dispose()); this.highlights.dispose();
  }
}
