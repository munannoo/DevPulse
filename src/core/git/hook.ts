import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import * as path from 'node:path';
import { gitPath } from './repo';
import { nodeRuntime } from './nodeRuntime';

const marker = '# DevPulse pre-commit guard';
const quote = (text: string) => `'${text.replace(/'/g, `'"'"'`)}'`;

export async function installHook(root: string, cli: string, ai?: boolean): Promise<void> {
  const hook = await gitPath(root, 'hooks/pre-commit');
  const node = await nodeRuntime();
  const unix = (file: string) => file.replace(/\\/g, '/');
  const command = (ai: boolean) => `${quote(unix(node))} ${quote(unix(path.resolve(cli)))} precommit${ai ? ' --ai' : ''} || exit $?`;
  await mkdir(path.dirname(hook), { recursive: true });
  let existing = '';
  try { existing = await readFile(hook, 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw new Error('Cannot read the existing hook.'); }
  }
  if (existing.includes(marker)) {
    const lines = existing.match(/^.+ precommit(?: --ai)? \|\| exit \$\?\r?$/gm);
    if (lines?.length !== 1) { throw new Error('Existing DevPulse guard cannot be updated safely.'); }
    const updated = existing.replace(lines[0], command(ai ?? lines[0].includes(' precommit --ai ')));
    if (updated === existing) { return; }
    await writeFile(hook, updated, { mode: 0o755 });
    await chmod(hook, 0o755); return;
  }
  const backup = `${hook}.devpulse-backup`;
  if (existing) { await writeFile(backup, existing, { flag: 'wx', mode: 0o755 }); }
  // Git for Windows shell accepts forward slashes in absolute executable paths.
  const chain = existing ? `\n${quote(unix(backup))} "$@" || exit $?\n` : '\n';
  await writeFile(hook, `#!/bin/sh\n${marker}\n${command(Boolean(ai))}${chain}exit 0\n`, { mode: 0o755 });
  await chmod(hook, 0o755);
}
