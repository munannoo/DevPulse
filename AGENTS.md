# AGENTS.md — Gemma DevPulse

Read this file fully before writing code. It is the source of truth for scope, architecture, conventions and priorities.

## 1. What this project is

**Gemma DevPulse** is a VS Code extension plus a Git pre-commit guard. It uses **Gemma 4** (open-source model) to reduce developer context-switching and to catch problems before they reach a commit.

- Local-first and self-hostable. The LLM endpoint is configurable: any OpenAI-compatible server (Ollama, llama.cpp server, vLLM). No closed cloud APIs.
- The Gemma server may run on a different machine than the editor and be reached over a forwarded port, so treat the endpoint as a remote, possibly slow, possibly unavailable HTTP service.
- Do not describe the product as "air-gapped" or "fully offline" in the UI, README or code comments. Use "local-first" and "self-hostable".

## 2. Features in priority order

Build in this order. A feature is done only when its acceptance criteria (section 7) pass in the Extension Development Host against `test-repo/`. Features 1–5 are the core; 6–9 build on top of them.

| #   | Feature                                                         | Uses LLM?                      |
| --- | --------------------------------------------------------------- | ------------------------------ |
| 1   | Welcome (startup panel + git sync status)                       | Light (summary)                |
| 2   | Where You Left Off (save-state + re-orient banner)              | Light (one-sentence summary)   |
| 3   | Reminder (behind remote, PRs awaiting review, uncommitted work) | No                             |
| 4   | Highlights (gutter colors + hover pop-ups in the editor)        | Yes                            |
| 5   | Pre-commit review and auto-fix (CLI hook + VS Code bridge)      | Regex first, LLM second        |
| 6   | PR review                                                       | Yes (reuses the engine from 4) |
| 7   | Code review (local diff / selection)                            | Yes (reuses the engine from 4) |
| 8   | Coding assistant (inline autocomplete + chat)                   | Yes                            |
| 9   | Focus timer (heartbeat tracking, flow badge)                    | No                             |

Features 4, 6 and 7 share **one analysis engine** (`core/review/analyze.ts`): input is code or a diff, output is a validated JSON list of findings. They differ only in input source and where results render.

## 3. Tech stack

- TypeScript (strict), Node 20+.
- VS Code extension API (`vscode` engine `^1.90.0` or newer). Scaffold with `yo code` (TypeScript, esbuild). Package with `@vscode/vsce`.
- Git: `simple-git`, or spawn `git` via `child_process`.
- GitHub (PRs): `vscode.authentication.getSession('github', ['repo'], { createIfNone: true })`, then the GitHub REST API with `fetch`. No custom token handling.
- LLM: `POST {baseUrl}/chat/completions` (OpenAI-compatible) with plain `fetch`. No heavy SDK.
- Panel UI: `WebviewViewProvider` with plain HTML/CSS/JS (Preact is acceptable). Use VS Code theme variables (`--vscode-*`). No React build pipeline.
- Secret scanning: hand-written regex list.

### Model notes

- Default model tag: `gemma4:e4b`. A smaller tag (`gemma4:e2b`) can be used for inline autocomplete if latency is high.
- Gemma 4 supports structured JSON output. Prefer `response_format: { type: "json_object" }` where the server supports it, and always validate on our side.
- Strip any `<think>...</think>` content before parsing. Disable reasoning mode for structured calls if the server allows it.
- The server is shared by several users. Serialize requests with a small queue (`core/llm/queue.ts`, concurrency 1–2) and cache results by content hash.

## 4. Repository layout

```swift
devpulse/
├─ AGENTS.md
├─ LICENSE                    # MIT
├─ .env.example               # DEVPULSE_LLM_BASE_URL / MODEL / API_KEY placeholders
├─ .gitignore                 # must include .env, node_modules, dist, *.vsix
├─ README.md
├─ package.json               # extension manifest: commands, views, settings
├─ esbuild.mjs                # bundles extension.js AND cli.js
├─ src/
│  ├─ extension.ts            # activate()/deactivate(), wires features together
│  ├─ core/                   # NO `vscode` imports; shared with the CLI
│  │  ├─ llm/ config.ts  client.ts  prompts.ts  schemas.ts  queue.ts  cache.ts
│  │  ├─ git/ repo.ts  diff.ts          # status, ahead/behind, log, staged diff parser
│  │  ├─ security/ secretScan.ts  autofix.ts  redact.ts
│  │  └─ review/ analyze.ts             # findings engine (features 4, 6, 7)
│  ├─ vscode/
│  │  ├─ panel/ PanelProvider.ts  messages.ts
│  │  ├─ features/ welcome.ts  leftOff.ts  reminder.ts  highlights.ts
│  │  │            precommitBridge.ts  prReview.ts  codeReview.ts  focus.ts
│  │  ├─ assistant/ inlineCompletion.ts  chat.ts
│  │  └─ statusBar.ts
│  └─ cli/ index.ts           # `precommit` and `init` commands
├─ media/ panel.html  panel.css  panel.js  mascot.svg  icons/
└─ test-repo/                 # sample repo to develop and test against

```

Anything used by both the extension and the pre-commit CLI lives in `src/core/` and must not import `vscode`.

`test-repo/` should contain: a branch behind its remote, files with a planted complex-logic bug, a hardcoded fake key (e.g. `sk_test_FAKEKEY0000000000`), an unhandled `fetch` call, and a second branch with a small PR-sized diff.

## 5. UI architecture

```
Activity Bar:  one "DevPulse" icon -> opens the DevPulse view container
Right panel:   WebviewView (~360–420px); the user can drag it to the Secondary Side Bar
Editor:        intelligence lives here (gutter decorations, hovers, inline completions)
Status bar:    quick state only, e.g.  main ↓3 ↑0 | 2 PRs | ✦ In Flow

```

Principles:

- **Editor = intelligence. Right panel = control center. Status bar = quick state. Mascot = personality.**
- Panel tabs: **Overview | Code | Focus | Chat**.&#x20;
  - Overview: Attention, Pull Requests, Where You Left Off, Security.
  - Code: findings for the active file, suggestions, recent changes.
  - Focus: focus time, context switches, Flow Shield.
  - Chat: the assistant chatbot.
