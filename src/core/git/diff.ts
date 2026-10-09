import { git } from './repo';

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
