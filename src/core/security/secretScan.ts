import { createHash } from 'node:crypto';
import { addedLines } from '../git/diff';

export type SecretFinding = {
  id: string;
  file: string;
  startLine: number;
  endLine: number;
  severity: 'security';
  title: string;
  explanation: string;
  canFix: boolean;
};

const patterns = [
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\b(?:sk_(?:test|live)_[A-Za-z0-9]{12,}|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[A-Za-z0-9_-]{30,})\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s'"@:]+:[^\s'"@]+@[^\s'"]+/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g,
  /\b[A-Za-z_$][\w$]*(?:key|token|secret|password|passwd)[\w$]*\s*[:=]\s*(['"])([^'"\r\n]{8,})\1/gi,
  /\b(?:key|token|secret|password|passwd)\s*[:=]\s*(['"])([^'"\r\n]{8,})\1/gi,
  /^\s*(?:export\s+)?[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*(?!process\.|\$|<)[^\s#]{8,}/g,
];

export function containsSecret(text: string): boolean {
  return patterns.some(pattern => { pattern.lastIndex = 0; return pattern.test(text); });
}

export { redact } from './redact';

// Only a standalone JS/TS literal assignment has an unambiguous env replacement.
export function literalAssignment(text: string): { start: number; end: number; name: string } | undefined {
  const match = /^\s*(?:(?:export\s+)?(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=\s*(['"])([^'"\\\r\n]+)\2\s*;?\s*$/.exec(text);
  if (!match || !containsSecret(text)) { return undefined; }
  const start = text.indexOf(match[2], text.indexOf('='));
  const name = match[1].replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/\W/g, '_').toUpperCase();
  return { start, end: start + match[3].length + 2, name };
}

export function scanSecrets(diff: string): SecretFinding[] {
  return addedLines(diff).filter(item => containsSecret(item.text)).map(item => ({
    id: createHash('sha256').update(`${item.file}\0${item.line}\0${item.text}`).digest('hex'),
    file: item.file,
    startLine: item.line,
    endLine: item.line,
    severity: 'security',
    title: 'Possible hardcoded credential',
    explanation: 'An added staged line contains a possible secret. Move it to an environment variable before committing.',
    canFix: /\.[cm]?[jt]sx?$/.test(item.file) && !!literalAssignment(item.text),
  }));
}