- Sections are collapsible and **priority-ordered**. If anything needs attention (security issue, behind remote, PR awaiting review), show an **Attention** section first. If everything is fine, show an **All clear** state and move other sections down. Do not nag.
- The mascot is a small static SVG in the header; a larger version only on the welcome and all-clear states.
- Color meaning: 🟡 yellow = complex logic or unhandled edge case, 🔴 red = security or leak, 🔵 blue = architectural context, 🟣 purple = interactive controls, 🟢 green = all clear.
- Webview <-> extension messages use a typed protocol defined once in `panel/messages.ts`. The webview HTML must set a CSP with a nonce.

## 6. LLM layer (`src/core/llm`)

Single entry point: `llm.chat({ system, user, json?: schema, signal, maxTokens })`.

- **Configuration** is resolved by one function, `loadConfig()` in `core/llm/config.ts`, used by both the extension and the CLI (the pre-commit hook runs outside VS Code and cannot read VS Code settings). Resolution order, first match wins:&#x20;
  1. Process environment: `DEVPULSE_LLM_BASE_URL`, `DEVPULSE_LLM_MODEL`, `DEVPULSE_LLM_API_KEY`.
  2. A `.env` file found by walking up from the running script's directory (`__dirname` of `dist/`), parsed with a tiny built-in parser (no `dotenv` dependency needed).
  3. VS Code settings (extension only): `devpulse.llm.baseUrl`, `devpulse.llm.model`. Contribute these in `package.json`.
  4. Defaults: base URL `http://localhost:11434/v1`, model `gemma4:e4b`.
- The API key/token may also be stored with `ExtensionContext.secrets` via the command `DevPulse: Set API Key`. Never put keys in settings.
- Commit `.env.example` with placeholders; `.env` is git-ignored. Never log the full base URL or any token.
- All LLM requests are made from the extension host or the CLI, never from the webview. Send the token as `Authorization: Bearer <token>` when set.
- Every call uses an `AbortController` with a timeout (30s default, 8s for autocomplete) and respects VS Code `CancellationToken`.
- If JSON parsing fails, retry once with a "return valid JSON only" repair prompt, then fail gracefully.
- Validate every structured response against a schema. Clamp line numbers to the file length and whitelist severities. Never trust model output.
- Streaming (SSE) is used only for the chat tab.
- **Graceful degradation:** if the endpoint is unreachable, all non-LLM features (git sync, left-off data, reminders, regex secret scan, focus tracker) keep working and the panel shows a small "Gemma offline" badge.
- **Privacy:** send only what is needed (selection, a file, or a diff), never the whole repo. The endpoint may be plain HTTP over the internet, so **run `redact.ts` first: replace detected secrets with `<REDACTED_SECRET>` before any text leaves the machine.**

### Findings schema (shared by highlights, code review, PR review, pre-commit)

```ts
type Finding = {
  file: string;
  startLine: number; // 1-based
  endLine: number;
  severity: "warning" | "security" | "context"; // yellow | red | blue
  title: string; // <= 60 chars
  explanation: string; // 1–3 sentences
  suggestion?: string; // replacement code or a short instruction
};
```

Prompts must demand JSON only: `{ "findings": Finding[] }`, capped at about 8 findings per call.

## 7. Feature specifications and acceptance criteria

### 1. Welcome

- On workspace open, collect: current branch, ahead/behind vs upstream (`git fetch`, then `git rev-list --left-right --count HEAD...@{u}`), and commits since the user's last visit.
- Store `lastSeenHead` per workspace in `workspaceState`. Run `git log <lastSeenHead>..HEAD` (authors, subjects, files) and ask Gemma for a 2–3 sentence "what changed while you were away".
- Render in the panel (not a modal) with a **Git Pull & Sync** button that runs `git pull --ff-only` and reports the result.
- **Done when:** opening `test-repo/` shows branch, "N commits behind", a Gemma summary of who changed what, and the pull button works.

### 2. Where You Left Off

- Save-state in `workspaceState`: active file, cursor line, branch, open files, recent terminal commands (via `window.onDidEndTerminalShellExecution` where available), and a digest of uncommitted changes (`git diff --stat` plus a trimmed diff).
- Save continuously (debounced \~2s on editor/selection/branch change), not only in `deactivate()`.
- On next activation, ask Gemma for one sentence, e.g. "You were editing `auth_controller.ts` (line 142), fixing the JWT expiration edge case." Show it as a panel banner. Clicking runs `goToLine` (open file, reveal and select the line).
- **Done when:** closing VS Code mid-edit and reopening shows a banner naming the right file and line, and the click navigates there.

### 3. Reminder

- Pure logic, no LLM. Surface in the Attention section and status bar: behind remote, PRs awaiting your review, old uncommitted changes, pre-commit hook not installed.
- Recheck on a timer and on window focus. At most one toast per issue per session.
- **Done when:** making the repo fall behind or adding an uncommitted change updates Attention without a reload.

### 4. Highlights

- Command `DevPulse: Analyze File`. Sends the (redacted) file to `analyze()` and renders findings.
- Use `createTextEditorDecorationType`: one type per severity with a colored gutter icon (small SVGs in `media/icons/`), a light `backgroundColor` with `isWholeLine: true`, and `overviewRulerColor`.
- `registerHoverProvider('*', ...)` returns a `MarkdownString` with title, explanation, suggestion and a command link (`command:devpulse.applySuggestion?...`). Mark it `isTrusted` only for our own command URIs.
- Clear or mark decorations stale on document change.
- **Done when:** a `test-repo/` file shows yellow, red and blue gutters, hover shows the pop-up, and applying a suggestion works.

### 5. Pre-commit review and auto-fix

Two layers:

1. **Regex (instant, always on):** scan only the added lines of the staged diff for AWS keys, generic API keys, JWT secrets, DB connection strings with passwords, private key blocks, and `.env`-style values pasted into code.
2. **LLM (optional, time-boxed \~10s):** send the redacted staged diff to `analyze()` for fatal risks (missing try/catch on async network calls, PII in logs, obvious runtime bugs). If Gemma is slow or down, skip with a warning and never block the commit because of it.

