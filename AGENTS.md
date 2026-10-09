# AGENTS.md — Gemma DevPulse

Read this file before editing. It defines shared rules, backend architecture and feature requirements. Frontend presentation guidance lives in [GEMINI.md](GEMINI.md); read it when working on the UI.

## Project and scope

Gemma DevPulse is a local-first, self-hostable VS Code extension and Git pre-commit guard powered by Gemma through an OpenAI-compatible endpoint. The server may be remote, slow or unavailable. Describe the product as "local-first" and "self-hostable", never "air-gapped" or "fully offline".

- Implement only the assigned task. The roadmap is context, not authorization to build additional features.
- Inspect existing implementations first. Preserve teammate-owned work, staged changes and public interfaces.
- Make minimal integration changes in shared files; avoid unrelated refactors, formatting, dependencies and placeholders.
- Frontend work follows GEMINI.md. Backend tasks do not authorize a panel redesign.

## Architecture

Strict TypeScript; use the Node and VS Code versions declared in package.json. Prefer built-ins and plain fetch over heavy SDKs.

| Location | Responsibility |
| --- | --- |
| src/core/git/ | Repository status, ahead/behind, logs, working/staged diffs |
| src/core/llm/ | Configuration, HTTP client, prompts, schemas, queue, cache |
| src/core/security/ | Secret scanning, redaction, auto-fix |
| src/core/review/analyze.ts | Shared findings engine |
| src/vscode/features/ | VS Code feature orchestration |
| src/vscode/assistant/ | Inline completion and chat integration |
| src/vscode/panel/ | Webview providers and typed message protocol |
| src/cli/ | Hook installation, pre-commit and endpoint diagnostics |
| src/extension.ts | Activation and registration only |
| media/ | Frontend markup, styles, scripts and assets; see GEMINI.md |

Dependencies flow from src/vscode/ and src/cli/ into src/core/. Core and CLI must not import vscode; core must not access the DOM. The extension host owns Git, HTTP, filesystem, credentials, persistent state and editor edits. Webviews communicate through src/vscode/panel/messages.ts only.

- Keep modules small, use named exports and explain any unavoidable any.
- Register commands in package.json and code; reuse central command identifiers.
- Keep activation resilient: render the panel first, initialize features independently and run heavy work in the background.
- Use async I/O. Debounce frequent events; do not run expensive Git or LLM work on every editor heartbeat.
- Give Git/network calls timeouts, cancellation and error handling. Log sanitized technical failures to the DevPulse Output channel.
- Use argument arrays with execFile/spawn for Git. Encapsulate commands in the Git layer. Missing upstream is an expected state.
- Clear or mark analysis stale after document edits.

## LLM and security contract

Use one shared chat entry point and one analyze() engine for file, staged-diff, PR and local-change reviews. Feature code supplies input and consumes validated results; it must not duplicate model clients.

Configuration precedence, first match wins:

1. Process environment: DEVPULSE_LLM_BASE_URL, DEVPULSE_LLM_MODEL, DEVPULSE_LLM_API_KEY.
2. Nearest .env found walking up from the running script's directory.
3. VS Code settings, extension only: devpulse.llm.baseUrl and devpulse.llm.model.
4. Defaults: http://localhost:11434/v1 and gemma4:e4b.

Use a small built-in .env parser. Store user-entered API keys in ExtensionContext.secrets through DevPulse: Set API Key, never settings or workspace/global state. Commit only placeholder configuration in .env.example; ignore .env, node_modules, dist and *.vsix. Never commit real endpoint credentials or expose tokens, sensitive URLs, secret values or unredacted source/diffs in logs or panel state.

Request pipeline:

1. Extract the smallest useful context and redact detected secrets to `<REDACTED_SECRET>`.
2. Check a content-hash cache and use a bounded queue (concurrency 1–2).
3. POST to {baseUrl}/chat/completions; send Authorization: Bearer only when configured.
4. Apply AbortController timeout (30s default, 8s autocomplete) and honor cancellation.
5. Strip `<think>` blocks, parse JSON, validate and clamp the result.

- Request response_format: { type: "json_object" } where supported. Disable reasoning for structured calls where possible.
- Retry invalid JSON once with a repair prompt, then fail gracefully.
- Keep prompts in src/core/llm/prompts.ts with their expected response shape.
- Never send the entire repository. Use a file, selection, compact state digest or per-file diff as appropriate.
- Streaming SSE is for chat only. A smaller configured model such as gemma4:e2b may be used for autocomplete.
- An unavailable endpoint must leave Git sync, saved state, reminders, regex scanning and focus tracking operational.

Shared response: { "findings": Finding[] }, capped at about eight findings per call.

~~~ts
type Finding = {
  file: string;
  startLine: number; // 1-based
  endLine: number;
  severity: "warning" | "security" | "context";
  title: string; // <= 60 characters
  explanation: string; // 1–3 sentences
  suggestion?: string;
};
~~~

Reject malformed fields and unknown severities, bound text lengths, clamp line ranges and discard findings outside the relevant file/diff. Treat model text as untrusted; never turn it into arbitrary HTML or executable command links.

## Feature requirements

Implement assigned features in this priority order. Features 1–5 are the core; later work reuses their infrastructure. UI presentation and interaction checks are in GEMINI.md.

### 1. Welcome

On workspace open, fetch and collect branch, ahead/behind versus upstream and commits since workspaceState.lastSeenHead. Use git rev-list --left-right --count HEAD...@{u} and bounded commit metadata for a 2–3 sentence summary. Explicit pull actions use git pull --ff-only and report the result.
Acceptance: a behind-remote fixture reports the correct branch/count, changes since the last visit and a working pull action.

### 2. Where You Left Off

