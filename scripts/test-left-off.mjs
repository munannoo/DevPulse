import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { cleanEnvironment } from './launch-extension.mjs';

const project = process.cwd(), fixtures = join(project, '.vscode-test', 'reopen-fixtures');
await mkdir(fixtures, { recursive: true });
const root = await mkdtemp(join(fixtures, 'session-')), execute = promisify(execFile);
const server = createServer(async (request, response) => {
  for await (const chunk of request) { void chunk; }
  response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: 'You were editing session.ts at line 4.' }) } }] }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const repo = join(root, 'repo'), harness = join(root, 'harness');
  await mkdir(repo); await mkdir(harness);
  for (const args of [['init'], ['config', 'user.name', 'Fixture'], ['config', 'user.email', 'fixture@example.invalid']]) { await execute('git', args, { cwd: repo, timeout: 15000 }); }
  await writeFile(join(repo, 'session.ts'), '// one\n// two\n// three\n// four\n// five\n');
  await execute('git', ['add', '.'], { cwd: repo }); await execute('git', ['commit', '-m', 'fixture'], { cwd: repo });
  await writeFile(join(harness, 'package.json'), JSON.stringify({ name: 'reopen-harness', publisher: 'local', version: '0.0.1', engines: { vscode: '^1.103.0' }, main: './index.js', activationEvents: ['onStartupFinished'] }));
  await writeFile(join(harness, 'index.js'), `const vscode = require('vscode'), fs = require('node:fs/promises'), assert = require('node:assert/strict');
exports.activate = async () => {
  try {
    const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'devpulse');
    const api = await extension.activate();
    if (process.env.DEVPULSE_REOPEN_PHASE === 'save') {
      const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'session.ts')));
      await editor.edit(edit => edit.insert(new vscode.Position(3, 0), '// mid-edit '));
      editor.selection = new vscode.Selection(3, 0, 3, 0);
      assert.ok(editor.document.isDirty);
      await new Promise(resolve => setTimeout(resolve, 10000));
    } else {
      assert.equal(api.getReviewState().leftOff?.file, 'session.ts');
      assert.equal(api.getReviewState().leftOff?.line, 4);
      await vscode.commands.executeCommand('devpulse.resumeWork');
      assert.equal(vscode.window.activeTextEditor.selection.active.line, 3);
    }
    await fs.writeFile(process.env.DEVPULSE_REOPEN_RESULT, 'passed');
    await vscode.commands.executeCommand('workbench.action.quit');
  } catch (error) { await fs.writeFile(process.env.DEVPULSE_REOPEN_RESULT, String(error.stack)); }
};`);
  const executable = process.env.VSCODE_EXECUTABLE_PATH ?? join(process.env.LOCALAPPDATA ?? '', 'Programs/Microsoft VS Code/Code.exe');
  for (const phase of ['save', 'reopen']) {
    const result = join(root, phase + '.txt');
    const child = spawn(executable, [repo, '--new-window', `--extensionDevelopmentPath=${project}`, `--extensionDevelopmentPath=${harness}`, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--user-data-dir', join(root, 'profile')],
      { windowsHide: true, stdio: 'ignore', env: { ...cleanEnvironment(process.env), DEVPULSE_REOPEN_PHASE: phase, DEVPULSE_REOPEN_RESULT: result, DEVPULSE_LLM_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`, DEVPULSE_LLM_MODEL: 'fixture' } });
    try {
      const deadline = Date.now() + 60000; let report;
      while (Date.now() < deadline) { report = await readFile(result, 'utf8').catch(() => undefined); if (report) { break; } await delay(250); }
      assert.equal(report, 'passed', `${phase} acceptance failed: ${report ?? 'timeout'}`);
      if (child.exitCode === null) { await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]); }
      console.log(`${phase}: passed`);
    } finally { if (child.exitCode === null) { child.kill(); } }
  }
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  assert.equal(dirname(resolve(root)), resolve(fixtures)); assert.ok(basename(root).startsWith('session-'));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