CLI: `node dist/cli.js precommit` (called by the hook), `node dist/cli.js init` (installs the hook) and `node dist/cli.js ping` (checks the LLM endpoint: prints reachable/unreachable, model found/missing, and round-trip time, never the URL or token). `.git/hooks/pre-commit` is a tiny shell script that execs the CLI by absolute path. If a hook already exists, back it up and chain to it. A non-zero exit blocks the commit. Prompts read from `/dev/tty` because hooks have no normal stdin.

**Auto-fix** for a hardcoded secret: replace the literal with `process.env.NAME` (or the language equivalent), append `NAME=` to `.env`, make sure `.env` is in `.gitignore`, and re-stage. Always show the diff and ask before applying. Never write the real secret value anywhere except the user's existing `.env`, and never into logs or prompts.

**VS Code bridge:** the CLI writes `.git/devpulse/last-scan.json` (findings + timestamp). The extension watches it (`workspace.createFileSystemWatcher`), renders red-gutter highlights and a panel Security section, and offers a **Fix** button applying the same auto-fix via `WorkspaceEdit`. Also add the command `DevPulse: Install Pre-Commit Hook`.

- **Done when:** committing a staged file with a fake key is blocked, the panel shows the red issue, one click fixes it, and the next commit passes.

### 6. PR review

- List PRs awaiting your review: `GET /search/issues?q=is:pr+is:open+review-requested:@me+repo:OWNER/REPO`.
- Panel list with title, author and a "Review with Gemma" button. Fetch the diff with `Accept: application/vnd.github.diff`, split per file, run `analyze()` per file with a concurrency limit and a progress notification.
- Show a PR summary (what it does, risk level) and findings per file. Cache by PR head SHA. Never post comments to GitHub automatically.
- **Done when:** a PR appears in the list and "Review with Gemma" returns a summary and findings.

### 7. Code review

- Same engine on local changes: `DevPulse: Review My Changes` (working tree + staged) and `DevPulse: Review Selection`.
- Output goes to highlights plus the Code tab, with a one-paragraph change summary.
- **Done when:** editing a `test-repo/` file and running the command highlights issues on the changed lines.

### 8. Coding assistant

- **Inline autocomplete:** `registerInlineCompletionItemProvider`. Debounce \~400ms, honor the cancellation token, send \~1500 chars before and \~500 after the cursor, `maxTokens` \~64, low temperature, strip code fences and prose from the output, cache by prefix hash. Gate it behind `devpulse.assistant.inline.enabled`.
- **Chat tab:** streaming chat in the panel with "include current file" and "include selection" toggles. Commands: `Explain Selection`, `Fix Selection`, `Write Tests`. Replies render as markdown with Copy and **Insert at cursor** buttons.
- **Done when:** typing a function signature yields a sensible multi-line ghost suggestion, and chat answers a question about the open file.

### 9. Focus timer

- Passive tracking, no manual timers. Count heartbeats from `onDidChangeTextDocument`, `onDidChangeTextEditorSelection`, active editor changes and debug activity. Idle threshold \~2 minutes. Pause when the window loses focus (`window.onDidChangeWindowState`).
- "Flow" = 30+ minutes of continuous activity (configurable). Show a status bar badge and a Focus tab with today's focus time and context-switch count (file/branch switches, window focus losses).
- Flow Shield only holds back DevPulse's own notifications until flow ends. It does not mute other apps.
- Persist daily totals in `globalState`.
- **Done when:** coding increments focus time, going idle stops it, and the badge appears after the threshold.

## 8. Conventions

- `strict: true`, no `any` without a comment. Small files, named exports.
- Every async call that touches git, the network or the LLM has error handling and a timeout. A failing feature logs to the "DevPulse" Output channel and shows a calm panel message; it must never crash `activate()`.
- `activationEvents: ["onStartupFinished"]`. Heavy work runs in the background after the panel renders, with loading skeletons.
- Never block the extension host: no sync `fs` or `child_process` in hot paths.
- Keep UI strings short and calm. No alarming toasts for non-critical states.
- Do not add dependencies casually. Prefer built-ins and justify each new dependency.
- Never commit secrets, endpoint URLs or tokens. Use `.env.example` and VS Code settings/secrets.
- Keep prompts in `core/llm/prompts.ts`, each with a comment describing the expected JSON shape.
- Make small, working changes. After each change, run `npm run build` and make sure the extension still launches.

## 9. Commands

```bash
npm install
npm run watch          # esbuild watch for extension + cli
# Press F5 in VS Code to launch the Extension Development Host, then open test-repo/
npm run build          # production bundle
npx vsce package       # produces devpulse-x.y.z.vsix
code --install-extension devpulse-*.vsix

```

## 10. Implementation & Development Guide

This section translates the feature specifications above into the intended implementation order, dependency boundaries, development workflow and testing expectations.

### 10.1 Core Architecture

The project has three execution layers:

```text
┌─────────────────────────────────────────────────────────────┐
│                     VS Code Extension                       │
│                                                             │
│  media/                                                     │
│  Webview frontend                                           │
│       ↕ postMessage()                                       │
│  src/vscode/                                                │
│  VS Code integration / feature orchestration                │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                         src/core/                           │
│                                                             │
│  Git      LLM      Security      Review                     │
│                                                             │
│  Pure TypeScript / Node-compatible code                     │
│  MUST NOT import vscode                                     │
└───────────────────────────┬─────────────────────────────────┘
                            │
                ┌───────────┴───────────┐
                ▼                       ▼
        Git repository          OpenAI-compatible
                                Gemma HTTP server
```

The CLI is a second consumer of `src/core/`:

```text
.git/hooks/pre-commit
        │
        ▼
dist/cli.js
        │
        ▼
src/cli/index.ts
        │
        ▼
src/core/*
```

Dependency direction:

```text
media/
  ↓
src/vscode/
  ↓
src/core/

src/cli/
  ↓
src/core/
```

