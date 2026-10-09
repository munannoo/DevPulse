import { mkdir, writeFile, rename } from 'node:fs/promises';
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
  await writeFile(temporary, JSON.stringify(result), { mode: 0o600 });
  await rename(temporary, target);
  return result;
}
