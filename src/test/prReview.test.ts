import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { PullRequests } from '../vscode/features/prReview';
import { GitHubClient } from '../core/github/client';
import { PullReviewer } from '../core/review/pullRequest';
import { isPanelMessage } from '../vscode/panel/messages';
import { PanelProvider } from '../vscode/panel/PanelProvider';
import { LlmError } from '../core/llm/client';

const sha = 'a'.repeat(40); const base = 'b'.repeat(40);
const diff = 'diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-old\n+new\n';

suite('PR review in Extension Development Host', () => {
  test('connects only on request, reviews fixtures, cancels and preserves safe panel rendering', async function () {
    if (process.env.DEVPULSE_PR_FIXTURE !== '1') { this.skip(); }
    const output = vscode.window.createOutputChannel('DevPulse PR test');
    const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'devpulse');
    assert.ok(extension);
    let signedIn = false; let analysisCalls = 0;
    const interactive: boolean[] = [];
    // Only extensionPath is consumed because the config service is explicitly injected.
    const context = { extensionPath: extension.extensionPath } as vscode.ExtensionContext;
    const client = new GitHubClient('fixture-token', (async (url, init) => {
      if (String(url).includes('/search/issues?')) {
        return new Response(JSON.stringify({ total_count: 1, items: [{ number: 7, title: '<script>unsafe title</script>', user: { login: 'teammate' } }] }));
      }
      if ((init?.headers as Record<string, string>).Accept === 'application/vnd.github.diff') { return new Response(diff); }
      return new Response(JSON.stringify({ head: { sha }, base: { sha: base }, changed_files: 1 }));
    }) as typeof fetch);
    const prs = new PullRequests(context, output, {
        session: async requested => { interactive.push(requested); if (requested) { signedIn = true; } return signedIn ? { accessToken: ['fixture', 'token'].join('-') } : undefined; },
      repository: async () => ({ owner: 'team', name: 'project' }), client: () => client,
      config: async () => ({ baseUrl: 'http://localhost:11434/v1', model: 'fixture', jsonMode: true }),
      reviewer: new PullReviewer(async () => {
        analysisCalls++;
        return { summary: 'Changes behavior', findings: [{ file: 'app.ts', startLine: 1, endLine: 1, severity: 'warning', title: '<img onerror=alert(1)>', explanation: 'Check the edge case.' }] };
      }),
    });
    try {
      await prs.refresh(); assert.equal(prs.getState().phase, 'disconnected'); assert.deepEqual(interactive, [false]);
      await prs.refresh(true); assert.equal(prs.getState().phase, 'ready'); assert.equal(prs.getState().items[0].number, 7);
      await prs.review(999); assert.equal(analysisCalls, 0);
      await prs.review(7); assert.equal(prs.getState().phase, 'complete'); assert.equal(prs.getState().result?.risk, 'warning');
      await prs.review(7); assert.equal(analysisCalls, 1, 'Revision cache is reused');
      assert.equal(isPanelMessage({ type: 'reviewPullRequest', number: '../outside' }), false);
      assert.equal(isPanelMessage({ type: 'openPullFinding', index: -1 }), false);
      assert.equal(isPanelMessage({ type: 'reviewPullRequest', number: 7 }), true);

      // Render through the real panel assets inside a VS Code webview and assert DOM safety.
      const panel = vscode.window.createWebviewPanel('devpulse-pr-fixture', 'PR review fixture', vscode.ViewColumn.One, { enableScripts: true });
      const subscriptions: vscode.Disposable[] = [];
      const provider = new PanelProvider(extension.extensionUri, () => ({ phase: 'idle', message: 'Fixture', findings: [], summaries: [], skipped: [], offline: false, reviewedFiles: 0, pullRequests: prs.getState() }), async () => {}, output);
      const receive = panel.webview.onDidReceiveMessage.bind(panel.webview);
      try {
        const ready = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('PR webview did not render safely')), 30_000);
          subscriptions.push(receive(message => {
            if (message.type === 'prFixtureRendered') {
              clearTimeout(timeout);
              try {
                assert.equal(message.buttons, 1); assert.equal(message.findings, 1);
                assert.equal(message.injected, 0); assert.ok(message.text.includes('<script>unsafe title</script>'));
                resolve();
              } catch (error) { reject(error); }
            }
          }));
        });
        // Adapt the WebviewPanel lifecycle to the provider's WebviewView surface.
        const view = { webview: panel.webview, visible: true, onDidChangeVisibility: new vscode.EventEmitter<void>().event, onDidDispose: panel.onDidDispose } as unknown as vscode.WebviewView;
        await provider.resolveWebviewView(view);
        const marker = /nonce="([a-f0-9]+)"/.exec(panel.webview.html)?.[1]; assert.ok(marker);
        // A fixture-only observer uses the existing nonce and never changes production assets.
        panel.webview.html = panel.webview.html.replace('</body>', `<script nonce="${marker}">window.addEventListener('message', () => setTimeout(() => vscode.postMessage({type:'prFixtureRendered', buttons:document.querySelectorAll('#pr-list button').length, findings:document.querySelectorAll('#pr-result article').length, injected:document.querySelectorAll('#pr-list script, #pr-result img').length, text:document.getElementById('pr-list').textContent}), 0));vscode.postMessage({type:'ready'});</script></body>`);
        panel.reveal(vscode.ViewColumn.One);
        await ready;
      } finally { subscriptions.forEach(item => item.dispose()); provider.dispose(); panel.dispose(); }

      // A fresh reviewer ensures cancellation reaches analysis rather than a cached result.
      let failOffline = false;
      const fresh = new PullRequests(context, output, {
        session: async () => ({ accessToken: 'fixture' }), repository: async () => ({ owner: 'team', name: 'project' }), client: () => client,
        config: async () => ({ baseUrl: 'http://localhost:11434/v1', model: 'fixture', jsonMode: true }),
        reviewer: new PullReviewer(async (_input, _config, signal) => {
          if (failOffline) { throw new LlmError('Gemma offline', true); }
          setTimeout(() => { void fresh.handle({ type: 'cancelPullReview' }); }, 10);
          await new Promise<void>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
          return { summary: '', findings: [] };
        }),
      });
      try {
        await fresh.refresh(); await fresh.review(7); assert.equal(fresh.getState().phase, 'cancelled'); assert.equal(fresh.getState().result, undefined);
        failOffline = true; await fresh.review(7); assert.equal(fresh.getState().phase, 'failed'); assert.equal(fresh.getState().offline, true);
      }
      finally { fresh.dispose(); }
      signedIn = false; await prs.refresh(); assert.equal(prs.getState().phase, 'disconnected'); assert.equal(prs.getState().result, undefined);
    } finally { prs.dispose(); output.dispose(); }
  });
});
