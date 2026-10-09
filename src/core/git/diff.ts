import { lstat, readFile, realpath } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { git } from './repo';
import { contentHash } from '../llm/cache';

export type LineRange = { start: number; end: number };
export type ReviewInput = {
  file: string; content: string; lineCount: number; changedRanges?: LineRange[]; sourceHash?: string;
};
export function changedRanges(diff: string, lineCount: number): LineRange[] {
  const ranges: LineRange[] = [];
  let line = 0;
  let removed = false;
  const anchor = () => {
    if (removed) { ranges.push({ start: Math.max(1, Math.min(line, lineCount)), end: Math.max(1, Math.min(line, lineCount)) }); }
    removed = false;
  };
  for (const text of diff.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) { anchor(); line = Math.max(1, Number(hunk[1])); continue; }
    if (!line || text.startsWith('\\')) { continue; }
    if (text.startsWith('+')) { ranges.push({ start: line, end: line }); line++; removed = false; }
    else if (text.startsWith('-')) { removed = true; }
    else if (text.startsWith(' ')) {
      anchor(); line++;
    }
  }
  anchor();
  return ranges.filter(range => range.start >= 1 && range.start <= lineCount);
}
export function isSensitiveFile(file: string): boolean {
  const name = basename(file).toLowerCase();
  return name === '.env' || name.startsWith('.env.') || /\.(?:pem|key|p12|pfx|keystore)$/.test(name)
    || /^(?:id_rsa|id_ed25519|credentials)$/.test(name);
}
export async function safeFile(root: string, file: string): Promise<string> {
  const candidate = resolve(root, file);
  const resolvedRoot = await realpath(root);
  const resolvedFile = await realpath(candidate);
  const rel = relative(resolvedRoot, resolvedFile);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) { throw new Error('File is outside the repository.'); }
  return resolvedFile;
}
export async function collectChanges(root: string, hasHead: boolean, signal?: AbortSignal): Promise<{ inputs: ReviewInput[]; skipped: string[] }> {
  const tracked = hasHead ? await git(root, ['diff', '--name-only', '-z', 'HEAD', '--'], signal)
    : await git(root, ['ls-files', '-z'], signal);
  const untracked = await git(root, ['ls-files', '--others', '--exclude-standard', '-z'], signal);
  const files = [...new Set((tracked + untracked).split('\0').filter(Boolean))];
  const inputs: ReviewInput[] = [];
  const skipped: string[] = [];
  let total = 0;
  for (const file of files) {
    signal?.throwIfAborted();
    if (isSensitiveFile(file) || /(^|\/)(?:node_modules|dist|\.git)\//.test(file) || /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(file)) {
      skipped.push(`${file}: private or generated file`); continue;
    }
    if (inputs.length >= 20) { skipped.push(`${file}: 20-file limit`); continue; }
    try {
      const info = await lstat(resolve(root, file));
      if (!info.isFile() || info.isSymbolicLink() || info.size > 64_000) {
        skipped.push(`${file}: not a regular text file or exceeds 64 KB`); continue;
      }
      const text = await readFile(await safeFile(root, file), 'utf8');
      if (text.includes('\0') || text.includes('\uFFFD')) { skipped.push(`${file}: binary file`); continue; }
      const lineCount = Math.max(1, text.split('\n').length);
      let content = hasHead ? await git(root, ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=3', 'HEAD', '--', file], signal) : '';
      const ranges = content ? changedRanges(content, lineCount) : [{ start: 1, end: lineCount }];
      if (!content) { content = text; }
      if (content.length > 24_000 || total + content.length > 80_000) {
        skipped.push(`${file}: review size limit`); continue;
      }
      inputs.push({ file: file.replace(/\\/g, '/'), content, lineCount, changedRanges: ranges, sourceHash: contentHash(text) });
      total += content.length;
    } catch (error) {
      signal?.throwIfAborted();
      skipped.push(`${file}: deleted, unreadable, or unavailable`);
    }
  }
  return { inputs, skipped };
}
