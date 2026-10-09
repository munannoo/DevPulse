import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const executable = process.argv[2];
const project = path.resolve(process.argv[3] ?? process.cwd());
const port = 9333;

async function inspectorReady() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
    if (!response.ok) { return false; }
    const targets = await response.json();
    return Array.isArray(targets) && targets.some(target => target.type === 'node' && /extensionHost|electron\/js2c\/utility_init/i.test(target.title ?? target.url ?? ''));
  } catch { return false; }
}

async function main() {
  if (!executable) { throw new Error('VS Code executable was not provided by the launch task.'); }
  if (await inspectorReady()) { console.log('DevPulse Extension Host is ready; attaching to the existing session.'); return; }
  const profile = path.join(project, '.vscode-test', 'dev-host');
  await mkdir(profile, { recursive: true });
  // Launch without js-debug bootstrap injection, then attach using the Node inspector.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VSCODE_INSPECTOR_OPTIONS;
  delete env.NODE_OPTIONS;
  const child = spawn(executable, [project, '--new-window', `--extensionDevelopmentPath=${project}`,
    `--inspect-extensions=${port}`, `--user-data-dir=${profile}`, '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
  { detached: true, stdio: 'ignore', windowsHide: true, env });
  let launchError = false;
  child.on('error', () => { launchError = true; });
  child.unref();
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline && !launchError) {
    if (await inspectorReady()) { console.log('DevPulse Extension Host is ready for debugger attach.'); return; }
    await delay(200);
  }
  throw new Error('Extension Host inspector did not start. Close old Development Host windows and retry F5. Check that port 9333 is free.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
