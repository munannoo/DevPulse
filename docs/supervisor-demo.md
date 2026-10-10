# Supervisor presentation — DevPulse (12–15 minutes)

## Before the meeting

From the DevPulse project terminal:

```powershell
npm.cmd install
ollama pull gemma4:e2b
ollama run gemma4:e2b
```

Ask the model a short question, then enter `/bye`. Leave the Ollama app running.
If Ollama is missing, follow **DevPulse: Set Up Ollama & Models** first.
The runner defaults to local Ollama and `gemma4:e2b`. To use another installed
model or an OpenAI-compatible server, set `DEVPULSE_LLM_MODEL` and
`DEVPULSE_LLM_BASE_URL` in this terminal before launching. Use your existing secure
credential configuration when needed; never project a credential on screen.

Start the complete guided presentation:

```powershell
npm.cmd run demo
```

The script builds, creates fresh local Git repositories, checks AI reachability,
and opens VS Code with this extension loaded. It prints each scene and waits for
Enter. **Finish the specified VS Code clicks before pressing Enter.** Keep the
terminal visible next to VS Code; the script prints the Git evidence there.
Trust the generated workspace when prompted, then open DevPulse in the Activity
Bar. Run **Check AI Connection** in the new window before starting the AI scenes.

The initial window is the developer workspace. The second window opened at scene
2 is `incoming-preview`; close/minimize it after that scene and return to the first.
Do not apply the cart fix early, manually commit, or insert chat-generated edits.
Those would change the controlled regression scenario.

## Exact cues and clicks

| Scene | What to do | What to say / show |
| --- | --- | --- |
| 1. Incoming status | Overview → branch status | “We are one commit behind. Pulling is an explicit developer choice.” The terminal displays the incoming diff. |
| 2. Analyze incoming code | In **incoming-preview**, open `cart.mjs`; Command Palette → **DevPulse: Analyze File**; hover the changed total | “The missing quantity multiplication changes payment amounts.” Show Code tab findings and Recommended Fix. Diagrams appear only if the model returns flow data. |
| 3. Pull | Back in **workspace**, Overview → **Git Pull & Sync**, then Enter in runner | Script also runs a safe ff-only pull and proves the regression with failing tests. |
| 4. PR candidate | Script switches to shipping branch. Open `shipping.mjs`; Analyze File; select function → **Explain Selection** | “A proposed change needs HTTP failure handling.” Chat: include current file, ask “Which HTTP failures are unhandled?” Run **Write Tests**, show response without inserting it. |
| 5. Autocomplete | Open `autocomplete.mjs`; inside the function type `return items.filter`, pause, Tab | Show real ghost text. **Select Autocomplete Model** controls it independently of review/chat. Open ⚙ Settings and its setup-guide link. |
| 6. Faulty push | Press Enter, watch runner terminal | Push to the local remote is rejected by the demo's test hook. “This push gate is a demo addition; DevPulse's built-in guard runs at commit time.” |
| 7. Fixed commit | Script fixes/stages only `cart.mjs`. Run **Generate Commit Description & Analysis** | Show title, description and risks. Press Enter; runner commits and pushes the corrected calculation locally. |
| 8. Security | Script installs real pre-commit guard, generates/stages an inert credential. Security → **Verify Staged Changes** → **Fix** → inspect diff → confirm → verify again | “Regex scanning blocks a staged secret even without AI. Auto-fix requires consent and places the value in ignored .env.” Keep .env contents off the projector. |
| 9. Focus / continuity | Focus tab; switch windows and return; reopen workspace; **Resume Where You Left Off** | “Activity is passive, idle/window loss pauses tracking, and state survives interruption.” This fixture uses a one-minute Flow threshold. |
| 10. Onboarding, last | Open `ONBOARDING.md`, **Ctrl+Shift+V** | A single-page codebase overview. Include `cart.mjs` in Chat; ask the onboarding prompt shown by the runner. |

Between scenes you can use **Review My Changes** or **Review Selection** on an
edited snippet to show line-specific review and navigation. **Fix Selection**
offers a chat response; show Copy/Insert controls without inserting into the
controlled cart scenario. Model responses vary; do not promise specific text or
that every review will produce all three severities.

## Real GitHub PR scene (optional, prepare beforehand)

The generated shipping branch and patch are **local candidate code**, not a real
GitHub PR. For authenticated PR review, prepare a separate GitHub repository and
an open PR requesting the presenting account's review. Open that repository in
a Development Host, **Connect GitHub**, sign in, **Refresh Requested PRs**, then
**Review with Gemma**. Show summary, risk, per-file findings and revision navigation.
No comments are posted automatically. Prepare login before the meeting; the
isolated presentation profile starts without your normal editor login.
Other installed extensions are disabled in these Development Host windows so
their notifications and completions do not interrupt the presentation.

## Supporting features and honest limits

- **Reminders:** Overview Attention shows deterministic issues such as being behind
  and a missing hook. The missing-hook reminder can clear after scene 8 installs it.
  Old-work reminders need elapsed time; do not claim a fresh fixture has old work.
- **Cache:** repeat an unchanged analysis, then **Clear AI Response Cache** and
  repeat. Explain content-hash reuse; the panel does not display a cache-hit counter.
- **Offline:** if Ollama is unavailable, demonstrate Git, Focus, saved context and
  regex security. AI errors should be explained as unavailable, not successful analysis.
- **User control:** pull is explicit; stale findings clear after edits; fixes preview
  before application. Red/security, yellow/warning, blue/context have text labels.
- Incoming analysis uses a separate checkout. Onboarding is a curated page plus
  file-scoped chat. Neither is automatic whole-repository AI analysis.

## Preparation and rehearsal modes

```powershell
npm.cmd run demo -- --prepare-only
npm.cmd run demo -- --rehearse --skip-build
```

`--prepare-only` builds and prepares fixtures/cue sheet without opening windows or
running presentation scenes. `--rehearse` executes the local Git/test/secret
sequence without prompts or windows; it verifies CLI scenes, not live AI/UI or
GitHub. `--skip-build` requires an already-current build. `--no-open` keeps guided
prompts but lets you open the generated workspaces yourself.

Re-run for a fresh session; old sessions remain under `.vscode-test/demos`.
No demo operation changes the DevPulse project's Git remote or hooks. All demo
pushes use a local bare remote, never GitHub. Stop with Ctrl+C if you need to
inspect a scene; the workspace is preserved.
