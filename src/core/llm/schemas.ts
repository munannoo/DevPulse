import type { ReviewInput } from '../git/diff';
import { redact } from '../security/redact';

export type Finding = {
  file: string; startLine: number; endLine: number;
  severity: 'warning' | 'security' | 'context';
  title: string; explanation: string; suggestion?: string; replacement?: string;
};
export type ReviewResult = { summary: string; findings: Finding[] };
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { throw new Error('Expected an object.'); }
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim()) { throw new Error('Expected text.'); }
  return redact(value.trim()).slice(0, max);
}
export function validateReview(value: unknown, input: ReviewInput): ReviewResult {
  const data = record(value);
  if (!Array.isArray(data.findings) || data.findings.length > 8) { throw new Error('Expected at most eight findings.'); }
  const findings: Finding[] = [];
  for (const item of data.findings) {
    const finding = record(item);
    if (finding.file !== input.file || !['warning', 'security', 'context'].includes(String(finding.severity))) {
      throw new Error('Unknown file or severity.');
    }
    if (typeof finding.startLine !== 'number' || !Number.isFinite(finding.startLine)
      || typeof finding.endLine !== 'number' || !Number.isFinite(finding.endLine)) { throw new Error('Invalid lines.'); }
    const startLine = Math.max(1, Math.min(input.lineCount, Math.trunc(finding.startLine)));
    let endLine = Math.max(startLine, Math.min(input.lineCount, Math.trunc(finding.endLine)));
    const changed = input.changedRanges?.find(range => startLine >= range.start && startLine <= range.end);
    if (input.changedRanges && !changed) { continue; }
    if (changed) { endLine = Math.min(endLine, changed.end); }
    // Only exact, bounded ranges can become edits. Never insert redacted placeholders.
    const replacement = typeof finding.replacement === 'string'
      && finding.replacement.length <= 4000 && finding.replacement.trim()
      && !finding.replacement.includes('```') && !finding.replacement.includes('<REDACTED_SECRET>')
      && redact(finding.replacement) === finding.replacement
      && finding.startLine === startLine && finding.endLine === endLine
      ? finding.replacement : undefined;
    findings.push({
      file: input.file, startLine, endLine, severity: finding.severity as Finding['severity'],
      title: text(finding.title, 60), explanation: text(finding.explanation, 1200),
      ...(finding.suggestion === undefined ? {} : { suggestion: text(finding.suggestion, 4000) }),
      ...(replacement === undefined ? {} : { replacement }),
    });
  }
  return { summary: data.summary === undefined ? '' : text(data.summary, 1600), findings };
}