Persist active file, cursor line, branch, open files, available terminal shell-execution events and a compact diff digest in workspaceState. Debounce saves around two seconds; do not rely on deactivate(). Keep values bounded and serializable, and tolerate missing/moved files. Generate a one-sentence reorientation summary and navigate to the saved location on request.
Acceptance: reopening after an interrupted edit restores the correct file/line context and navigation.

### 3. Reminders

Use deterministic logic for behind-remote state, PR review requests, old uncommitted work and a missing hook. Recheck on a timer and window focus; at most one toast per issue per session.
Acceptance: repository changes update reminders without reloading.

### 4. Highlights

DevPulse: Analyze File sends a redacted file through analyze(). Provide severity decorations, hovers and an apply-suggestion command; trust only explicitly allowed DevPulse command URIs. Invalidate stale findings.
Acceptance: fixture issues show the correct line/severity and suggestions can be applied.

### 5. Pre-commit guard and auto-fix

Scan only added staged-diff lines for AWS/generic keys, JWT secrets, password-bearing DB URLs, private keys and pasted .env values. Ignore removed lines, context and metadata. Regex findings block commits. Optional redacted LLM review is time-boxed around ten seconds; endpoint failure alone must never block a commit.

CLI commands: node dist/cli.js precommit, init and ping. Ping reports reachability, model availability and latency without exposing the URL/token. Hook installation shares one implementation with the extension, uses an absolute CLI path, backs up and chains an existing hook, and handles paths with spaces and Git Bash on Windows. Prompts use /dev/tty or a platform-safe equivalent and handle non-interactive execution.

Write findings and timestamp to .git/devpulse/last-scan.json for the extension bridge. Auto-fix previews a diff and requires confirmation before replacing a literal with an environment lookup, updating .env/.gitignore and re-staging. Real secret values may only be written to the user's existing .env, never logs, prompts or scan JSON. Use WorkspaceEdit in the extension.
Acceptance: a fake staged key blocks the commit, appears in the extension, can be fixed with confirmation and then passes.

### 6. PR review

Authenticate with vscode.authentication.getSession('github', ['repo'], { createIfNone: true }); no custom OAuth, pasted PATs or manual token persistence. Query open review-requested PRs for the repository, fetch application/vnd.github.diff, analyze per file with bounded concurrency and cache by head SHA. Handle absent login/repository, rate limits and network failure gracefully. Never post GitHub comments automatically.
Acceptance: a requested PR can be reviewed with a summary and findings.

### 7. Local code review

DevPulse: Review My Changes analyzes working-tree and staged changes; DevPulse: Review Selection uses a selection with limited context. Check upstream status before reviewing and retain user control of pulling. Reuse analyze() and return change summaries plus line-specific findings.
Acceptance: changed fixture lines yield the expected review and editor navigation/highlights.

### 8. Coding assistant

Inline completions use registerInlineCompletionItemProvider, about 400ms debounce, cancellation, roughly 1500 characters before/500 after the cursor, about 64 output tokens, low temperature and prefix-hash caching. Strip fences/prose and gate with devpulse.assistant.inline.enabled.
Chat streams through the extension with explicit current-file/selection context toggles. Support Explain Selection, Fix Selection and Write Tests.
Acceptance: a signature yields a useful ghost completion and chat answers about explicitly included code.

### 9. Focus

Track editor/debug heartbeats passively, with about two minutes idle timeout and immediate pause on window focus loss. Flow begins after a configurable 30-minute continuous session. Track file/branch switches and window focus losses; persist daily totals in globalState. Flow Shield delays only DevPulse's own notifications.
Acceptance: activity increments time, idle pauses it and flow appears at the threshold.

## Development and verification

Open the repository containing package.json in VS Code. Use the supported Node version from package.json for terminal commands and F5. The checked-in build/launch helpers use node on PATH and launch VS Code in a separate Development Host; preserve that startup path.

| Action | Command |
| --- | --- |
| Install | npm install |
| Compile/watch | npm run compile / npm run watch |
| Production build | npm run build |
| Core tests | npm run test:core |
| Security tests | npm run test:security |
| Extension security tests | npm run test:extension-security |
| Endpoint check | node dist/cli.js ping |
| Install/test hook | node dist/cli.js init / node dist/cli.js precommit |
| Package | npx vsce package |

Feature completion requires the relevant acceptance check in the Extension Development Host against test-repo/ or a temporary repository, not compilation alone. Fixtures should cover behind-remote branches, a logic bug, fake secrets, unhandled fetch, selection review, a PR-sized diff and harmless code.

Test pure core behavior without VS Code; use temporary repositories for Git/CLI integration. For runtime changes, build and run relevant tests, then verify affected activation/UI behavior. Check offline/error handling, missing configuration/files and reopening when relevant. Documentation-only edits need link, consistency and diff checks.

Development should support explicit deterministic mock LLM fixtures (DEVPULSE_MOCK_LLM) and mock GitHub data for independent UI work. These are development requirements, not a claim that the modes already exist; inspect the implementation before using them. Never silently enable mocks in production. Before release, verify live integrations, hook installation, packaging and VSIX installation.

## Git workflow and reporting

1. Inspect git status --short, git diff and git diff --cached before editing. Preserve unrelated changes; never discard them with reset/checkout/clean.
2. Complete one coherent task and run the appropriate checks. Report failures honestly; do not fix unrelated problems without authorization.
3. Review the full diff for unintended changes and secrets. Stage explicit paths; use partial staging when files contain another contributor's work.
4. Create a separate conventional commit for each completed feature/task. Never commit incomplete work, amend another contributor's commit or change global Git identity.
5. Keep commits local. Push, open PRs or rewrite shared history only when explicitly instructed.
6. Report the result, changed files, verification, commit hash and any blockers. Stop when the assigned task is complete.
