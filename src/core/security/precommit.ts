import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { stagedDiff } from '../git/diff';
import { gitPath } from '../git/repo';
import { scanSecrets, SecretFinding } from './secretScan';

export type ScanResult = { timestamp: string; findings: SecretFinding[] };

export async function verifyStaged(root: string): Promise<ScanResult> {
  const result = { timestamp: new Date().toISOString(), findings: scanSecrets(await stagedDiff(root)) };
  const target = await gitPath(root, 'devpulse/last-scan.json');
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(result), { mode: 0o600 });
    // Windows readers and file watchers can briefly lock the destination.
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, target); break; } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 7 || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) { throw error; }
        await delay(50 * (attempt + 1));
      }
    }
  } finally { await rm(temporary, { force: true }); }
  return result;
}
