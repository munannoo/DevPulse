# GEMINI.md — Gemma DevPulse Frontend

Read [AGENTS.md](AGENTS.md) first for shared scope, security, feature requirements and commit rules. This file owns frontend presentation guidance. Implement only the UI task assigned by the user; the roadmap below is not permission to redesign the whole extension.

## Ownership and current files

Use plain HTML/CSS/JavaScript and VS Code theme variables. Preact is acceptable only when justified; do not add a React build pipeline.

| Files | Responsibility |
| --- | --- |
| media/panel.html, panel.css, panel.js | Main DevPulse panel |
| media/security.css, security.js | Separate Security view |
| media/mascot.svg, media/icons/ | Mascot, activity and severity assets |
| src/vscode/panel/messages.ts | Shared typed request/state contract |
| src/vscode/panel/PanelProvider.ts | Main webview host |
| src/vscode/panel/SecurityPanelProvider.ts | Security webview host |

The current extension has separate main and Security views. Preserve both providers and their distinct scripts/message contracts. The tabbed layout below is the product direction, not a claim that every feature already exists. Do not merge views or activate unfinished tabs unless assigned.

Frontend owns rendering, button interactions, local view state and loading/error states. The extension host owns Git, GitHub, Gemma HTTP, credentials, filesystem, saved workspace data, editor navigation/edits, scans and tracking. Do not implement backend features to make a visual prototype work. Coordinate required shared-contract changes and keep them minimal.

## Layout and visual language

- One DevPulse Activity Bar container. Design for a roughly 360–420px webview that also works in a narrower sidebar and can be moved to the Secondary Side Bar.
- Editor: findings, hovers and completions. Panel: controls and explanations. Status bar: compact state such as branch, ahead/behind, PR count and flow.
- Target tabs: Overview, Code, Focus and Chat. Keep unsupported controls clearly disabled or absent.
- Overview contains Attention, Pull Requests, Where You Left Off and Security. Put actionable issues first; use collapsible sections. When clear, show "All clear" without nagging.
- Code shows active-file findings, suggestions, change summaries and recent changes.
- Focus shows today's activity, context switches and flow state.
- Chat shows messages, explicit context toggles and streaming responses.
- Use a small static mascot SVG in the header; reserve larger versions for welcome/all-clear states.
- Severity colors: yellow = logic/edge cases, red = security, blue = architectural context. Purple indicates interaction; green indicates all clear. Include text/icon labels so color is not the only signal.
- Use --vscode-* colors, short calm copy, readable spacing, keyboard-operable controls and visible focus states. Avoid alarming toasts for routine conditions.
- Describe the product as "local-first" and "self-hostable".

## Messages, state and safety

Use acquireVsCodeApi().postMessage() and the existing types in src/vscode/panel/messages.ts. Never invent ad-hoc messages or call privileged services from the webview.

- Main panel requests currently include ready, reviewChanges, analyzeFile, refreshBranch, cancelReview and openFinding with an index. Host updates use type: "state" with ReviewState.
- Security requests currently use scan, install and fix with a finding ID. Security updates use type: "security".
- PR requests use connectGitHub, refreshPullRequests, reviewPullRequest with a PR number, cancelPullReview and openPullFinding with an index. PR state is included in the main state update; finding links open the reviewed GitHub revision.
- Inspect the actual types before changing either side. Validate incoming requests in the host; ignore unknown types safely, with development logging.
- Send the main panel's ready message after installing its handlers. Preserve the host readiness callback used by development launch checks.
- Render consolidated host state rather than requesting many small data fragments. Future feature state may include welcome, leftOff, pullRequests, focus and chat; add fields only for assigned work.
- Keep CSP restrictions and nonce-based scripts. Use host-provided webview resource URIs.
- Treat model/source text as untrusted. Use textContent for plain text, safe markdown rendering where needed and no arbitrary HTML or model-supplied executable links.
- Never place credentials, unredacted secret values or tokens in DOM, webview state, messages or browser logs.

## Feature interactions

| Feature | Frontend behavior |
| --- | --- |
| Welcome | Branch and ahead/behind counts, 2–3 sentence changes summary, explicit Git Pull & Sync action with result |
| Where You Left Off | One-sentence banner naming file/line; click requests editor navigation |
| Reminders | Prioritized Attention items and compact status; updates without reload |
| Highlights | Severity gutters, subtle whole-line backgrounds, overview ruler and hovers with title/explanation/suggestion; coordinate editor integration with its owner |
| Security | Findings from staged scan, install-hook action and Fix action; preview and confirmation before applying edits |
| PR review | Title/author list, Review with Gemma action, progress, summary/risk and per-file findings |
| Code review | Upstream status before review; progress/cancellation, summaries, clickable findings, skipped files and empty state |
| Assistant | Explicit include-file/include-selection toggles; streamed markdown with Copy and Insert at cursor |
| Focus | Daily time, context switches and flow state; Flow Shield describes only DevPulse notifications |

Host-provided state determines whether actions are available. Do not simulate successful operations. Pulls, fixes and editor insertions must use the host's supported actions.

## Loading, offline and error states

Render the panel immediately; do not wait for fetch, GitHub or Gemma. Show section-level loading placeholders and update sections independently.

- A failed section must leave the rest usable.
- Show a small "Gemma offline" badge when appropriate. Git status, saved context, reminders, regex security and focus remain available.
- Distinguish no findings, no review yet, cancelled review and failed review.
- Provide calm messages for no repository/upstream, unavailable GitHub login, rate limits and network failures.
- Preserve user control of pulls and code changes; prevent duplicate submissions while an action is running.

## Frontend verification

Use the commands and Git workflow in AGENTS.md. For UI changes, launch with F5 and check:

- Main and Security views both load, with the main panel's readiness handshake intact.
- Narrow sidebar, light/dark themes, keyboard controls and focus visibility.
- Loading, empty, successful, cancelled, failed and offline states relevant to the task.
- Findings navigate to the right file/line and actions use the typed host protocol.
- Model text cannot inject HTML, script or arbitrary command links.
- Reopening restores appropriate state and new changes do not leave stale findings.

Use deterministic development fixtures when available to check rendering without live services. Do not claim mock results verify live integrations. Commit only the assigned, verified UI changes; leave teammate-owned backend work untouched.
