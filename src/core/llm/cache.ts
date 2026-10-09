import { createHash } from 'node:crypto';
const entries = new Map<string, { text: string; expires: number }>();
export function contentHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
export function getCached(key: string): string | undefined {
  const item = entries.get(key);
  if (!item || item.expires < Date.now()) { entries.delete(key); return undefined; }
  return item.text;
}
export function setCached(key: string, text: string): void {
  if (entries.size >= 64) { entries.delete(entries.keys().next().value!); }
  entries.set(key, { text, expires: Date.now() + 5 * 60_000 });
}
