import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile, access } from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const executable = process.argv[2];
const project = path.resolve(process.argv[3] ?? process.cwd());

export function cleanEnvironment(environment) {
  const env = { ...environment };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'VSCODE_INSPECTOR_OPTIONS', 'NODE_OPTIONS', 'VSCODE_IPC_HOOK_CLI']) {
    delete env[key];
  }
  return env;
}

export async function validateProject(directory) {
  let manifest;
  try { manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')); }
  catch { throw new Error('Open the extension project folder (the folder containing package.json), then retry.'); }
  if (manifest.name !== 'devpulse' || typeof manifest.main !== 'string') {
    throw new Error('This folder is not the DevPulse extension project.');
  }
  const bundle = path.resolve(directory, manifest.main);
  const relative = path.relative(directory, bundle);
  if (relative.startsWith('..') || path.isAbsolute(relative)) { throw new Error('Extension entry point must be inside the project.'); }
  try { await access(bundle); }
  catch { throw new Error('The extension bundle is missing. Run npm install and npm run build in the extension project first.'); }
}

export async function waitForReady(readyFile, projectPath, child, timeoutMs = 120_000) {
  const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const marker = JSON.parse(await readFile(readyFile, 'utf8'));
      if (typeof marker.extensionPath === 'string' && normalize(marker.extensionPath) === normalize(projectPath) && marker.panelVisible === true) { return; }
    } catch { /* The host has not published readiness yet. */ }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('VS Code exited before DevPulse loaded. Check the Development Host logs shown above.');
    }
    await delay(Math.min(250, Math.max(1, deadline - Date.now())));
  }
  throw new Error('VS Code started, but DevPulse did not become ready within two minutes. Check the Development Host logs shown above and ensure VS Code is version 1.103 or newer.');
}

export async function main() {
  if (!executable) { throw new Error('VS Code executable was not provided by the launch task.'); }
  await validateProject(project);
  const profiles = path.join(project, '.vscode-test', 'dev-hosts');
  await mkdir(profiles, { recursive: true });
  // A unique profile forces a new VS Code process and window on every launch.
  const profile = await mkdtemp(path.join(profiles, 'session-'));
  await mkdir(path.join(profile, 'User'), { recursive: true });
  await writeFile(path.join(profile, 'User', 'settings.json'), JSON.stringify({
    'workbench.activityBar.location': 'default',
    'workbench.sideBar.location': 'right',
    'workbench.startupEditor': 'none',
    'debug.javascript.autoAttachFilter': 'disabled',
  }));
  // Ordinary testing does not need debugger injection or an inspector connection.
  const env = cleanEnvironment(process.env);
  const readyFile = path.join(profile, 'devpulse-ready.json');
  env.DEVPULSE_DEV_HOST_READY_FILE = readyFile;
  console.log(`Starting DevPulse. Development Host logs: ${path.join(profile, 'logs')}`);
  const child = spawn(executable, [project, '--new-window', `--extensionDevelopmentPath=${project}`,
    `--user-data-dir=${profile}`, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
  { detached: true, stdio: 'ignore', windowsHide: false, env });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  await writeFile(path.join(project, '.vscode-test', 'last-dev-host.json'), JSON.stringify({ profile, pid: child.pid }));
  await waitForReady(readyFile, project, child);
  console.log('DevPulse loaded and its panel is visible in the Development Host window.');
  // Keep the task active so Windows Job Object does not terminate the child window
  await new Promise(resolve => { child.on('exit', resolve); child.on('close', resolve); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
