# AGENTS.md — Gemma DevPulse

Read this file fully before writing code. It is the source of truth for scope, architecture, conventions and priorities.

## 1. What this project is

**Gemma DevPulse** is a VS Code extension plus a Git pre-commit guard. It uses **Gemma 4** (open-source model) to reduce developer context-switching and to catch problems before they reach a commit.

- Local-first and self-hostable. The LLM endpoint is configurable: any OpenAI-compatible server (Ollama, llama.cpp server, vLLM). No closed cloud APIs.
- The Gemma server may run on a different machine than the editor and be reached over a forwarded port, so treat the endpoint as a remote, possibly slow, possibly unavailable HTTP service.
- Do not describe the product as "air-gapped" or "fully offline" in the UI, README or code comments. Use "local-first" and "self-hostable".

## 2. Features in priority order

Build in this order. A feature is done only when its acceptance criteria (section 7) pass in the Extension Development Host against `test-repo/`. Features 1–5 are the core; 6–9 build on top of them.

| # | Feature                                                         | Uses LLM?                      |
| - | --------------------------------------------------------------- | ------------------------------ |
| 1 | Welcome (startup panel + git sync status)                       | Light (summary)                |
| 2 | Where You Left Off (save-state + re-orient banner)              | Light (one-sentence summary)   |
| 3 | Reminder (behind remote, PRs awaiting review, uncommitted work) | No                             |
| 4 | Highlights (gutter colors + hover pop-ups in the editor)        | Yes                            |
| 5 | Pre-commit review and auto-fix (CLI hook + VS Code bridge)      | Regex first, LLM second        |
| 6 | PR review                                                       | Yes (reuses the engine from 4) |
| 7 | Code review (local diff / selection)                            | Yes (reuses the engine from 4) |
| 8 | Coding assistant (inline autocomplete + chat)                   | Yes                            |
| 9 | Focus timer (heartbeat tracking, flow badge)                    | No                             |

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
  startLine: number;       // 1-based
  endLine: number;
  severity: 'warning' | 'security' | 'context';   // yellow | red | blue
  title: string;           // <= 60 chars
  explanation: string;     // 1–3 sentences
  suggestion?: string;     // replacement code or a short instruction
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
