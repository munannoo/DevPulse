import { lstat, readFile, realpath } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { git } from './repo';
import { contentHash } from '../llm/cache';

export type LineRange = { start: number; end: number };
export type ReviewInput = {
  file: string; content: string; lineCount: number; changedRanges?: LineRange[]; sourceHash?: string;
  kind?: 'code' | 'diff';
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
  const merged: LineRange[] = [];
  for (const range of ranges.filter(range => range.start >= 1 && range.start <= lineCount)) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + 1) { previous.end = Math.max(previous.end, range.end); }
    else { merged.push({ ...range }); }
  }
  return merged;
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
  for (const file of files) {
    signal?.throwIfAborted();
    if (isSensitiveFile(file) || /(^|\/)(?:node_modules|dist|\.git)\//.test(file) || /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(file)) {
      skipped.push(`${file}: private or generated file`); continue;
    }
    if (inputs.length >= 20) { skipped.push(`${file}: 20-file limit`); continue; }
    try {
      const info = await lstat(resolve(root, file));
      if (!info.isFile() || info.isSymbolicLink() || info.size > 1_000_000) {
        skipped.push(`${file}: not a regular text file or exceeds 1 MB`); continue;
      }
      const text = await readFile(await safeFile(root, file), 'utf8');
      if (text.includes('\0') || text.includes('\uFFFD')) { skipped.push(`${file}: binary file`); continue; }
      const lineCount = Math.max(1, text.split('\n').length);
      let content = hasHead ? await git(root, ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=3', 'HEAD', '--', file], signal) : '';
      const ranges = content ? changedRanges(content, lineCount) : [{ start: 1, end: lineCount }];
      const kind = content ? 'diff' : 'code';
      if (!content) { content = text; }
      inputs.push({ file: file.replace(/\\/g, '/'), content, kind, lineCount, changedRanges: ranges, sourceHash: contentHash(text) });
    } catch (error) {
      signal?.throwIfAborted();
      skipped.push(`${file}: deleted, unreadable, or unavailable`);
    }
  }
  return { inputs, skipped };
}


export type AddedLine = { file: string; line: number; text: string };

function diffPath(header: string): string {
  // Git quotes names containing tabs, newlines, quotes or backslashes even with quotepath=false.
  const value = header.startsWith('"') ? header.slice(1, -1).replace(/\\([0-7]{1,3}|[abfnrtv\\"])/g, (_, code: string) => {
    const escapes: Record<string, string> = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', '"': '"' };
    return escapes[code] ?? String.fromCharCode(parseInt(code, 8));
  }) : header;
  return value.startsWith('b/') ? value.slice(2) : '';
}

export async function stagedDiff(root: string): Promise<string> {
  return git(root, ['-c', 'core.quotepath=false', 'diff', '--cached', '--no-ext-diff', '--no-textconv', '--unified=0', '--no-color']);
}

export function addedLines(diff: string): AddedLine[] {
  const result: AddedLine[] = [];
  let file = '';
  let line = 0;
  let inHunk = false;
  for (const text of diff.split('\n')) {
    if (text.startsWith('diff --git ')) {
      file = '';
      inHunk = false;
    } else if (!inHunk && text.startsWith('+++ ')) {
      file = diffPath(text.slice(4));
    } else if (text.startsWith('@@ ')) {
      const match = /\+(\d+)(?:,\d+)? @@/.exec(text);
      line = match ? Number(match[1]) : 0;
      inHunk = true;
    } else if (inHunk && text.startsWith('+')) {
      if (file && line > 0) { result.push({ file, line, text: text.slice(1).replace(/\r$/, '') }); }
      line++;
    } else if (inHunk && text.startsWith(' ')) {
      line++;
    }
  }
  return result;
}
