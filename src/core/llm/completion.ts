import { scanSecretSpans } from '../security/secretPatterns';
import { redact } from '../security/redact';

export function completionContext(text: string, offset: number): { prefix: string; suffix: string } | undefined {
  const spans = scanSecretSpans(text);
  if (spans.some(span => span.start <= offset && offset < span.end)) { return undefined; }
  const window = (start: number, end: number) => {
    let result = '', cursor = start;
    for (const span of spans) {
      if (span.end <= cursor || span.start >= end) { continue; }
      const left = Math.max(cursor, span.start), right = Math.min(end, span.end);
      result += text.slice(cursor, left) + '<REDACTED_SECRET>';
      cursor = right;
    }
    return result + text.slice(cursor, end);
  };
  return { prefix: window(Math.max(0, offset - 1500), offset).slice(-1500),
    suffix: window(offset, Math.min(text.length, offset + 500)).slice(0, 500) };
}

export function cleanCompletionText(text: string): string {
  let code = text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trimEnd();
  const block = /```[^\r\n]*\r?\n([\s\S]*?)(?:```|$)/.exec(code);
  if (block) { code = block[1].replace(/\r?\n$/, ''); }
  else if (/^\s*(?:Here(?:'s| is)|Sure\b|The following\b|Explanation:|To (?:complete|implement)\b|#{1,6}\s)/i.test(code)) { return ''; }
  if (code.length > 2000 || code.includes('<REDACTED_SECRET>') || redact(code) !== code) { return ''; }
  return code;
}

export function stripCompletionPrefix(code: string, prefix: string): string {
  // Models may echo several trailing source lines, including cursor indentation.
  code = code.replace(/\r\n/g, '\n');
  prefix = prefix.replace(/\r\n/g, '\n');
  for (let start = 0; start < prefix.length;) {
    const suffix = prefix.slice(start);
    if (code.startsWith(suffix)) { return code.slice(suffix.length); }
    const newline = prefix.indexOf('\n', start);
    if (newline === -1) { break; }
    start = newline + 1;
  }
  return code;
}
