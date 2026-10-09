import type { LlmConfig } from './config';

export async function ping(config: LlmConfig): Promise<{ reachable: boolean; modelFound?: boolean; latencyMs: number }> {
  const started = Date.now();
  try {
    const response = await fetch(`${config.baseUrl}/models`, {
      signal: AbortSignal.timeout(8000), headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
    });
    if (!response.ok) { await response.body?.cancel(); return { reachable: true, latencyMs: Date.now() - started }; }
    const body = await response.json() as { data?: Array<{ id?: unknown }> };
    return { reachable: true, modelFound: Array.isArray(body.data) ? body.data.some(model => model?.id === config.model) : undefined,
      latencyMs: Date.now() - started };
  } catch { return { reachable: false, latencyMs: Date.now() - started }; }
}
