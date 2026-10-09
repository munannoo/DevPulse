import type { ReviewInput } from '../git/diff';
import type { LlmConfig } from '../llm/config';
import { createLlm } from '../llm/client';
import { reviewPrompt } from '../llm/prompts';
import { validateReview, reviewResponseSchema, type Finding, type ReviewResult } from '../llm/schemas';
import { redact } from '../security/redact';
import { chunkReview } from './chunks';

export async function analyze(input: ReviewInput, config: LlmConfig, signal?: AbortSignal,
  onProgress?: (part: number, total: number) => void): Promise<ReviewResult> {
  // Redact the complete input before splitting so multiline secrets cannot cross a boundary.
  const originalLines = input.content.split('\n');
  const content = redact(input.content).split('\n').map((text, index) => {
    const hunk = input.kind === 'diff' ? /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(originalLines[index]) : undefined;
    if (hunk) { return hunk[0]; }
    const prefix = originalLines[index]?.[0];
    // Redaction keeps newlines but may remove the diff markers inside a private key block.
    return input.kind === 'diff' && prefix && '+- '.includes(prefix) && !text.startsWith(prefix) ? prefix + text : text;
  }).join('\n');
  const chunks = chunkReview({ ...input, content });
  const llm = createLlm(config);
  const findings = new Map<string, Finding>();
  const summaries: string[] = [];
  for (const [index, chunk] of chunks.entries()) {
    signal?.throwIfAborted();
    onProgress?.(index + 1, chunks.length);
    const result = await llm.chat({
      system: reviewPrompt,
      user: `File: ${chunk.file}\nDestination lines: ${chunk.lineCount}\nChanged ranges: ${JSON.stringify(chunk.changedRanges ?? 'whole file')}\nCode or diff:\n${chunk.content}`,
      json: value => validateReview(value, chunk), responseSchema: reviewResponseSchema(chunk), signal, maxTokens: 1800,
    });
    if (result.summary) { summaries.push(result.summary); }
    for (const finding of result.findings) {
      findings.set(`${finding.startLine}:${finding.severity}:${finding.title.toLowerCase()}`, finding);
    }
  }
  const rank = { security: 0, warning: 1, context: 2 };
  return { summary: summaries.join(' ').slice(0, 1600),
    findings: [...findings.values()].sort((a, b) => rank[a.severity] - rank[b.severity] || a.startLine - b.startLine).slice(0, 8) };
}
