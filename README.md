# DevPulse
a coding assistant that reads new changes to github commits, analyses PRs, and more.

## Development

Generated using the official `yo code` TypeScript/esbuild template and extended
with the folder structure from `AGENTS.md`. Branch checks, LLM code review, the
sidebar, and editor findings are implemented. Other features, including Git
hooks, remain placeholders.

```powershell
npm install
npm run build
node dist/cli.js --help
```

Open this folder in VS Code and press F5. In the Extension Development Host,
run **DevPulse: Hello World** from the Command Palette. Install the recommended
esbuild problem matcher extension if VS Code prompts for it.

```text
.vscode/                 Debug launch configuration and build tasks
src/
  extension.ts           VS Code activation entry point
  core/                  Shared logic; no vscode imports
    llm/                 Configuration, client, prompts, schemas, queue, cache
    git/                 Repository status and diff parsing
    security/            Secret scanning, redaction, and fixes
    review/              Shared findings engine
  vscode/
    panel/               Webview provider and message protocol
    features/            Welcome, left-off, reminders, reviews, focus, bridge
    assistant/           Inline completion and chat
    statusBar.ts         Status bar integration
  cli/index.ts           Standalone CLI entry point
  test/                  Generated extension test starter
media/                   Frontend HTML/CSS/JS, mascot, and gutter icons
test-repo/               Reserved for sample repository acceptance checks
esbuild.mjs              Builds dist/extension.js and dist/cli.js
```

`npm run watch` rebuilds bundles and watches TypeScript types. `npm run build`
runs type checking, linting, and a production build.

## Code review

Copy `.env.example` to `.env` in this extension project and enter your server's
base URL, exact installed model ID, and optional API key. Configuration resolves
per value from process environment, the nearest `.env` above `dist/`, VS Code
settings, then defaults. Alternatively set `devpulse.llm.baseUrl` and
`devpulse.llm.model`, and use **DevPulse: Set API Key** for secret storage.
Never put an API key in settings. Requests use the OpenAI-compatible
`/chat/completions` route; include `/v1` in the base URL when your server requires it.

Press F5, open the Git repository you want to review in the Development Host,
and choose **DevPulse: Review My Changes**. The DevPulse activity-bar view shows
upstream ahead/behind counts and per-file review summaries. Its Code tab lists
findings; click a finding to navigate, or hover the colored editor gutters.
**DevPulse: Analyze File** and **DevPulse: Review Selection** review editor text,
including unsaved edits. Suggestions are displayed for manual use.

Each review fetches the current branch's remote before comparing with its
upstream. Fetch failure falls back to clearly marked last-fetched counts.
Detached branches and branches without an upstream can still be reviewed.
Review does not pull, push, or edit files automatically.

Local-change review covers the net saved working-tree changes against HEAD
(including staged edits) and untracked files. Staged edits subsequently undone
in the working tree are therefore not reviewed separately. Unsaved files are
skipped until saved. Private environment/key files, binary files, generated
lockfiles, and deleted files are skipped and reported. Limits: 20 files, 64 KB
per source file, 24,000 characters per request, 80,000 per changes review.
Only changed lines or deletion anchors receive diff findings.

Detected secrets are redacted before requests. Calls are serialized, cached for
five minutes, and time out after 30 seconds each. Review can be cancelled.
If Gemma is unavailable, branch information remains visible. Results are cleared
when an open document changes. There are no automatic code fixes in this version.

Run `npm run test:core` for temporary local-Git and mock-HTTP tests covering
behind status, change collection, configuration, redaction, validation, retries,
caching, cancellation, and timeout handling. These do not contact your server.
Interactive Extension Development Host acceptance checks remain pending.
