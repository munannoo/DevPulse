import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runTests } from '@vscode/test-electron';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const project = process.cwd();
const fixtures = path.join(project, 'test-repo');
await mkdir(fixtures, { recursive: true });
const root = await mkdtemp(path.join(fixtures, '.security-check-'));
const execute = promisify(execFile);
const server = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) { body += chunk; }
  const payload = JSON.parse(body);
  if (payload.stream) {
    response.setHeader('Content-Type', 'text/event-stream');
    response.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Fixture answer.\n' } }] }) + '\n\n');
    if (payload.messages.at(-1).content.includes('__hold_chat__')) { return; }
    response.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '```ts\n// fixture reply\n```' } }] }) + '\n\n');
    response.end('data: [DONE]\n\n'); return;
  }
  const file = /^File: ([^\n]+)/.exec(payload.messages.at(-1).content)?.[1];
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: 'Fixture review.',
    findings: file === 'highlight.ts' ? ['warning', 'security', 'context'].map((severity, index) => ({
      file: 'highlight.ts', startLine: index + 1, endLine: index + 1, severity,
      title: 'Fixture finding', explanation: 'Fixture explanation.',
      ...(index === 0 ? { replacement: 'const value = 2;' } : {}),
    })) : [],
  }) } }] }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  for (const args of [['init'], ['config', 'user.name', 'DevPulse Test'], ['config', 'user.email', 'test@example.invalid']]) {
    await execute('git', args, { cwd: root, timeout: 15_000 });
  }
  await writeFile(path.join(root, '.gitignore'), '/.env\n/.profile\n');
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
    extensionTestsEnv: { DEVPULSE_SECURITY_FIXTURE: '1',
      DEVPULSE_LLM_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`, DEVPULSE_LLM_MODEL: 'fixture',
      VSCODE_TEST_OPTIONS: JSON.stringify({ mochaOpts: { ui: 'tdd', timeout: 30_000 },
        files: ['security', 'suggestion', 'highlights', 'focus', 'chat-context', 'chat'].map(name => path.join(project, `out/test/${name}.test.js`)), preload: [] }) },
    launchArgs: [root, '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--user-data-dir', path.join(root, '.profile')],
  });
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  assert.equal(path.dirname(path.resolve(root)), path.resolve(fixtures));
  assert.ok(path.basename(root).startsWith('.security-check-'));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
