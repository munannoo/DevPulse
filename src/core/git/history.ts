import { git } from './repo';
import { safeFile } from './diff';
import { redact } from '../security/redact';

export type FileCommit = { hash: string; author: string; date: string; subject: string };

export async function recentFileCommits(root: string, file: string, signal?: AbortSignal): Promise<FileCommit[]> {
  await safeFile(root, file);
  const output = await git(root, ['log', '-3', '--format=%h%x00%an%x00%ad%x00%s', '--date=short', '--', file], signal, 3000);
  return output.split('\n').flatMap(line => {
    const [hash, author, date, subject] = line.trim().split('\0');
    if (!/^[a-f0-9]{7,40}$/.test(hash ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !author || !subject) { return []; }
    return [{ hash, author: redact(author).slice(0, 80), date, subject: redact(subject).slice(0, 160) }];
  }).slice(0, 3);
}
