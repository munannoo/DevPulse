import { mkdtemp, mkdir, writeFile, rm, readdir, access } from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runTests } from '@vscode/test-electron';
import assert from 'node:assert/strict';
import { cleanEnvironment } from './launch-extension.mjs';

const project = process.cwd(), fixtures = path.join(project, '.vscode-test', 'install-fixtures');
await mkdir(fixtures, { recursive: true });
const root = await mkdtemp(path.join(fixtures, 'install-')), execute = promisify(execFile);
try {
  const executable = process.env.VSCODE_EXECUTABLE_PATH ?? path.join(process.env.LOCALAPPDATA ?? '', 'Programs/Microsoft VS Code/Code.exe');
  const profile = path.join(root, 'profile'), extensions = path.join(root, 'extensions'), harness = path.join(root, 'harness'), repo = path.join(root, 'repo');
  await mkdir(harness); await mkdir(repo);
  await execute('git', ['init'], { cwd: repo, timeout: 15000 });
  await writeFile(path.join(repo, 'app.ts'), 'export const value = 1;\n');
  await writeFile(path.join(harness, 'package.json'), JSON.stringify({ name: 'install-harness', publisher: 'local', version: '0.0.1', engines: { vscode: '^1.103.0' }, main: './index.js' }));
  await writeFile(path.join(harness, 'index.js'), 'exports.activate = () => {};');
  const env = cleanEnvironment(process.env);
  // CLI runs through VS Code's Node entry point, using isolated storage only.
  const installation = path.dirname(executable);
  // Recent Windows updates keep application resources in a version subdirectory.
  const candidates = [installation, ...(await readdir(installation, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => path.join(installation, entry.name))];
  let cli;
  for (const directory of candidates) {
    const candidate = path.join(directory, 'resources/app/out/cli.js');
    if (await access(candidate).then(() => true, () => false)) { cli = candidate; break; }
  }
  assert.ok(cli, 'VS Code CLI entry point found');
  await execute(executable, [cli, '--user-data-dir', profile, '--extensions-dir', extensions,
    '--install-extension', path.resolve(process.argv[2] ?? '.vscode-test/devpulse-acceptance.vsix'), '--force'],
  { timeout: 60000, windowsHide: true, env: { ...env, ELECTRON_RUN_AS_NODE: '1' } });
  await runTests({ vscodeExecutablePath: executable, extensionDevelopmentPath: harness,
    extensionTestsPath: path.join(project, 'node_modules/@vscode/test-cli/out/runner.cjs'),
    extensionTestsEnv: { ...env, DEVPULSE_INSTALLED_FIXTURE: extensions,
      VSCODE_TEST_OPTIONS: JSON.stringify({ mochaOpts: { ui: 'tdd', timeout: 20000 }, files: [path.join(project, 'out/test/installed.test.js')], preload: [] }) },
    launchArgs: [repo, '--extensions-dir', extensions, '--user-data-dir', profile, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'] });
  console.log('Packaged VSIX installation and activation passed.');
} finally {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(fixtures)); assert.ok(path.basename(root).startsWith('install-'));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