Never introduce a dependency in the reverse direction.

Rules:

- `src/core/` must never import `vscode`.
- `src/core/` must not access the DOM.
- `media/` must not execute Git commands directly.
- `media/` must not call Gemma directly.
- `media/` communicates only through the typed message protocol.
- `src/vscode/` may import `vscode` and may call `src/core/`.
- `src/cli/` may call `src/core/`, but must not import `vscode`.
- `extension.ts` is a wiring/orchestration entry point, not a place for feature logic.
- `analyze.ts` is the shared review engine for all code-analysis features.

### 10.2 Frontend vs Extension Host

The Webview is the frontend.

Frontend files:

```text
media/panel.html
media/panel.css
media/panel.js
media/mascot.svg
media/icons/*
```

These are responsible for:

- rendering tabs
- rendering cards/sections
- button interactions
- local UI state
- displaying loading/error states
- sending typed requests to the extension
- rendering streamed chat responses

The extension host is responsible for:

- Git
- GitHub API
- Gemma HTTP requests
- filesystem access
- workspace state
- editor decorations
- hover providers
- commands
- terminal events
- focus tracking
- pre-commit bridge
- security scanning
- applying WorkspaceEdits

Never move privileged operations into the Webview merely because they are convenient to call from JavaScript.

### 10.3 Panel Communication

All Webview ↔ extension communication must use the typed protocol in:

```text
src/vscode/panel/messages.ts
```

Do not create ad-hoc message names throughout the project.

Example direction:

```text
Webview
  │
  │ { type: "analyzeFile" }
  ▼
PanelProvider
  │
  ▼
highlights.ts
  │
  ▼
core/review/analyze.ts
  │
  ▼
Gemma
```

And:

```text
Gemma
  ↓
Finding[]
  ↓
PanelProvider
  ↓
{ type: "state", state: ... }
  ↓
Webview
```

Every message must have a corresponding TypeScript type.

Unknown message types must be ignored safely and logged in development builds rather than crashing the panel.

### 10.4 Initial Project Bootstrap

The expected starting sequence on a new machine is:

```powershell
mkdir devpulse
cd devpulse

npx --package yo --package generator-code -- yo code
```

Select:

```text
New Extension (TypeScript)
```

Then:

```powershell
npm install
npm run build
```

Start the Extension Development Host with:

```text
F5
```

The first milestone is only:

```text
DevPulse Activity Bar icon
        ↓
DevPulse view
        ↓
Webview panel opens
```

Do not begin implementing AI analysis before the extension can launch reliably.

### 10.5 Development Environment

Create:

```text
.env.example
```

containing:

```env
DEVPULSE_LLM_BASE_URL=http://localhost:11434/v1
DEVPULSE_LLM_MODEL=gemma4:e4b
DEVPULSE_LLM_API_KEY=
```

Developers create their local environment with:

```powershell
copy .env.example .env
```

The actual `.env` file is never committed.

The LLM is not embedded into the extension. The extension sends HTTP requests to an OpenAI-compatible server exposing:

```text
POST {baseUrl}/chat/completions
```

The server may be local, on another machine, or reachable through a forwarded port.

Treat the server as:

- remote
- slow
- unavailable at times
- potentially unreachable
- not under the extension's control

The extension must still function when the server is unavailable.

### 10.6 Mock LLM Mode

Development MUST support a mock LLM mode so UI and feature development does not depend on a working remote Gemma server.

Add:

```env
DEVPULSE_MOCK_LLM=false
```

When enabled:

```text
llm.chat()
    ↓
fixture response
```

instead of:

```text
llm.chat()
    ↓
HTTP request
    ↓
Gemma
```

Mock mode should provide deterministic fixtures for:

- Welcome summary
- Where You Left Off summary
- Code findings
- PR findings
- Chat response
- optional autocomplete response

Mock mode must never be enabled silently in production builds.

This allows development of:

```text
gutter decorations
hover pop-ups
panel rendering
PR rendering
chat streaming UI
auto-fix UI
```

without requiring Gemma to be online.

### 10.7 Implementation Order

Build in dependency order rather than feature-number order when necessary.

Recommended sequence:

```text
1. Extension scaffold
2. Webview/panel
3. Git core
4. LLM configuration
5. LLM client
6. LLM queue/cache
7. Security redaction
8. Secret scanner
9. Finding schema/validation
10. Shared review engine
11. Welcome
12. Where You Left Off
13. Reminder
14. Highlights
15. Pre-commit CLI
16. Pre-commit VS Code bridge
17. PR review
18. Code review
19. Inline autocomplete
20. Chat
21. Focus
22. Packaging/documentation/polish
```

A later feature may be prototyped earlier, but the shared infrastructure above should remain the source of truth.

### 10.8 Build Checkpoints

After every meaningful implementation step:

```bash
npm run build
```

Then launch the Extension Development Host with F5.

A change is not considered integrated until:

1. the bundle succeeds;
2. the extension activates;
3. the affected feature does not crash activation;
4. existing features still work.

For core-only changes, also test the CLI when applicable.

### 10.9 Git Core API

`src/core/git/` should expose small, reusable functions instead of requiring callers to know raw Git commands.

Expected API surface should be approximately:

```text
getCurrentBranch()
getHead()
getUpstream()
getAheadBehind()
getStatus()
getRecentCommits()
getCommitsSince()
getDiff()
getStagedDiff()
getDiffStat()
getTrackedUncommittedFiles()
getUntrackedFiles()
```

Raw commands such as:

```bash
git branch --show-current
git rev-parse HEAD
git fetch --prune
git rev-list --left-right --count HEAD...@{u}
git log ...
git diff
git diff --cached
```

must remain encapsulated inside the Git layer.

No feature file should duplicate Git command construction.

### 10.10 Git Command Safety

Use `execFile`/argument arrays instead of building shell command strings when possible.

Prefer:

```text
git(args, cwd)
```

over:

```text
exec("git " + userInput)
```

All Git operations must:

- have a timeout;
- handle non-zero exit codes;
- distinguish expected conditions from real errors;
- avoid crashing the extension;
- log technical details to the DevPulse Output channel.

