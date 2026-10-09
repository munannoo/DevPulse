import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runTests } from '@vscode/test-electron';
import assert from 'node:assert/strict';

const project = process.cwd();
const fixtures = path.join(project, 'test-repo');
await mkdir(fixtures, { recursive: true });
const root = await mkdtemp(path.join(fixtures, '.security-check-'));
const execute = promisify(execFile);
try {
  for (const args of [['init'], ['config', 'user.name', 'DevPulse Test'], ['config', 'user.email', 'test@example.invalid']]) {
    await execute('git', args, { cwd: root, timeout: 15_000 });
  }
  await writeFile(path.join(root, '.gitignore'), '/.env\n');
  await writeFile(path.join(root, 'config.ts'), 'const enabled = true;\n');
  await execute('git', ['add', '.'], { cwd: root, timeout: 15_000 });
  await execute('git', ['commit', '-m', 'fixture'], { cwd: root, timeout: 15_000 });
  const executable = process.env.VSCODE_EXECUTABLE_PATH ?? (process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe') : undefined);
  if (!executable) { throw new Error('Set VSCODE_EXECUTABLE_PATH to your VS Code executable.'); }
  await runTests({
    vscodeExecutablePath: executable,
    extensionDevelopmentPath: project,
    extensionTestsPath: path.join(project, 'node_modules/@vscode/test-cli/out/runner.cjs'),
    extensionTestsEnv: { DEVPULSE_SECURITY_FIXTURE: '1', VSCODE_TEST_OPTIONS: JSON.stringify({ mochaOpts: { ui: 'tdd', timeout: 30_000 }, files: [path.join(project, 'out/test/security.test.js'), path.join(project, 'out/test/suggestion.test.js')], preload: [] }) },
    launchArgs: [root, '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--user-data-dir', path.join(root, '.profile')],
  });
} finally {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(fixtures));
  assert.ok(path.basename(root).startsWith('.security-check-'));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
