import { scanSecretSpans } from './secretPatterns';

export function redact(text: string): string {
  let result = '';
  let cursor = 0;
  for (const match of scanSecretSpans(text)) {
    if (match.end <= cursor) { continue; }
    const start = Math.max(match.start, cursor);
    result += text.slice(cursor, start);
    // Keep destination line numbers unchanged for multiline secrets.
    result += '<REDACTED_SECRET>' + (text.slice(start, match.end).match(/\n/g) ?? []).join('');
    cursor = match.end;
  }
  return result + text.slice(cursor);
}