A missing upstream branch is an expected state and must not be treated as a fatal error.

### 10.11 LLM Request Pipeline

Every structured LLM operation should follow:

```text
Input
  ↓
minimal context extraction
  ↓
redact secrets
  ↓
cache lookup
  ↓
queue
  ↓
HTTP request
  ↓
timeout/cancellation
  ↓
strip <think>
  ↓
JSON parsing
  ↓
schema validation
  ↓
sanitize/clamp
  ↓
typed result
```

Never send raw repository content to the model without redaction.

Never assume valid model JSON merely because `response_format` was requested.

If parsing fails:

```text
attempt 1
  ↓
repair prompt
  ↓
attempt 2
  ↓
graceful failure
```

Do not retry indefinitely.

### 10.12 Context Minimization

Only send the smallest useful amount of code to Gemma.

Examples:

```text
Welcome:
  commits/authors/subjects/files

Where You Left Off:
  saved editor state + compact diff digest

Highlights:
  current file

Code Review:
  local diff

Selection Review:
  selection + limited surrounding context

Autocomplete:
  ~1500 chars before cursor
  ~500 chars after cursor

Chat:
  current file only when enabled
  selection only when enabled

PR Review:
  PR diff split per file
```

Never send the entire repository unless a future feature explicitly requires it and the privacy/security model is updated first.

### 10.13 Shared Finding Pipeline

Features 4, 5, 6 and 7 must use:

```text
core/review/analyze.ts
```

The preferred architecture is:

```text
source-specific input
        ↓
normalization
        ↓
redaction
        ↓
analyze()
        ↓
validated Finding[]
        ↓
feature-specific renderer
```

Feature-specific code should not contain separate model-review implementations.

Only the input source and output renderer should differ.

### 10.14 Finding Validation

`Finding[]` is untrusted external input even after parsing.

Validation must:

- reject malformed objects;
- whitelist severity;
- require non-empty title;
- cap title length;
- cap explanation length;
- cap the number of findings per request;
- clamp line numbers to the target file;
- discard findings pointing outside the relevant file/diff;
- prevent command injection through generated command links;
- avoid rendering arbitrary HTML from the model.

The Webview and Markdown renderer must treat model output as untrusted data.

### 10.15 Workspace State

Use `workspaceState` for workspace-specific information:

```text
lastSeenHead
leftOffState
last known branch
```

Use `globalState` for user-level persistent state:

```text
daily focus totals
focus history
```

Do not store secrets in either.

Use `ExtensionContext.secrets` for the LLM API key when the user sets one through:

```text
DevPulse: Set API Key
```

### 10.16 Where You Left Off State

Use an explicit model similar to:

```ts
type LeftOffState = {
  file: string;
  line: number;
  branch: string;
  openFiles: string[];
  terminalCommands: string[];
  diffStat: string;
  diffDigest: string;
  timestamp: number;
};
```

The exact representation may evolve, but all saved values must remain:

- bounded in size;
- JSON serializable;
- safe to restore after files disappear;
- safe to use when the workspace is reopened elsewhere.

If a previously open file no longer exists, the extension must show the saved state without crashing.

### 10.17 Webview State

The panel should receive a consolidated state object instead of requiring the frontend to request dozens of tiny pieces of information independently.

The panel state should conceptually contain:

```text
activeTab
gemmaOnline
attention
welcome
leftOff
pullRequests
securityFindings
codeFindings
focus
chat
```

The frontend renders state.

The extension owns state retrieval and privileged operations.

### 10.18 Webview Loading States

The panel must render immediately.

Do not wait for:

```text
git fetch
GitHub
Gemma
```

before showing the UI.

Initial state:

```text
loading
```

Then fill individual sections asynchronously.

Example:

```text
Overview
  Attention     loading...
  Git status    loading...
  Pull Requests loading...
  Security      loading...
```

A failure in one section must not prevent other sections from rendering.

### 10.19 "Gemma Offline" Behavior

When the LLM endpoint cannot be reached:

```text
Gemma offline
```

is shown as a small status badge.

The following MUST continue to function:

```text
Git sync
Where You Left Off persistence
Reminder logic
Secret regex scan
Pre-commit blocking
Focus tracking
Status bar
```

The panel should never become unusable just because Gemma is unavailable.

### 10.20 Pre-Commit Architecture

The pre-commit system consists of:

```text
.git/hooks/pre-commit
          ↓
dist/cli.js precommit
          ↓
src/cli/index.ts
          ↓
core/git
          ↓
core/security
          ↓
core/review (optional LLM)
```

The pre-commit path must first perform deterministic regex scanning.

LLM analysis is optional and time-boxed.

The decision rule is:

```text
Regex security finding
    ↓
BLOCK COMMIT

No regex security finding
    ↓
Optional Gemma review
    ↓
Gemma finding
    ↓
WARN / configured behavior

Gemma timeout/unavailable
    ↓
SKIP LLM
    ↓
DO NOT BLOCK solely because Gemma is unavailable
```

### 10.21 Staged Diff Rules

For pre-commit scanning, use the staged diff:

```bash
git diff --cached
```

Prefer:

```bash
git diff --cached --unified=0
```

for line-oriented processing.

Only added lines should be scanned for newly introduced secrets.

Removed lines, context lines and diff metadata must not be treated as newly committed code.

### 10.22 Pre-Commit Hook Installation

`DevPulse: Install Pre-Commit Hook` and:

```bash
node dist/cli.js init
```

must share the same underlying installation logic.

The hook must use an absolute path to the built CLI.

If an existing hook is present:

```text
existing pre-commit
       ↓
backup
       ↓
DevPulse hook
       ↓
DevPulse result
       ↓
chain previous hook
```

Do not silently overwrite another project's hook.

The implementation must work correctly when Git executes hooks through Git Bash on Windows.

Path handling must therefore be tested with:

- Windows paths containing spaces;
- Git Bash;
- PowerShell;
- macOS/Linux-style paths where applicable.

### 10.23 GitHub Integration

