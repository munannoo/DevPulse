export type SecretMatch = { start: number; end: number; kind: string };
const patterns: ReadonlyArray<[string, RegExp]> = [
  ['private key', /-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g],
  ['AWS key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['API token', /\b(?:sk_(?:test_|live_)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g],
  ['JWT', /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g],
  ['connection string', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:'"`]+:[^\s/@'"`]+@[^\s'"`]+/gi],
  ['secret assignment', /\b[\w.-]*(?:api[_-]?key|secret|password|passwd|token|authorization)[\w.-]*\s*[=:]\s*(?:["'`][^"'`\r\n]+["'`]|[^\s,;\r\n}]+)/gi],
  ['environment value', /^\s*(?:export\s+)?[A-Z][A-Z0-9_]{2,}\s*=\s*[^\r\n]+/gm],
];

export function scanSecrets(text: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const [kind, pattern] of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      matches.push({ start: match.index, end: match.index + match[0].length, kind });
    }
  }
  return matches.sort((a, b) => a.start - b.start || b.end - a.end);
}
