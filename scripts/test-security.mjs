import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const execute = promisify(execFile);
const temporary = await mkdtemp(path.join(tmpdir(), 'devpulse-security-'));
const cli = path.resolve('dist/cli.js');
try {
  const bundle = path.join(temporary, 'security.cjs');
  await build({ stdin: { contents: `export * from './src/core/security/secretScan'; export * from './src/core/security/autofix'; export * from './src/core/security/precommit'; export * from './src/core/git/diff';`, resolveDir: process.cwd() }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs' });
  const { scanSecrets, containsSecret, redact, planFix, validatePlan, stageFix, verifyStaged, addedLines } = (await import(pathToFileURL(bundle).href)).default;
  const fake = 'sk_test_' + 'FAKEKEY0000000000';
  const diff = text => `diff --git a/config.ts b/config.ts\n--- a/config.ts\n+++ b/config.ts\n@@ -0,0 +1 @@\n+${text}\n`;
  for (const text of [fake, 'AKIA' + '0000000000000000', 'const jwtSecret = "fake-jwt-password";', 'const apiKey = "fake-generic-key";', 'DATABASE_PASSWORD=not-a-real-password', 'postgres://' + 'user:fakepass@db/test', '-----BEGIN ' + 'PRIVATE KEY-----', 'eyJfake.payload.signature']) {
    assert.equal(containsSecret(text), true, 'credential category detected');
    assert.equal(scanSecrets(diff(text)).length, 1);
  }
  assert.equal(containsSecret('const apiKey = process.env.API_KEY;'), false);
  assert.equal(containsSecret('API_KEY = process.env.API_KEY;'), false);
  assert.equal(containsSecret('const publishable = "pk_test_public123";'), false);
  assert.equal(scanSecrets(diff('safe()') + `-${fake}\n`).length, 0, 'removed secrets are ignored');
  assert.equal(redact(`const apiKey = "${fake}";`).includes(fake), false);
  assert.equal(addedLines('diff --git a/x b/x\n+++ "b/a\\tname.ts"\n@@ -0,0 +3 @@\n+hello\n')[0].file, 'a\tname.ts');

  const root = path.join(temporary, 'repo');
  await mkdir(root);
  const git = async args => (await execute('git', args, { cwd: root, timeout: 15_000 })).stdout;
  const runCli = async args => {
    try { return { code: 0, ...(await execute(process.execPath, [cli, ...args], { cwd: root, timeout: 15_000 })) }; }
    catch (error) { return { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
  };
  await git(['init']);
  await git(['config', 'user.name', 'DevPulse Test']);
  await git(['config', 'user.email', 'test@example.invalid']);
  await writeFile(path.join(root, '.gitignore'), '/.env\n');
  await writeFile(path.join(root, 'config.ts'), 'const enabled = true;\n');
  await git(['add', '.']);
  await git(['commit', '-m', 'initial']);
  // Ensure hook backup and chain run on a subsequent clean commit.
  await writeFile(path.join(root, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  assert.equal((await runCli(['init'])).code, 0);
  assert.equal((await runCli(['init'])).code, 0, 'installation is idempotent');
  assert.equal(await readFile(path.join(root, '.git/hooks/pre-commit.devpulse-backup'), 'utf8'), '#!/bin/sh\nexit 0\n');
  await writeFile(path.join(root, 'config.ts'), `const apiKey = "${fake}";\n`);
  await git(['add', 'config.ts']);
  const blocked = await runCli(['precommit']);
  assert.equal(blocked.code, 1);
  assert.equal((blocked.stdout + blocked.stderr).includes(fake), false, 'CLI never prints the credential');
  let blockedCommit = false;
  try { await git(['commit', '-m', 'must be blocked']); } catch { blockedCommit = true; }
  assert.equal(blockedCommit, true, 'actual Git hook blocks commit');
  const reportPath = path.join(root, '.git/devpulse/last-scan.json');
  const report = await readFile(reportPath, 'utf8');
  assert.equal(report.includes(fake), false, 'report contains no source or credential');
  const id = JSON.parse(report).findings[0].id;
  const plan = await planFix(root, id);
  assert.equal(plan.preview.includes(fake), false, 'preview is redacted');
  assert.equal(plan.replacement, 'const apiKey = process.env.API_KEY;\n');
  await writeFile(path.join(root, 'config.ts'), `const apiKey = "${fake}";\nconst unstaged = true;\n`);
  await assert.rejects(planFix(root, id), /unstaged/, 'partial staging cannot be overwritten');
  await assert.rejects(validatePlan(root, plan), /changed/, 'stale preview cannot be applied');
  await writeFile(path.join(root, 'config.ts'), plan.original);
  await validatePlan(root, plan);
  await writeFile(path.join(root, 'config.ts'), plan.replacement);
  await writeFile(path.join(root, '.env'), plan.env);
  await writeFile(path.join(root, '.gitignore'), plan.ignore);
  await stageFix(root, plan);
  assert.equal((await verifyStaged(root)).findings.length, 0);
  assert.equal((await git(['ls-files', '--', '.env'])).trim(), '');
  assert.equal((await readFile(path.join(root, '.env'), 'utf8')).includes(fake), false);
  await git(['commit', '-m', 'fixed safely']);
  assert.equal((await runCli(['precommit'])).code, 0);

  await writeFile(path.join(root, 'config.ts'), `const apiKey = "${fake}";\n`);
  await git(['add', 'config.ts']);
  const nextId = (await verifyStaged(root)).findings[0].id;
  await git(['add', '-f', '.env']);
  await assert.rejects(planFix(root, nextId), /Untrack/);
  console.log('Security tests passed: categories, added lines, redaction, hook chaining, blocked commit, safe fix, clean commit, stale/partial staging and tracked .env protections.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
