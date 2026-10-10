import type { ReviewInput } from '../git/diff';
import { redact } from '../security/redact';
import type { CodeFlow } from '../review/flow';

export type Finding = {
  file: string; startLine: number; endLine: number;
  severity: 'warning' | 'security' | 'context';
  title: string; explanation: string; suggestion?: string; replacement?: string;
  flow?: CodeFlow;
};
export type ReviewResult = { summary: string; findings: Finding[] };
export function reviewResponseSchema(input: ReviewInput): Record<string, unknown> {
  return {
    type: 'object', additionalProperties: false, required: ['summary', 'findings'],
    properties: {
      summary: { type: 'string', minLength: 1, maxLength: 800 },
      findings: { type: 'array', maxItems: 8, items: {
        type: 'object', additionalProperties: false,
        required: ['file', 'startLine', 'endLine', 'severity', 'title', 'explanation'],
        properties: {
          file: { type: 'string', enum: [input.file] },
          startLine: { type: 'integer', minimum: 1, maximum: input.lineCount },
          endLine: { type: 'integer', minimum: 1, maximum: input.lineCount },
          severity: { type: 'string', enum: ['warning', 'security', 'context'] },
          title: { type: 'string', minLength: 1, maxLength: 60 },
          explanation: { type: 'string', minLength: 1, maxLength: 500 },
          suggestion: { type: 'string', minLength: 1, maxLength: 500 },
          replacement: { type: 'string', minLength: 1, maxLength: 800 },
          flow: { type: 'object', additionalProperties: false, required: ['nodes', 'edges'], properties: {
            nodes: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'object', additionalProperties: false, required: ['label', 'line'], properties: {
              label: { type: 'string', minLength: 1, maxLength: 80 }, line: { type: 'integer', minimum: 1, maximum: input.lineCount },
            } } },
            edges: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['from', 'to'], properties: {
              from: { type: 'integer', minimum: 0, maximum: 5 }, to: { type: 'integer', minimum: 0, maximum: 5 }, label: { type: 'string', minLength: 1, maxLength: 40 },
            } } },
          } },
        },
      } },
    },
  };
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { throw new Error('Expected an object.'); }
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim()) { throw new Error('Expected text.'); }
  return redact(value.trim()).slice(0, max);
}
function validateFlow(value: unknown, input: ReviewInput): CodeFlow {
  const data = record(value);
  if (!Array.isArray(data.nodes) || data.nodes.length < 2 || data.nodes.length > 6
    || !Array.isArray(data.edges) || !data.edges.length || data.edges.length > 8) { throw new Error('Invalid code flow size.'); }
  const nodes = data.nodes.map(value => {
    const item = record(value);
    if (!Number.isSafeInteger(item.line) || Number(item.line) < 1 || Number(item.line) > input.lineCount
      || input.changedRanges && !input.changedRanges.some(range => Number(item.line) >= range.start && Number(item.line) <= range.end)) { throw new Error('Invalid code flow line.'); }
    return { label: text(item.label, 80), line: Number(item.line) };
  });
  const edges = data.edges.map(value => {
    const item = record(value);
    if (!Number.isSafeInteger(item.from) || !Number.isSafeInteger(item.to)
      || Number(item.from) < 0 || Number(item.from) >= nodes.length || Number(item.to) < 0 || Number(item.to) >= nodes.length) { throw new Error('Invalid code flow edge.'); }
    return { from: Number(item.from), to: Number(item.to), ...(item.label === undefined ? {} : { label: text(item.label, 40) }) };
  });
  return { nodes, edges };
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
      ...(finding.flow === undefined ? {} : { flow: validateFlow(finding.flow, input) }),
    });
  }
  return { summary: data.summary === undefined ? '' : text(data.summary, 1600), findings };
}
