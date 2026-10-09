import type { ReviewInput } from '../git/diff';

export const maxReviewCharacters = 24_000;
export class ReviewLimitError extends Error {}
type NumberedLine = { line: number; content: string };

export function chunkReview(input: ReviewInput, limit = maxReviewCharacters): ReviewInput[] {
  if (!Number.isInteger(limit) || limit < 128) { throw new ReviewLimitError('Invalid review chunk size.'); }
  if (input.content.length <= limit) { return [input]; }
  const numbered: NumberedLine[] = [];
  const isDiff = input.kind === 'diff';
  let line = isDiff ? 0 : input.changedRanges?.[0]?.start ?? 1;
  for (const text of input.content.split('\n')) {
    if (isDiff) {
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
      if (hunk) { line = Math.max(1, Number(hunk[1])); continue; }
      if (!line || text.startsWith('\\') || !/^[+ -]/.test(text)) { continue; }
    }
    const destination = Math.max(1, Math.min(line, input.lineCount));
    numbered.push({ line: destination, content: `${destination}: ${text}\n` });
    if (!isDiff || !text.startsWith('-')) { line++; }
  }
  const chunks: ReviewInput[] = [];
  let current: NumberedLine[] = [];
  let size = 0;
  const header = isDiff ? 'Diff excerpt with numbered destination lines; - denotes removed code.\n' : 'Code excerpt with original file line numbers.\n';
  function flush(): void {
    if (!current.length) { return; }
    const start = Math.min(...current.map(item => item.line));
    const end = Math.max(...current.map(item => item.line));
    const ranges = input.changedRanges?.map(range => ({ start: Math.max(start, range.start), end: Math.min(end, range.end) })).filter(range => range.start <= range.end)
      ?? [{ start, end }];
    if (ranges.length) {
      chunks.push({ ...input, content: header + current.map(item => item.content).join(''), changedRanges: ranges });
      if (chunks.length > 32) { throw new ReviewLimitError('This file needs more than 32 review parts. Review a smaller selection.'); }
    }
  }
  for (const item of numbered) {
    if (header.length + item.content.length > limit) { throw new ReviewLimitError('One code line exceeds the review limit. Review a smaller selection.'); }
    if (header.length + size + item.content.length > limit) {
      flush();
      // Keep a small amount of boundary context without increasing the per-call limit.
      current = current.slice(-3);
      size = current.reduce((total, record) => total + record.content.length, 0);
      if (header.length + size + item.content.length > limit) { current = []; size = 0; }
    }
    current.push(item); size += item.content.length;
  }
  flush();
  return chunks;
}
