import { readFile, realpath, lstat } from 'node:fs/promises';
import * as path from 'node:path';
import { git } from '../git/repo';
import { verifyStaged } from './precommit';
import { literalAssignment, redact } from './secretScan';

export type FixPlan = {
  file: string;
  original: string;
  replacement: string;
  env: string;
  ignore: string;
  originalEnv: string;
  originalIgnore: string;
  preview: string;
};

async function readOptional(file: string): Promise<string> {
  try { return await readFile(file, 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return ''; }
    throw new Error('Cannot read fix files.');
  }
}

export async function safeFile(root: string, file: string): Promise<string> {
  const base = await realpath(root);
  const target = path.resolve(base, file);
  const relative = path.relative(base, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) { throw new Error('File is outside the repository.'); }
  const actual = await realpath(target);
  if (actual !== target || !(await lstat(target)).isFile()) { throw new Error('Symlink fixes are not supported.'); }
  return target;
}

async function safeOptional(root: string, name: string): Promise<void> {
  try { await safeFile(root, name); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
  }
}

export async function planFix(root: string, id: string): Promise<FixPlan> {
  const scan = await verifyStaged(root);
  const finding = scan.findings.find(item => item.id === id);
  if (!finding?.canFix) { throw new Error('Scan again. This finding has changed or requires a manual fix.'); }
  const file = await safeFile(root, finding.file);
  if (await git(root, ['diff', '--name-only', '--', finding.file])) {
    throw new Error('This file has unstaged edits. Stage or save them separately before fixing.');
  }
  if ((await git(root, ['ls-files', '--', '.env'])).trim()) { throw new Error('Untrack .env before applying a fix.'); }
  await safeOptional(root, '.env');
  await safeOptional(root, '.gitignore');
  if (await git(root, ['diff', '--name-only', '--', '.gitignore'])) { throw new Error('.gitignore has unstaged edits. Stage them before fixing.'); }
  const original = await readFile(file, 'utf8');
  const lines = original.split('\n');
  const line = lines[finding.startLine - 1];
  const literal = literalAssignment(line?.replace(/\r$/, '') ?? '');
  if (!literal) { throw new Error('The source changed. Scan again before fixing.'); }
  lines[finding.startLine - 1] = line.slice(0, literal.start) + `process.env.${literal.name}` + line.slice(literal.end);
  const originalEnv = await readOptional(path.join(root, '.env'));
  const originalIgnore = await readOptional(path.join(root, '.gitignore'));
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const append = (text: string, extra: string) => text + (text && !text.endsWith('\n') ? eol : '') + extra + eol;
  const env = new RegExp(`^${literal.name}=`, 'm').test(originalEnv) ? originalEnv : append(originalEnv, `${literal.name}=`);
  const ignore = append(originalIgnore, '/.env');
  return {
    file: finding.file, original, replacement: lines.join('\n'), env, ignore, originalEnv, originalIgnore,
    preview: `--- ${finding.file}\n+++ ${finding.file}\n- ${redact(line)}\n+ ${redact(lines[finding.startLine - 1])}\n\n.env: add ${literal.name}= (empty if missing)\n.gitignore: ignore /.env\nRe-stage the fixed file and .gitignore. Set the value in your local .env.`,
  };
}

export async function validatePlan(root: string, plan: FixPlan): Promise<void> {
  const file = await safeFile(root, plan.file);
  await safeOptional(root, '.env');
  await safeOptional(root, '.gitignore');
  if (await readFile(file, 'utf8') !== plan.original ||
    await readOptional(path.join(root, '.env')) !== plan.originalEnv ||
    await readOptional(path.join(root, '.gitignore')) !== plan.originalIgnore ||
    await git(root, ['diff', '--name-only', '--', plan.file, '.gitignore'])) {
    throw new Error('Files changed while previewing. Scan and preview again.');
  }
  if ((await git(root, ['ls-files', '--', '.env'])).trim()) { throw new Error('Untrack .env before applying a fix.'); }
}

export async function stageFix(root: string, plan: FixPlan): Promise<void> {
  await git(root, ['add', '--', plan.file, '.gitignore']);
  await git(root, ['check-ignore', '--', '.env']);
  await verifyStaged(root);
}
