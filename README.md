# Gemma DevPulse
A local-first, self-hostable VS Code extension and Git pre-commit guard.

## Saved context and pull reminders

DevPulse saves editing context after about two seconds of inactivity. Reopening
the workspace shows a brief **Where You Left Off** banner; **Resume editing**
opens the saved file and line. Gemma can summarize the context, with a file/line
fallback when unavailable. To test in a Development Host, use **Developer: Reload
Window**: each new F5 launch uses a fresh profile with separate saved state.

If the branch is behind its upstream, **Attention** and the status bar explain
that a pull is needed. Checks run every minute, on window focus and after Git ref
changes. The reminder clears after catching up; diverged branches and failed
fetches receive distinct messages. Pulling remains an explicit user action.

## Pre-commit secret verification

Open your Git repository in the Extension Development Host (F5), then open
**DevPulse** in the Activity Bar. Choose **Install pre-commit hook** once.
You can also run **DevPulse: Install Pre-Commit Hook** from the Command Palette.

Stage your changes and commit normally. The guard scans only added staged lines
for possible API credentials, AWS keys, JWT secrets, password-bearing database
URLs, private-key headers and pasted environment values. A finding blocks the
commit and appears in the Security view and editor diagnostics. Existing hooks
are backed up and chained. Reinstalling the guard is safe.

Click **Fix** for supported standalone JavaScript/TypeScript literal assignments.
Review the redacted preview and choose **Apply fix**. DevPulse replaces the literal
with `process.env.NAME`, adds an empty `NAME=` entry to `.env` if missing, ignores
`.env`, saves the files and re-stages the source and `.gitignore`. Fill the value
in your local `.env` and ensure your application loads environment variables.
Existing `.env` values are preserved. The real credential is never copied to a
new file or included in the report, preview or console output.

Partially staged or unsaved files, tracked `.env` files and symlinks require
manual handling. Other credential locations offer manual-fix guidance. Verify
again after editing. Scanning is heuristic; it cannot guarantee all secrets are
detected. This increment implements regex verification; optional Gemma pre-commit risk
review remains scaffolded. LLM review of local changes is available separately.

Standalone use, after building:

```powershell
node /absolute/path/to/DevPulse/dist/cli.js init
node /absolute/path/to/DevPulse/dist/cli.js precommit
node /absolute/path/to/DevPulse/dist/cli.js fix <finding-id>
```

Run these commands from the repository to protect. CLI fixes require confirmation
through `/dev/tty`; use the VS Code fix action when that terminal is unavailable.
The installed hook uses absolute paths to Node and the built CLI; reinstall it
if you move the extension or Node installation.

## Development

Generated using the official `yo code` TypeScript/esbuild template and extended
with the folder structure from `AGENTS.md`. Branch checks, LLM code review, the
sidebar, and editor findings are implemented. The pre-commit secret guard and
Security view are also implemented; other features remain placeholders.

```powershell
npm install
npm run build
npm run test:core
npm run test:security
npm run test:extension-security
node dist/cli.js --help
```

Open this folder in VS Code and press F5. In the Extension Development Host,
open DevPulse in the Activity Bar for code review and security verification.
The watch task includes its own esbuild problem matcher. Extension security
tests use a disposable repository in `test-repo/` and your installed VS Code;
set `VSCODE_EXECUTABLE_PATH` if it is installed in a different location.

**Run Extension** builds and opens a fresh Development Host window without an
attached debugger. This avoids the Windows Extension Host crash in VS Code's
injected debug launcher. Installed extensions are disabled in that development
window. The launch task finishes while the window stays open; close the window
when finished. Each launch uses a separate profile under `.vscode-test/dev-hosts`.
Run `npm run watch` separately for automatic rebuilds while editing.

Open the inner `DevPulse` folder containing `package.json`, run `npm install`
once on each machine, and use VS Code 1.103 or newer. Terminal build tools need
Node 20.19+, 22.13+, or 24+; check `node --version` after updating PATH and
restarting your terminal. Node 12 cannot build this project. F5 uses `node` on
PATH for both the build and launcher. Using `Code.exe` as the Node runtime can
stall the compile task or debugger startup on Windows.
F5 opens a separate
Development Host; DevPulse is loaded there, rather than installed into your
original editor. The launcher now waits until DevPulse activates and its panel
is visible. If startup fails, the launch output includes the host's log folder.
Do not close the launch task while it is still waiting for readiness. You can
also open the panel with **DevPulse: Open Panel** in the Development Host.

Run `node --test scripts/launch-extension.test.mjs` to check launcher validation
and startup failure handling without opening VS Code.

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
  cli/index.ts           Hook installation, verification and confirmed fixes
  test/                  Core and Extension Host tests
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
`/chat/completions` route. Origin-only addresses automatically use `/v1`.
Explicit custom paths are preserved. A missing route/model or denied access
stops the review once and shows a configuration message.

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
lockfiles, and deleted files are skipped and reported. Limits: 20 files, 1 MB
per source file, 24,000 characters per request and 32 parts per file.
Large inputs are redacted first, then split into numbered parts with a little
boundary context. Progress shows the current part. There is no aggregate
80,000-character cutoff; results are merged and duplicate findings removed.
Only changed lines or deletion anchors receive diff findings.

Detected secrets are redacted before requests. Calls are serialized, cached for
five minutes, and time out after 30 seconds each. Review can be cancelled.
If Gemma is unavailable, branch information remains visible. Results are cleared
when an open document changes. Review suggestions are for manual use; the
Security view separately offers confirmed fixes for supported credentials.

Run `npm run test:core` for temporary local-Git and mock-HTTP tests covering
behind status, change collection, configuration, redaction, validation, retries,
caching, cancellation, and timeout handling. These do not contact your server.
Interactive Extension Development Host acceptance checks remain pending.
