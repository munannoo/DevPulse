import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { cleanEnvironment } from './launch-extension.mjs';

const execute = promisify(execFile);
const project = fileURLToPath(new URL('../', import.meta.url));
const flags = new Set(process.argv.slice(2));
const unattended = flags.has('--prepare-only') || flags.has('--rehearse');
const env = { ...cleanEnvironment(process.env),
  DEVPULSE_LLM_BASE_URL: process.env.DEVPULSE_LLM_BASE_URL || 'http://localhost:11434/v1',
  DEVPULSE_LLM_MODEL: process.env.DEVPULSE_LLM_MODEL || 'gemma4:e2b' };
const run = (file, args, cwd = project) => execute(file, args, { cwd, env, timeout: 180_000, maxBuffer: 2_000_000 });
const cli = path.join(project, 'dist', 'cli.js');
const terminal = unattended ? undefined : createInterface({ input: process.stdin, output: process.stdout });
async function step(title, instructions) {
  console.log(`\n${title}\n${instructions}`);
  if (terminal) { await terminal.question('Complete the screen actions, then press Enter to continue… '); }
}
async function expectFailure(file, args, cwd, expected) {
  try { await run(file, args, cwd); }
  catch (error) {
    assert.match(error.stderr || '', expected);
    console.log('Expected rejection confirmed.'); return;
  }
  throw new Error('Expected a rejection, but the operation passed. Stop and inspect this demo.');
}
async function openHost(folder, profileName) {
  if (unattended || flags.has('--no-open')) { return; }
  const code = process.env.VSCODE_EXECUTABLE_PATH || (process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe') : 'code');
  if (process.platform === 'win32') { await access(code); }
  const profile = path.join(session.root, profileName);
  await mkdir(path.join(profile, 'User'), { recursive: true });
  await writeFile(path.join(profile, 'User', 'settings.json'), JSON.stringify({
    'workbench.sideBar.location': 'right', 'debug.javascript.autoAttachFilter': 'disabled',
    'workbench.startupEditor': 'none' }));
  const child = spawn(code, [folder, '--new-window', `--extensionDevelopmentPath=${project}`,
    '--user-data-dir', profile, '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
  { detached: true, stdio: 'ignore', windowsHide: true, env });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
}
let session;
try {
  console.log('Preparing DevPulse supervisor demo. All Git writes stay in fresh local demo repositories.');
  await run(process.execPath, ['scripts/check-node.cjs']);
  await run('git', ['--version']);
  if (!flags.has('--skip-build')) {
    console.log('Building extension (types, lint, production bundle)…');
    await run(process.execPath, ['scripts/build-extension.mjs', '--verify', '--production']);
  }
  await access(cli);
  session = JSON.parse((await run(process.execPath, ['scripts/create-demo.mjs', '--json'])).stdout);
  await writeFile(path.join(session.root, 'PRESENTER.md'), await readFile(path.join(project, 'docs', 'supervisor-demo.md'), 'utf8'));
  console.log(`Workspace: ${session.workspace}\nCue sheet: ${path.join(session.root, 'PRESENTER.md')}`);
  try { console.log((await run(process.execPath, [cli, 'ping'])).stdout.trim()); }
  catch { console.log('AI preflight did not pass. Use Set Up Ollama & Models and Check AI Connection before presenting AI features. Git/test/security scenes still work.'); }
  if (flags.has('--prepare-only')) { console.log('Prepared only. No presentation scenes executed.'); }
  else {
    await openHost(session.workspace, 'presenter-profile');
    await step('1 / Incoming changes · 2 minutes',
      'Open DevPulse Overview: main is one commit behind. Say: “A developer can see incoming changes before choosing to pull.”');
    console.log((await run('git', ['diff', 'HEAD..origin/main', '--', 'cart.mjs'], session.workspace)).stdout);
    await openHost(session.preview, 'preview-profile');
    await step('2 / Incoming code analysis · 1 minute',
      'In the incoming-preview window: open cart.mjs → Analyze File. Show yellow gutter, hover and Code tab explanation. Do not apply a fix yet. Say: “This is a separate checkout of the incoming code, not an automatic pre-pull scan.”');
    await step('3 / Pull and expose the regression · 1 minute',
      'Return to the original workspace. Click Git Pull & Sync. Leave cart.mjs unchanged. The script will also run ff-only pull, safely a no-op if already pulled.');
    await run('git', ['pull', '--ff-only'], session.workspace);
    await expectFailure(process.execPath, ['cart.test.mjs'], session.workspace, /Quantity must affect payment/);
    await run('git', ['switch', '-c', 'demo/shipping', '--track', 'origin/demo/shipping'], session.workspace);
    await step('4 / PR candidate and chat · 2 minutes',
      'Open shipping.mjs → Analyze File → select function → Explain Selection. In Chat include current file and ask “Which HTTP failures are unhandled?” Then Write Tests. Do not insert edits. This is a local PR candidate; use the cue sheet for the real GitHub PR scene.');
    await run('git', ['switch', 'main'], session.workspace);
    await step('5 / Autocomplete and settings · 1 minute',
      'Open autocomplete.mjs, inside availableItems type “return items.filter”, pause, accept ghost text with Tab. Show Select Autocomplete Model and the settings setup-guide link. Save only autocomplete.mjs if desired.');
    await step('6 / Faulty push rejected · 1 minute',
      'Say: “This local demo adds a test-based pre-push hook. It rejects a calculation that charges the wrong amount.” The script now attempts a local push.');
    await expectFailure('git', ['push', 'origin', 'HEAD:refs/heads/demo/faulty'], session.workspace, /Quantity must affect payment/);
    const cart = path.join(session.workspace, 'cart.mjs');
    await writeFile(cart, (await readFile(cart, 'utf8')).replace('sum + item.price,', 'sum + item.price * item.quantity,'));
    await run(process.execPath, ['cart.test.mjs'], session.workspace);
    await run('git', ['add', '--', 'cart.mjs'], session.workspace);
    await step('7 / Commit description and successful push · 1 minute',
      'Run Generate Commit Description & Analysis; show the draft and risk summary. Do not commit manually; the script commits only cart.mjs next.');
    await run('git', ['commit', '-m', 'fix: respect cart quantities'], session.workspace);
    await run('git', ['push', 'origin', 'HEAD:refs/heads/demo/fixed'], session.workspace);
    console.log('Corrected checkout committed and pushed to the local remote.');
    await run(process.execPath, [cli, 'init'], session.workspace);
    const synthetic = ['sk', 'DEMO_NOT_A_REAL_CREDENTIAL_123456'].join('-');
    await writeFile(path.join(session.workspace, 'credential.mjs'), ['const ', 'demoToken', ' = ', JSON.stringify(synthetic), ';\n'].join(''));
    await run('git', ['add', '--', 'credential.mjs'], session.workspace);
    await expectFailure(process.execPath, [cli, 'precommit'], session.workspace, /Possible hardcoded credential/);
    await expectFailure('git', ['commit', '-m', 'demo: reject synthetic credential'], session.workspace, /Possible hardcoded credential/);
    await step('8 / Secret guard and confirmed fix · 2 minutes',
      'Open Security → Verify Staged Changes. Show the synthetic finding. Click Fix, inspect preview, confirm, and verify again. Values go into ignored .env. This is DevPulse’s real staged-secret guard; the push hook above is demo-only. Leave the fix staged.');
    await step('9 / Focus, saved context and cache · 1 minute',
      'Open Focus: activity tracking starts automatically; this demo uses a one-minute Flow threshold. Switch away to show pause. Reopen the workspace to show Resume Where You Left Off. Repeat Analyze File without edits to show cached reuse; Clear AI Response Cache requests a fresh review.');
    await step('10 / One-page onboarding, last · 1 minute',
      'Open ONBOARDING.md → Ctrl+Shift+V. Summarize purpose, files and shared dependency. In Chat include cart.mjs and ask “Give a two-sentence onboarding summary: purpose, inputs, outputs and affected callers.” This is file-scoped AI plus a curated codebase page.');
    console.log('Demo complete. AI and GitHub UI scenes require your live endpoint/login; rehearsal does not verify them.');
  }
} catch {
  console.error('Presentation stopped. Preserve the demo and inspect its Git status. Check Node, Git, VS Code and the cue sheet; no project files or external remotes were changed by demo scenes.');
  process.exitCode = 1;
} finally { terminal?.close(); }
