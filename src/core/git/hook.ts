import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import * as path from 'node:path';
import { gitPath } from './repo';

const marker = '# DevPulse pre-commit guard';
const quote = (text: string) => `'${text.replace(/'/g, `'"'"'`)}'`;

export async function installHook(root: string, cli: string): Promise<void> {
  const hook = await gitPath(root, 'hooks/pre-commit');
  await mkdir(path.dirname(hook), { recursive: true });
  let existing = '';
  try { existing = await readFile(hook, 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw new Error('Cannot read the existing hook.'); }
  }
  if (existing.includes(marker)) { return; }
  const backup = `${hook}.devpulse-backup`;
  if (existing) { await writeFile(backup, existing, { flag: 'wx', mode: 0o755 }); }
  // Git for Windows shell accepts forward slashes in absolute executable paths.
  const unix = (file: string) => file.replace(/\\/g, '/');
  const chain = existing ? `\n${quote(unix(backup))} "$@" || exit $?\n` : '\n';
  await writeFile(hook, `#!/bin/sh\n${marker}\n${quote(unix(process.execPath))} ${quote(unix(path.resolve(cli)))} precommit || exit $?${chain}exit 0\n`, { mode: 0o755 });
  await chmod(hook, 0o755);
}
