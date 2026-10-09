import type { LlmConfig } from './config';
import { requestQueue } from './queue';
import { contentHash, getCached, setCached } from './cache';
import { repairPrompt } from './prompts';
import { redact } from '../security/redact';

export class LlmError extends Error {
  constructor(message: string, public readonly offline = false) { super(message); }
}
type ChatRequest<T> = {
  system: string; user: string; json: (value: unknown) => T;
  signal?: AbortSignal; maxTokens?: number; timeoutMs?: number;
};
export function parseJson(text: string): unknown {
  return JSON.parse(text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
}
async function responseJson(response: Response): Promise<unknown> {
  if (!response.body) { throw new LlmError('Gemma returned an empty response.'); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) { break; }
      size += part.value.byteLength;
      if (size > 1_000_000) { await reader.cancel(); throw new LlmError('Gemma response exceeded the size limit.'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function createLlm(config: LlmConfig) {
  return {
    async chat<T>(request: ChatRequest<T>): Promise<T> {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      request.signal?.addEventListener('abort', cancel, { once: true });
      if (request.signal?.aborted) { controller.abort(); }
      const timer = setTimeout(cancel, request.timeoutMs ?? 30_000);
      try {
        return await requestQueue.run(async () => {
          const system = redact(request.system);
          const user = redact(request.user);
          const key = contentHash(JSON.stringify([config, system, user, request.maxTokens]));
          const cached = getCached(key);
          if (cached) {
            try { return request.json(parseJson(cached)); } catch { /* Revalidate against the caller's schema. */ }
          }
          let jsonMode = config.jsonMode;
          for (let attempt = 0; attempt < 2; attempt++) {
            const send = () => fetch(`${config.baseUrl}/chat/completions`, {
              method: 'POST', signal: controller.signal,
              headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
              body: JSON.stringify({
                model: config.model, temperature: 0.1, stream: false,
                max_tokens: request.maxTokens ?? 1600,
                ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
                messages: [
                  { role: 'system', content: system + (attempt ? `\n${repairPrompt}` : '') },
                  { role: 'user', content: user },
                ],
              }),
            });
            let response = await send();
            if (jsonMode && [400, 422].includes(response.status)) {
              await response.body?.cancel();
              jsonMode = false;
              response = await send();
            }
            if (!response.ok) {
              await response.body?.cancel();
              throw new LlmError(`Gemma request failed (HTTP ${response.status}). Check model and authentication settings.`);
            }
            try {
              const body = await responseJson(response);
              const content = (body as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
              if (typeof content !== 'string') { throw new Error('Missing content.'); }
              const result = request.json(parseJson(content));
              setCached(key, content);
              return result;
            } catch (error) {
              if (error instanceof LlmError) { throw error; }
              if (attempt === 1) { throw new LlmError('Gemma returned invalid review JSON after one retry.'); }
            }
          }
          throw new LlmError('Gemma could not complete the review.');
        }, controller.signal);
      } catch (error) {
        if (request.signal?.aborted) { throw new LlmError('Review cancelled.'); }
        if (controller.signal.aborted) { throw new LlmError('Gemma timed out. Git status remains available.', true); }
        if (error instanceof LlmError) { throw error; }
        throw new LlmError('Gemma is offline or unreachable. Check the endpoint configuration.', true);
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', cancel);
      }
    },
  };
}
