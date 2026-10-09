import type { Finding } from '../llm/schemas';
import { redact } from '../security/redact';

export type SuggestionEdit = { start: number; end: number; replacement: string; proposed: string };

/** Replace complete line contents, preserving the following newline and the file's EOL. */
export function suggestionEdit(source: string, finding: Finding): SuggestionEdit | undefined {
  const replacement = finding.replacement;
  if (!replacement?.trim() || replacement.length > 4000 || replacement.includes('```')
    || replacement.includes('<REDACTED_SECRET>') || redact(replacement) !== replacement) { return undefined; }
  const lines = source.split('\n');
  if (!Number.isInteger(finding.startLine) || !Number.isInteger(finding.endLine)
    || finding.startLine < 1 || finding.endLine < finding.startLine || finding.endLine > lines.length) { return undefined; }
  const start = lines.slice(0, finding.startLine - 1).reduce((length, line) => length + line.length + 1, 0);
  const end = start + lines.slice(finding.startLine - 1, finding.endLine).join('\n').replace(/\r$/, '').length;
  const original = source.slice(start, end);
  if (redact(original) !== original || original.includes('<REDACTED_SECRET>')) { return undefined; }
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const code = replacement.replace(/\r\n|\r|\n/g, '\n').replace(/\n$/, '').replace(/\n/g, eol);
  if (code === original) { return undefined; }
  return { start, end, replacement: code, proposed: source.slice(0, start) + code + source.slice(end) };
}