GitHub authentication must use the VS Code GitHub authentication session.

Do not ask users to paste a personal access token into DevPulse.

Do not create custom OAuth handling.

Do not persist GitHub tokens manually.

All GitHub API errors must degrade gracefully.

Examples:

```text
not logged in:
  "Connect GitHub to view review requests."

no upstream GitHub repository:
  hide/disable PR features

rate limited:
  show a calm status message

network unavailable:
  keep local features working
```

### 10.24 Security Rules for Auto-Fix

Auto-fix operations are high-trust operations.

Before applying a fix:

```text
show intended diff
       ↓
user confirms
       ↓
apply WorkspaceEdit
       ↓
update .env if needed
       ↓
ensure .env is gitignored
```

Never automatically replace a real credential without explicit user confirmation.

Never write a real credential into:

```text
logs
temporary JSON
chat messages
prompts
output channels
panel state
Git commit messages
```

### 10.25 CLI Input

Git hooks do not always have a normal interactive stdin.

Prompts requiring user confirmation must use:

```text
/dev/tty
```

or an equivalent platform-safe interactive mechanism.

The CLI must behave sensibly when no interactive terminal is available.

### 10.26 Focus Tracker State Machine

Focus tracking should use a small explicit state machine:

```text
INACTIVE
   ↓
ACTIVE
   ↓
IDLE
   ↓
ACTIVE

ACTIVE + enough continuous time
   ↓
FLOW
```

Window focus loss immediately ends active tracking.

DevPulse's own notifications can be queued during FLOW, but unrelated application notifications must never be intercepted.

### 10.27 Testing Strategy

The project should have three testing levels.

#### Unit tests

Test pure core functions independently:

```text
Git diff parsing
ahead/behind parsing
secret regex patterns
redaction
autofix transformations
Finding validation
line clamping
LLM response parsing
cache keys
configuration precedence
```

These tests should not require VS Code.

#### Integration tests

Test:

```text
test-repo
Git operations
CLI pre-commit
hook installation
last-scan.json
mock Gemma
```

Use temporary repositories where possible.

#### Extension Development Host tests

Use F5 and `test-repo/` to test:

```text
panel rendering
editor decorations
hover
commands
WorkspaceEdit
workspaceState
status bar
Webview message protocol
focus tracking
PR UI
```

### 10.28 Test Fixtures

`test-repo/` should intentionally contain deterministic fixtures for every important demo path.

Required examples:

```text
1. Branch behind remote
2. Complex logic bug
3. Hardcoded fake API key
4. Unhandled fetch()
5. A file suitable for selection review
6. A second branch containing a PR-sized diff
7. At least one harmless file that should produce no false-positive secret finding
```

Fixtures should be obvious enough that a developer can reproduce acceptance criteria without inventing new test data.

### 10.29 Mock GitHub Mode

PR UI should also have a development fixture mode where GitHub results can be rendered without requiring a live GitHub repository.

This is especially useful for:

```text
PR list UI
loading state
review progress
summary rendering
findings rendering
error states
```

Live GitHub integration must still be tested before release.

### 10.30 Extension Activation Safety

`activate()` must be resilient.

Each feature initializer should fail independently.

Conceptually:

```text
activate()
  ├── initialize panel
  ├── initialize Git features
  ├── initialize reminders
  ├── initialize highlights
  ├── initialize pre-commit bridge
  ├── initialize GitHub features
  ├── initialize assistant
  ├── initialize focus
  └── initialize status bar
```

A failure in one branch must not prevent the rest of the extension from activating.

### 10.31 Output Channel

Create a single:

```text
DevPulse
```

Output channel.

Log:

- Git command failures;
- LLM request failures;
- schema validation failures;
- GitHub API failures;
- hook installation problems;
- unexpected feature errors.

Do not log:

- API keys;
- GitHub access tokens;
- detected secret values;
- full unredacted source;
- full sensitive diffs.

### 10.32 Performance Rules

Avoid doing expensive work directly inside:

```text
onDidChangeTextDocument
onDidChangeTextEditorSelection
hover providers
inline completion providers
```

Use:

```text
debouncing
cancellation
small context windows
caching
request queues
timeouts
```

In particular:

- autocomplete must remain responsive;
- focus tracking must not perform expensive Git operations on every heartbeat;
- editor changes should invalidate stale findings rather than immediately re-run a full analysis;
- PR review should use bounded concurrency.

### 10.33 Stale Analysis

A finding can become invalid after a document changes.

When the analyzed document changes:

```text
existing findings
      ↓
mark stale / clear decorations
```

Do not leave old red/yellow/blue warnings attached to unrelated code after lines move.

### 10.34 Command Registration

All commands should be declared in `package.json` and registered in code.

Core commands:

```text
DevPulse: Analyze File
DevPulse: Review My Changes
DevPulse: Review Selection
DevPulse: Install Pre-Commit Hook
DevPulse: Set API Key
DevPulse: Apply Suggestion
```

Add command IDs centrally and reuse them for:

```text
commands
hover links
panel buttons
context actions
```

Do not duplicate command ID strings across unrelated files.

### 10.35 Hackathon Priority

If implementation time becomes limited, prioritize:

```text
Tier 1:
  Welcome
  Where You Left Off
  Reminder
  Highlights
  Pre-commit guard

Tier 2:
  PR Review
  Code Review

Tier 3:
  Chat
  Inline Autocomplete
  Focus
```

A stable Features 1–5 implementation is preferable to nine partially working features.

The strongest demo path is:

```text
Open repo
  ↓
DevPulse detects Git state
  ↓
Explains what changed while away
  ↓
Developer opens buggy code
  ↓
Highlights show issues in editor
  ↓
Developer attempts commit
  ↓
Secret guard blocks the commit
  ↓
DevPulse offers a fix
  ↓
Commit succeeds
  ↓
PR review finds additional issues
```

### 10.36 Definition of Implementation Complete

A feature is not considered complete merely because the code compiles.

For each feature, verify:

