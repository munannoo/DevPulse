import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';

const execute = promisify(execFile);

export async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const result = await execute('git', args, { cwd, timeout: 15_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    return result.stdout;
  } catch {
    // Git stderr can contain credentials or source lines. Never forward it.
    throw new Error('Git operation failed. Check the repository and try again.');
  }
}

export async function repository(cwd: string): Promise<string> {
  return (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
}

export async function gitPath(root: string, name: string): Promise<string> {
  return path.resolve(root, (await git(root, ['rev-parse', '--git-path', name])).trim());
}
