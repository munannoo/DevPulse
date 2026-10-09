import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runTests } from '@vscode/test-electron';
import assert from 'node:assert/strict';

const project = process.cwd();
const fixtures = path.join(project, '.vscode-test', 'pr-fixtures');
await mkdir(fixtures, { recursive: true });
const root = await mkdtemp(path.join(fixtures, 'review-'));
const execute = promisify(execFile);
try {
  await execute('git', ['init'], { cwd: root, timeout: 15_000 });
  await writeFile(path.join(root, 'app.ts'), 'export const value = 1;\n');
  const executable = process.env.VSCODE_EXECUTABLE_PATH;
  if (!executable) { throw new Error('Set VSCODE_EXECUTABLE_PATH to your installed VS Code executable.'); }
  const env = { ...process.env };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'VSCODE_INSPECTOR_OPTIONS', 'VSCODE_IPC_HOOK_CLI']) { delete env[key]; }
  await runTests({
    vscodeExecutablePath: executable, extensionDevelopmentPath: project,
    extensionTestsPath: path.join(project, 'node_modules/@vscode/test-cli/out/runner.cjs'),
    extensionTestsEnv: { ...env, DEVPULSE_PR_FIXTURE: '1', VSCODE_TEST_OPTIONS: JSON.stringify({ mochaOpts: { ui: 'tdd', timeout: 60_000 }, files: [path.join(project, 'out/test/prReview.test.js')], preload: [] }) },
    launchArgs: [root, '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--user-data-dir', path.join(root, '.profile')],
  });
} finally {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(fixtures));
  assert.ok(path.basename(root).startsWith('review-'));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
