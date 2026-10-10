# DevPulse presentation demo

For a complete guided supervisor presentation, run **`npm.cmd run demo`**.
It opens the development windows, pauses for your clicks, and runs the local
Git/test/security scenes. See the [presenter cue sheet](../docs/supervisor-demo.md)
for timing, talking points, and rehearsal options. The commands below prepare
fixtures manually.

Run from the DevPulse project with supported Node on PATH:

```powershell
npm.cmd run build
node scripts/create-demo.mjs
```

The script prints fresh `workspace` and `incoming-preview` paths inside the ignored
`.vscode-test/demos` directory. All pushes go to a local bare repository. It creates
no GitHub PR and changes no hooks, branches or remotes in the DevPulse project.
Re-run to create a fresh demo; existing demos are preserved.

Open the printed workspace in an Extension Development Host (replace the path):

```powershell
code --new-window --extensionDevelopmentPath="$PWD" "<printed workspace path>"
```

Trust this generated workspace. Use **DevPulse: Open Settings** to set your host
and review model, or copy `.env.example` to `.env` inside the demo. Process
environment overrides `.env`; store credentials with **DevPulse: Set API Key**.
Use **DevPulse: Check AI Connection** before recording. No mock AI is enabled.

## 1. Incoming code, before Git Pull

1. In `workspace`, show Overview → branch status: `main`, one commit behind.
2. In its terminal run `git diff HEAD..origin/main -- cart.mjs` to preview the
   upcoming quantity bug. DevPulse has no automatic pre-pull analysis command.
3. Open the printed `incoming-preview` folder in another Development Host. Its
   `cart.mjs` is the incoming revision. Run **DevPulse: Analyze File**; inspect
   findings in the Code tab and hover highlighted lines. Ask Chat, including this
   file: “What changed if total no longer multiplies by quantity?”
4. Back in `workspace`, choose **Git Pull & Sync**. The explicit fast-forward
   brings in the faulty calculation. Run `node cart.test.mjs` to show the failure.

AI findings and diagrams depend on the live model. The test failure is
deterministic. Red/yellow/blue correspond to security/warning/context findings;
a review need not produce all three colors.

## 2. Upcoming PR: code and explanation

The local candidate is `origin/demo/shipping`; its patch is saved as
`shipping-pr.diff` alongside the generated workspaces. In the demo workspace:

```powershell
git switch -c demo/shipping --track origin/demo/shipping
```

Open `shipping.mjs` → **Analyze File**, then select the function → **Explain
Selection** or **Write Tests**. Show the unhandled HTTP error risk and its
explanation. This is a local PR candidate demonstration, not GitHub PR review.

For the real integration, use a separate GitHub demo repository with an open PR
requesting your review. **Connect GitHub** → **Refresh Requested PRs** → **Review
with Gemma** shows per-file findings and code at the reviewed revision. The local
origin cannot exercise authenticated GitHub requests. DevPulse posts no comments.

Return to `main` with `git switch main` before the next steps.

## 3. Autocomplete

Open `autocomplete.mjs`. Inline suggestions are enabled only in this generated
workspace. Choose **DevPulse: Select Autocomplete Model**; select a smaller model
that is actually installed on your endpoint. Put the cursor inside
`availableItems`, type `return items.filter`, pause, and accept ghost text with
Tab. Use the inline-suggestion trigger command if needed. Copilot is not required.
Revert this exploratory edit before the pull/push steps if it causes a conflict.

## 4. Reject faulty code when pushing

On demo `main` after pulling the quantity bug:

```powershell
git push origin HEAD:refs/heads/demo/faulty
```

The **demo-only pre-push hook** runs `cart.test.mjs`, rejects the quantity bug,
and leaves that remote branch absent. Restore `item.price * item.quantity` in
`cart.mjs`, run the tests, stage the file, and use **Generate Commit Description &
Analysis**. Commit the fix, then repeat the push: it succeeds to the local remote.
The generated workspace has a demo-only local Git identity. To finish the fix:

```powershell
node cart.test.mjs
git add -- cart.mjs
git commit -m "fix: respect cart quantities"
git push origin HEAD:refs/heads/demo/fixed
```

This hook checks the working-tree calculation, illustrating a test gate. It is
not a production pushed-commit scanner. DevPulse's built-in guard checks staged
additions at **commit** time; it does not scan already-committed secrets at push.
Optional AI commit review depends on the endpoint and is time-boxed.

For a separate security demonstration, run `node scripts/create-demo.mjs --secret`
from the project. Open that fresh workspace → **Verify Staged Changes**. The
generated inert synthetic credential should appear in Security. Create an empty
`.env` if missing, preview **Fix**, confirm, and verify again. Install the
pre-commit hook to show commit blocking. This staged example is separate from
the clean incoming-pull demonstration; never use a real credential.

## 5. Onboarding — show last, one page

Open [demo/ONBOARDING.md](demo/ONBOARDING.md) as Markdown preview (also copied into
the generated workspace). It summarizes this small codebase on one page. Finish
with the file-scoped Chat prompt listed there. Whole-codebase automatic onboarding
is not an existing DevPulse feature.

Optional supporting shots: Focus counts editor activity automatically (one-minute
Flow threshold in this demo); switch away to show pause. Reopen a file after
editing to show **Resume Where You Left Off**. Re-run the same unchanged analysis
to demonstrate cache reuse, and **Clear AI Response Cache** to request a new review.
