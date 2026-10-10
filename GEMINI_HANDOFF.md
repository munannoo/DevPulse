# DevPulse handoff to Gemini

Prepared October 10, 2026. Read `AGENTS.md` and `GEMINI.md` before editing.
This is a handoff, not permission to implement every suggested feature at once.

## What the user wants

- Finish useful extra features completely, including their controls and error states.
- Keep the design compact, readable and compatible with VS Code themes.
- **Commit frequently: one small, verified feature or fix per commit.** Do not
  accumulate several features into a 200–300-line commit.
- Verify and scan staged changes before committing. Keep commits local unless
  the user explicitly requests a push or PR.
- Do not restart or discard the existing work.

## Already implemented

The nine roadmap features have implementations: welcome and fast-forward sync,
saved editing context, reminders, editor findings/suggestions, secret guard and
confirmed fixes, requested PR review, local/selection review, autocomplete/chat,
and passive focus tracking. Implementation does not mean every live acceptance
check is complete.

Other implemented work includes separate model selection for autocomplete and
review/chat, AI commit descriptions and analysis, bounded response caching, and
a command to clear the cache.

Recent completed commits:

| Commit | Work |
| --- | --- |
| `de19aea` | Old-work, missing-hook and requested-PR reminders |
| `f3c574a` | Automatic requested-PR refresh, throttling and backoff |
| `f3f1ff3` | Optional ten-second AI pre-commit risk analysis |
| `dbc4188` | AI hook controls and Security view integration |
| `b947b95` | Saved context acceptance across actual VS Code restarts |
| `3936ec5` | Isolated VSIX installation and activation acceptance |
| `ebd0306` | Feature and verification documentation |
| `1bf080d` | Latest committed panel design and Security status changes |

The design commit improves narrow layouts, tab styling, PR/chat controls,
status wrapping, reduced motion and Attention order. Security now distinguishes
checking, failed and blocked states rather than always showing green.

## Current uncommitted work: AI connection diagnostics

I started the first of two proposed extras. **Do not discard these changes.**

- `src/vscode/features/connection.ts`: new connection controller with cancellation,
  settings invalidation, duplicate-request protection and sanitized failures.
- `src/core/llm/models.ts`: optional fresh-catalog request, bypassing the cache
  when measuring connection response time; existing callers keep their defaults.
- `src/extension.ts`, `src/vscode/panel/messages.ts`, `package.json`: controller
  wiring, typed panel protocol and **DevPulse: Check AI Connection** command.
- `media/panel.html`, `media/panel.js`: collapsible **AI Connection** section in
  Overview with Check/Cancel, review/chat and autocomplete availability, and latency.
- `src/test/connection.test.ts`: actual Extension Host test using a local HTTP
  fixture for fresh requests, missing models, failures, cancellation and disposal.
- `scripts/run-extension-security.mjs`: includes the new test; optional
  `DEVPULSE_TEST_FILES` selects a comma-separated subset of known fixture tests.
- `README.md`: usage documentation.

The check requests only the model catalog: it sends no source code and does not
display the endpoint or credential. Catalog availability/latency does **not**
prove that generation works or indicate generation speed.

No commits were created for this new feature. Review the whole diff and finish
its verification before committing it separately.

## Exact verification status

- Current production build passed, including type checking and linting.
- Current core test run: **44 passed**, zero failures.
  Log: `.vscode-test/extras-core.txt`.
- Current full Extension Host run: **11 passed, 2 failed**.
  The new connection test passed. Log: `.vscode-test/connection-host.txt`.
- Failure 1: `security.test.ts` exceeded its 30-second timeout.
- Failure 2: `suggestion.test.ts` expected the preview callback to run once but
  it ran zero times (`0 !== 1`, compiled test line 68). Do not assume this is
  merely a timeout: inspect the early-return conditions and fixture state.
- A targeted rerun was attempted; its log ends with Extension Host exit code 1
  without a successful test summary: `.vscode-test/connection-recheck.txt`.
  It does not establish that either failure has been fixed.
- Earlier runs passed 12 feature tests, two PR fixture tests, Git hook regression
  tests, saved-context reopening, and isolated VSIX installation. Those are
  historical results, not a passing result for the current uncommitted tree.
- A previous real endpoint ping reported reachable/model found. Current live
  generation quality and latency have not been accepted.
- The user says existing PRs are done. Live requested-PR acceptance remains
  pending until a suitable open PR requests their review. Do not create one just
  for testing or post GitHub comments automatically.
- Visual verification was interrupted by the user pressing Escape. Do not
  claim all tabs, themes or layouts were visually verified.

## Recommended continuation, in order

1. Inspect `git status --short`, unstaged/staged diffs and the two failure logs.
   Check whether any interrupted test processes are still running; do not kill
   the user's ordinary VS Code sessions. Run checks sequentially on this machine.
2. Investigate the security timeout and suggestion preview failure. Make a
   separate small fix commit if a real regression is found; do not weaken
   assertions or increase timeouts solely to hide an unexplained failure.
3. Finish connection diagnostics: check its actual command and panel buttons,
   missing review versus inline models, cancellation, settings changes and
   narrow-panel rendering. Verify no URLs/tokens reach panel state or logs.
   Commit this feature after the relevant checks pass.
4. Implement the promised second extra: **remember the selected panel tab and
   collapsed sections**. This has not been started. Use the webview's
   `getState()`/`setState()` for small UI preferences only. Whitelist tab/section
   identifiers, validate restored data, and never persist chat/source/secrets
   there. Test actual webview recreation and invalid saved state. Preserve
   explicit Open Chat/Review navigation. Commit independently.
5. Complete visual acceptance in dark/light/high-contrast themes, keyboard
   navigation and narrow layouts; preserve CSP, typed messages and both views.
6. Rebuild/package after final edits and run installed-bundle acceptance before
   claiming the resulting VSIX is ready.

## Good later feature candidates

These are suggestions for discussion after the two extras above are finished:

- **Review history:** bounded, workspace-scoped summaries with explicit stale
  markers and Clear History. Do not persist raw source/diffs or secret values.
- **Finding filters:** filter Code findings by severity/file, show counts, retain
  original finding IDs and navigation. Never imply hidden findings are resolved.
- **Focus goals:** configurable daily goal and a simple progress indicator based
  on existing passive totals, with no extra notification spam.
- **Safe export:** export a redacted review summary as Markdown after an explicit
  user action. Exclude source snippets, credentials and endpoint details.

Do not begin all of these together. Pick one coherent feature, finish and verify
it, update its documentation, then commit before starting the next.

## Useful commands

Run from the project directory with supported Node on PATH:

```powershell
npm run build
npm run test:core
npm run test:security
npm run test:extension-security
# Targeted fixture run; remove the selector afterward.
$env:DEVPULSE_TEST_FILES = 'security,suggestion,connection'
npm run test:extension-security
Remove-Item Env:DEVPULSE_TEST_FILES
# PR fixture runner requires the installed VS Code path in VSCODE_EXECUTABLE_PATH.
npm run test:pr
node scripts/test-left-off.mjs
node dist/cli.js ping
```

For packaging/installation, follow the acceptance commands in `README.md` and
`scripts/test-install.mjs`. Never use the user's normal profile for fixture installs.

Before each commit: review the diff, stage explicit paths, run
`git diff --cached --check` and `node dist/cli.js precommit`, and stop on any
failure. Preserve unrelated edits. Suggested titles: `feat(connection): add AI
connection diagnostics`, then `feat(panel): remember tabs and collapsed sections`.