```text
Works on test-repo
Works with Gemma online
Works with Gemma offline where applicable
Handles Git errors
Handles missing configuration
Handles missing files
Does not crash activate()
Does not leak secrets
Renders correctly in the panel
Works after reopening VS Code
```

The feature's acceptance criteria in Section 7 remain the final authority.

### 10.37 Release Checklist

Before packaging a VSIX:

```text
□ npm run build
□ no TypeScript errors
□ extension launches with F5
□ test-repo acceptance checks pass
□ .env is ignored
□ no secrets in source
□ no real endpoint/token committed
□ mock LLM disabled for release
□ pre-commit hook installation tested
□ CLI ping tested
□ VSIX builds successfully
□ VSIX installs successfully in a clean Extension Development Host
```

Package with:

```bash
npx vsce package
```

The resulting `.vsix` must be treated as the demo/release artifact.

### 10.38 Suggested Milestones

Use these as practical checkpoints during development:

```text
M1 — Skeleton
  Extension loads + panel opens

M2 — Git
  Branch + ahead/behind + diff + log work

M3 — Gemma
  ping works + structured JSON works

M4 — Security
  Redaction + fake secret detection work

M5 — Core Demo
  Welcome + Left Off + Reminder

M6 — Editor Intelligence
  Analyze File + gutters + hover + fix

M7 — Commit Guard
  precommit + init + bridge + autofix

M8 — Collaboration
  PR review + local code review

M9 — Assistant
  autocomplete + chat

M10 — Polish
  focus + UX + packaging + README
```

Every milestone should end with:

```bash
npm run build
```

and a manual test in the Extension Development Host.

## 11. Quick Developer Reference

### Start development

```bash
npm install
npm run watch
```

Then press:

```text
F5
```

and open:

```text
test-repo/
```

### Build

```bash
npm run build
```

### Test Gemma

```bash
node dist/cli.js ping
```

### Test pre-commit manually

```bash
node dist/cli.js precommit
```

### Install hook

```bash
node dist/cli.js init
```

### Package

```bash
npx vsce package
```

### Main architecture

```text
VS Code
  ↓
src/vscode
  ↓
src/core
  ├── git
  ├── llm
  ├── security
  └── review

CLI
  ↓
src/core
```

### AI architecture

```text
input
  ↓
redact
  ↓
cache
  ↓
queue
  ↓
llm.chat()
  ↓
parse
  ↓
validate
  ↓
Finding[]
```

### Review architecture

```text
Highlights ─────┐
Pre-commit ─────┤
PR Review ──────┼──► analyze()
Code Review ────┘       │
                        ▼
                    Finding[]
```

### Frontend architecture

```text
panel.html
   +
panel.css
   +
panel.js
      ↕
messages.ts
      ↕
PanelProvider.ts
      ↕
features/*
```

The Webview is the presentation layer. The extension host owns all VS Code and privileged operations. `src/core/` owns reusable application logic.

## 12. Task Scope, Team Ownership, and Commit Discipline

These rules are mandatory for every AI coding agent working on Gemma DevPulse. They take priority over any temptation to implement additional features, refactor unrelated code, or make unsolicited improvements.

### 12.1 One Task at a Time — Strict Scope Control

**Implement only what the user explicitly requests in the current task.**

The feature roadmap in this document defines the overall project, not permission to implement every feature at once.

- Work on exactly one assigned feature or explicitly requested task at a time.
- Use the relevant feature specification and acceptance criteria in Section 7 as the requirements for that task.
- Do not begin implementing the next feature after completing the current one.
- Do not proactively implement adjacent features, even if their implementation appears straightforward or would be convenient.
- Do not add optional enhancements, extra commands, additional UI elements, speculative abstractions, or unrequested functionality.
- Do not perform unrelated refactoring, renaming, formatting, dependency upgrades, or bug fixes.
- Do not create placeholder implementations for future features unless explicitly requested.
- Do not expand the scope merely because you discover an opportunity to improve the product.

**Example:** If assigned to implement `src/core/security/redact.ts`, implement and test secret redaction only. Do not implement the secret scanner, auto-fix, pre-commit hook, Security panel, or other features unless the task specifically includes them.

When the assigned task is complete, stop. Report the result and wait for the next instruction rather than selecting another item from the roadmap.

If a requirement is genuinely ambiguous, make only the assumptions needed to complete the assigned task. Do not turn ambiguity into permission for broader changes.

### 12.2 Respect Team Ownership

Gemma DevPulse is a team project. Different contributors may own the frontend, individual features, shared infrastructure, or integrations.

**Do not do another contributor's work without explicit authorization.**

- If the user identifies a feature or files as belonging to another teammate, do not modify their implementation.
- Do not redesign, restyle, reorganize, or rewrite the frontend when assigned a backend or core feature.
- Do not implement another teammate's feature merely because your feature depends on it.
- Do not overwrite or undo work already present in the working tree.
- Do not reformat an entire file to make a small change.
- Do not replace existing implementations with your preferred architecture without an explicit requirement.

The intended boundaries are:

- `media/`: frontend markup, styles, client-side JavaScript, and visual assets.
- `src/vscode/features/`: individual VS Code feature implementations.
- `src/vscode/assistant/`: autocomplete and chat functionality.
- `src/vscode/panel/`: panel infrastructure and the shared UI message protocol.
- `src/core/`: shared Git, LLM, security, and review logic.
- `src/cli/`: CLI and pre-commit functionality.
- `src/extension.ts`: extension activation and feature registration.

These boundaries describe responsibilities, not automatic permission to modify every file in a folder. The current task determines which files may be changed.

#### Shared-file rule

Files such as `package.json`, `src/extension.ts`, `src/vscode/panel/messages.ts`, and `esbuild.mjs` may be necessary for integration.

Modify them only when required for the assigned task, and make the smallest possible change. Do not use an integration requirement as an excuse to implement another contributor's feature.

If another contributor's work prevents safe integration, explain the dependency and leave their implementation untouched. Prefer an interface or minimal integration change within the assigned scope.

### 12.3 Inspect the Repository Before Editing

Before changing any file:

