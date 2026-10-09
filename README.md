# Gemma DevPulse
A local-first, self-hostable VS Code extension and Git pre-commit guard.

## Welcome and sync

Overview shows your branch status and a short summary of commits since the last
visit, including authors and changed files. The first visit establishes a baseline.
Only bounded, redacted commit metadata goes to Gemma; commit counts remain available
when the server is unavailable. Reload the same Development Host to test revisits.

**Git Pull & Sync** uses fast-forward only and refreshes the summary and reminders.
Save your edited files and commit or stash local changes first. Diverged branches
need manual reconciliation. Check the configured server and model with
`node dist/cli.js ping`; the diagnostic prints reachability and latency without
printing the endpoint or token.

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

## Editor highlights and suggestions

Run **DevPulse: Analyze File** on a saved file. Yellow, red and blue gutters
mark logic, security and context findings. Hover for the explanation, or open
the **Code** tab. **Apply Suggestion** appears when Gemma provides a precise
code replacement; the command palette also lets you choose one.

Review the redacted diff and confirm before applying. The edit supports Undo
and stays unsaved and unstaged. Changing the file clears its findings; changed
files and branches are checked again after confirmation. Save and re-analyze
to get current suggestions. Instruction-only suggestions and selection reviews
remain read-only. Use the Security view's **Fix** action for hardcoded credentials.

Gemma requests have a 30-second timeout. A reachable server can still be too
busy to finish analysis; Git status and regex secret verification keep working.

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
Security view and requested PR reviews are also implemented; other features remain placeholders.

```powershell
npm install
npm run build
npm run test:core
npm run test:security
npm run test:extension-security
npm run test:pr
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

F5, Ctrl+Shift+B and `npm run compile` use a fast development bundle. They do
not wait for type checking or linting; the editor and `npm run watch` can show
type diagnostics while you work. `npm run build` and `npm run package` run full
type and lint checks in parallel before producing the production bundle. Run
those checks before committing or packaging.

Open the inner `DevPulse` folder containing `package.json`, run `npm install`
once on each machine, and use VS Code 1.103 or newer. Terminal build tools need
Node 20.19+, 22.13+, or 24+; check `node --version` after updating PATH and
restarting your terminal. Node 12 cannot build this project. Press **Ctrl+Shift+B**
to run **devpulse: compile** using supported Node on PATH. F5 uses the same
compile task; **Run Extension** also runs its launcher with Node.
These tasks clear debugger injection variables. Using Code.exe as the Node
runtime stalled Windows launch checks. **Run Extension (Native Debugger)** remains
available for debugging, but the script launcher is the default because the native
Extension Host shut down during this machine's launch check.
Auto-detected **npm: compile** and npm watch tasks still require supported Node on
PATH. If TypeScript fails with **Unexpected token ?**, check node --version in
the failing terminal, upgrade Node (24+ is supported), and restart VS Code and
its terminals before retrying npm run compile.
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
    github/              Requested PRs, revisions and authenticated diff fetching
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

## Pull request reviews

Open a repository with a github.com HTTPS or SSH remote. In DevPulse's Overview
tab, choose **Connect GitHub** and use VS Code's GitHub sign-in. **Refresh PRs**
lists open PRs requesting your review in that repository (including team review
requests). Choose **Review with Gemma** on a PR to see per-file summaries,
severity-based risk and findings. Configure Gemma as described under Code review.
You can also run **DevPulse: Connect GitHub** or **DevPulse: Refresh Requested PRs**.

PR review uses the remote diff without checking out the branch or changing local
files. Finding links open the reviewed head revision on GitHub, so they do not
point at unrelated local code. No comments or reviews are posted to GitHub.
Reviews are cancellable; local code review and security remain available when
GitHub or Gemma is unavailable.

Results are cached in memory for up to 20 PR revisions, keyed by repository,
PR number, head/base SHAs and model configuration. Changed revisions are reviewed
again. Private/generated files, binaries, deletions and oversized files are
reported as skipped; partial reviews never imply the entire PR is safe. Limits
are 20 reviewable files, 24,000 characters per file, 80,000 total and 4 MB for the
GitHub response. PRs changing during analysis require another review.

GitHub Enterprise and remotes containing embedded credentials are not supported.
Use an ordinary github.com remote and VS Code authentication. The review list
is limited to GitHub Search's first 1,000 results and reports incomplete results.

Run **npm run test:pr** for an Extension Development Host fixture test of sign-in
states, requested PR loading, review results, cancellation and safe panel rendering.
It uses injected GitHub/model fixtures; live GitHub/Gemma verification requires
your account and a PR requesting your review.

## Inline autocomplete

Reload the Development Host, then run **DevPulse: Toggle Inline Autocomplete**
to opt in. Suggestions appear as ghost text; press Tab to accept or Escape to
dismiss. Only workspace files are eligible; environment/key files are excluded.
DevPulse sends up to 1,500 characters before and 500 after the cursor, with
secrets redacted before slicing. Edits, cancellation and superseding requests
discard stale suggestions. Requests share the LLM queue and stop after eight seconds.

Set `devpulse.assistant.inline.model` to an exact installed smaller model for
faster completions. On the tested server, `gemma4:e2b-it-q4_K_M` completed a
function signature in about 146 ms; the `gemma4:e2b` alias timed out. An empty
override uses the configured review/chat model. Server failure yields no
suggestion and leaves the editor and other features usable.

To pick models without editing JSON, reload the Development Host and open the
Command Palette (Ctrl+Shift+P):

- **DevPulse: Select Autocomplete Model** lists installed models. Choose
  `gemma4:e2b-it-q4_K_M` if available for the faster suggestions tested above.
- **DevPulse: Select Model (Review & Chat)** selects the model for other editor
  features. This explicit selection overrides the environment/.env model in
  VS Code; pre-commit CLI commands keep their usual configuration.
- Choose **Use configured model** to clear either override. Choices are saved
  per workspace, or in user settings when no workspace is open.

Selecting a model does not enable autocomplete: run **DevPulse: Toggle Inline
Autocomplete** to opt in, then type a function signature in a saved workspace file.
