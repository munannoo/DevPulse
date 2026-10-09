import type { ReviewInput } from '../git/diff';
import type { LlmConfig } from '../llm/config';
import { createLlm } from '../llm/client';
import { reviewPrompt } from '../llm/prompts';
import { validateReview } from '../llm/schemas';
import { redact } from '../security/redact';

export async function analyze(input: ReviewInput, config: LlmConfig, signal?: AbortSignal) {
  if (input.content.length > 24_000) { throw new Error('This review exceeds the 24,000-character limit. Review a smaller selection.'); }
  return createLlm(config).chat({
    system: reviewPrompt,
    user: `File: ${input.file}\nDestination lines: ${input.lineCount}\nChanged ranges: ${JSON.stringify(input.changedRanges ?? 'whole file')}\nCode or diff:\n${redact(input.content)}`,
    json: value => validateReview(value, input), signal, maxTokens: 1800,
  });
}
