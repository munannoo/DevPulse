import type { LlmConfig } from './config';
import { redact } from '../security/redact';
export class ModelListError extends Error {}
export function validModelId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value) && redact(value) === value;
}
export async function listModels(config: LlmConfig, signal?: AbortSignal): Promise<string[]> {
  try {
    const response = await fetch(`${config.baseUrl}/models`, { redirect: 'error',
      signal: AbortSignal.any([AbortSignal.timeout(8000), ...(signal ? [signal] : [])]),
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {} });
    if (!response.ok) { await response.body?.cancel(); throw new ModelListError(`Could not list Gemma models (HTTP ${response.status}). Check the server configuration.`); }
    const reader = response.body?.getReader(); if (!reader) { throw new ModelListError('Gemma returned an empty model list.'); }
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) { break; }
        size += value.length; if (size > 100_000) { throw new ModelListError('Gemma model list exceeds the size limit.'); }
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { data?: Array<{ id?: unknown }> };
    if (!Array.isArray(body?.data)) { throw new ModelListError('Gemma returned an invalid model list.'); }
    return [...new Set(body.data.map(item => item?.id).filter(validModelId))].sort().slice(0, 200);
  } catch (error) {
    if (error instanceof ModelListError) { throw error; }
    throw new ModelListError(signal?.aborted ? 'Model selection cancelled.' : 'Gemma model list is unavailable. Check the server and try again.');
  }
}