1. Inspect `git status --short` to identify existing modifications and untracked files.
2. Inspect relevant source files and existing implementations.
3. Review applicable changes with `git diff` and `git diff --cached`.
4. Identify the files and interfaces necessary for the requested task.

Existing changes may belong to the user or another team member. They are not automatically part of the current task.

Never assume the working tree is clean.

Never discard existing work with commands such as `git reset --hard`, `git checkout -- .`, or `git clean` as a shortcut.

If the assigned feature already exists, inspect and test it before making changes. Do not rewrite working code unnecessarily.

### 12.4 Make Small, Modular Changes

Keep every implementation change focused on one independently testable responsibility.

- Prefer modifying the existing module responsible for the feature.
- Extract shared logic only when required by the assigned task.
- Avoid large rewrites when a small patch is sufficient.
- Avoid changing public interfaces unless required.
- Do not add dependencies without a clear, task-specific necessity.
- Do not combine unrelated cleanup with the feature implementation.
- Preserve existing conventions, behavior, and teammate-owned interfaces.

For example, implementing the LLM queue should not also redesign the panel, change GitHub authentication, or implement inline autocomplete.

A feature may require minimal supporting changes in shared files. Such changes are allowed only when necessary to build, register, or test the assigned feature.

### 12.5 Definition of Done for the Assigned Task

A task is complete when:

1. Its explicitly requested requirements are implemented.
2. The implementation follows the architecture and conventions in this document.
3. Relevant tests have been run, and appropriate tests have been added where practical.
4. `npm run build` succeeds when the project's build environment permits it.
5. Existing unrelated changes remain untouched.
6. The resulting diff contains only changes belonging to the assigned task.
7. Any limitations, failed tests, or unresolved dependencies are reported honestly.

Do not proceed to another feature to compensate for an incomplete acceptance criterion. Fix the current task or report the blocker.

If a test fails because of a pre-existing or unrelated problem, investigate only enough to establish whether the assigned change caused it. Do not fix unrelated problems without authorization.

### 12.6 Mandatory Commit Discipline

**After each completed, independently working feature or explicitly defined task, create a separate, focused Git commit.**

The objective is to maintain a clean, understandable project history in which changes can be reviewed, tested, reverted, and integrated independently.

#### Before implementation

Check:

```bash
git status --short
git diff
git diff --cached
```

Preserve existing working-tree and staged changes.

#### Before committing

1. Complete the assigned task.
2. Run `npm run build` and the relevant tests.
3. Review the complete diff for correctness and unintended changes.
4. Inspect the staged diff with `git diff --cached`.
5. Verify that the staged files and changes belong exclusively to the assigned task.
6. Ensure no secrets, `.env` files, tokens, credentials, or unintended generated artifacts are included.

#### Stage explicit files only

Use explicit paths:

```bash
git add src/core/security/redact.ts
git add src/core/security/redact.test.ts
```

Then review:

```bash
git diff --cached
```

Do not use `git add .` or `git add -A` by default. These commands may stage another contributor's unfinished work.

If a shared file contains both your changes and another contributor's changes, do not stage the entire file and accidentally include their work. Use carefully reviewed partial staging or leave the commit pending until the changes can be separated safely.

Never amend, rewrite, or delete another contributor's commits unless explicitly instructed.

#### Commit one task at a time

Use clear, conventional commit messages:

```bash
git commit -m "feat(git): add upstream status detection"
```

```bash
git commit -m "feat(security): add secret redaction"
```

```bash
git commit -m "feat(highlights): add editor findings"
```

Use `fix`, `test`, `refactor`, or `docs` instead of `feat` when appropriate.

Rules:

- Commit each completed feature separately.
- If a feature has multiple independently useful implementation steps, make small, coherent commits when each step is working and verified.
- Do not combine multiple unrelated features into one commit.
- Do not commit incomplete or knowingly broken work as a completed feature.
- Do not create empty commits.
- Do not commit another contributor's changes.
- Do not skip failing tests or claim verification that was not performed.
- If a clean commit cannot be made safely, explain why and leave unrelated work untouched.

If Git author identity is not configured, report the problem rather than changing the user's global Git configuration.

Commits should be local by default. **Never push, create a pull request, or rewrite shared branch history unless explicitly instructed.**

### 12.7 Security Before Every Commit

Before creating a commit:

- Review staged changes for hardcoded credentials, API keys, tokens, and other secrets.
- Ensure `.env` and other sensitive local configuration files are not staged.
- Ensure generated bundles or packaged extensions are included only when required by the project configuration or the explicit task.
- Never print secret values in logs or the final report.

If a potential real secret is discovered, do not copy it into logs, test fixtures, commit messages, or prompts. Handle it according to the security requirements in this document.

### 12.8 Final Report and Stop Condition

After the task, report:

- **Implemented:** what the assigned task now does.
- **Files changed:** the files modified for that task.
- **Verification:** build and tests run, including any failures.
- **Commit:** the commit hash and message, if committed.
- **Blockers:** unresolved problems or integration dependencies, if any.

Briefly mention any closely related work intentionally left untouched when that helps the team coordinate.

Do not start another feature, make extra improvements, or continue making repository changes after reporting completion. Wait for the user's next instruction.

### 12.9 Priority Rule

When deciding whether to make a change, apply this test:

1. Is the change explicitly requested by the user?
2. Is it required to complete the assigned task or its acceptance criteria?
3. Is it necessary for minimal integration, safety, or verification?

If the answer to all three is no, **do not make the change**.

When in doubt, preserve existing work and stay within scope. A small, correct, independently tested feature is preferable to a larger implementation that crosses team boundaries.

Setup on a new machine (Windows PowerShell shown; use `cp` on macOS/Linux):

```powershell
copy .env.example .env      # then fill in DEVPULSE_LLM_BASE_URL, DEVPULSE_LLM_MODEL, DEVPULSE_LLM_API_KEY
npm install
npm run build
node dist/cli.js ping       # must report the endpoint reachable and the model found

```

LLM endpoint smoke test:

```bash
curl -s $LLM_BASE_URL/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gemma4:e4b","messages":[{"role":"user","content":"Reply with the word pong"}]}'


```
