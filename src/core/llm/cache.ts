import { createHash } from 'node:crypto';
const entries = new Map<string, { text: string; expires: number }>();
const maxBytes = 2 * 1024 * 1024;
let bytes = 0;
export function deleteCached(key: string): void {
  const item = entries.get(key);
  if (item) { bytes -= Buffer.byteLength(item.text); entries.delete(key); }
}
export function clearCached(): void { entries.clear(); bytes = 0; }
export function contentHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
export function getCached(key: string): string | undefined {
  const item = entries.get(key);
  if (!item || item.expires <= Date.now()) { deleteCached(key); return undefined; }
  entries.delete(key); entries.set(key, item);
  return item.text;
}
export function setCached(key: string, text: string, ttlMs = 5 * 60_000): void {
  deleteCached(key);
  const size = Buffer.byteLength(text);
  if (size > maxBytes || ttlMs <= 0) { return; }
  for (const [key, item] of entries) { if (item.expires <= Date.now()) { deleteCached(key); } }
  while (entries.size >= 64 || bytes + size > maxBytes) { deleteCached(entries.keys().next().value!); }
  entries.set(key, { text, expires: Date.now() + ttlMs }); bytes += size;
}
