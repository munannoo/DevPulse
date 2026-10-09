import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

const executable = process.argv[2];
const project = path.resolve(process.argv[3] ?? process.cwd());

async function main() {
  if (!executable) { throw new Error('VS Code executable was not provided by the launch task.'); }
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
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VSCODE_INSPECTOR_OPTIONS;
  delete env.NODE_OPTIONS;
  const child = spawn(executable, [project, '--new-window', `--extensionDevelopmentPath=${project}`,
    `--user-data-dir=${profile}`, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
  { detached: true, stdio: 'ignore', windowsHide: false, env });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  await writeFile(path.join(project, '.vscode-test', 'last-dev-host.json'), JSON.stringify({ profile, pid: child.pid }));
  child.unref();
  console.log('Started a new DevPulse Development Host window without a debugger. The window stays open after this task finishes.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
