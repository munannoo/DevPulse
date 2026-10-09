# Gemma DevPulse
A local-first, self-hostable VS Code extension and Git pre-commit guard.

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
detected. This increment implements regex verification; optional Gemma risk
review and other product features remain scaffolded.

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
with the folder structure from `AGENTS.md`. The secret guard and Security view
are implemented; other feature modules remain placeholders.

```powershell
npm install
npm run build
npm run test:security
npm run test:extension-security
node dist/cli.js --help
```

Open this folder in VS Code and press F5. In the Extension Development Host,
open the DevPulse Security view. The watch task includes its own esbuild problem
matcher. Extension security tests use a disposable Git repository inside
`test-repo/` and your installed VS Code; set `VSCODE_EXECUTABLE_PATH` if needed.

**Run Extension** builds, opens an isolated Development Host, and attaches on
port 9333. This avoids the Windows Extension Host crash in VS Code's injected
debug launcher. Installed extensions are disabled in that development window.
Stopping the debugger detaches; close the Development Host window when finished.
Run `npm run watch` separately for automatic rebuilds while editing.

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
  test/                  Extension Host tests
media/                   Frontend HTML/CSS/JS, mascot, and gutter icons
test-repo/               Reserved for sample repository acceptance checks
esbuild.mjs              Builds dist/extension.js and dist/cli.js
```

`npm run watch` rebuilds bundles and watches TypeScript types. `npm run build`
runs type checking, linting, and a production build. Copy `.env.example` to
`.env` when implementing the LLM client; the scaffold does not load it yet.
