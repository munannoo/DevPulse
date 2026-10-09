import type { LlmConfig } from './config';
import { requestQueue } from './queue';
import { safeChatText, streamEvents, StreamError } from './sse';
import { redact } from '../security/redact';

export type ChatTurn = { role: 'user' | 'assistant'; content: string };
export type StreamRequest = { system: string; user: string; history?: ChatTurn[];
  signal?: AbortSignal; timeoutMs?: number; maxTokens?: number; onText: (text: string) => void };

export async function streamChat(config: LlmConfig, request: StreamRequest): Promise<string> {
  const controller = new AbortController(), cancel = () => controller.abort();
  request.signal?.addEventListener('abort', cancel, { once: true });
  if (request.signal?.aborted) { controller.abort(); }
  const timer = setTimeout(cancel, request.timeoutMs ?? 30_000);
  try {
    return await requestQueue.run(async () => {
      const messages = [{ role: 'system', content: redact(request.system) },
        ...(request.history ?? []).slice(-6).map(turn => ({ role: turn.role, content: redact(turn.content).slice(0, 4000) })),
        { role: 'user', content: redact(request.user) }];
      if (JSON.stringify(messages).length > 80_000) { throw new StreamError('Chat context is too large. Use a smaller selection.'); }
      let thinking = true;
      const send = () => fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
        body: JSON.stringify({ model: config.model, messages, stream: true, temperature: 0.2, max_tokens: request.maxTokens ?? 768,
          ...(thinking ? { reasoning_effort: 'none', chat_template_kwargs: { enable_thinking: false } } : {}) }),
      });
      let response = await send();
      if ([400, 422].includes(response.status)) { await response.body?.cancel(); thinking = false; response = await send(); }
      if (!response.ok) {
        await response.body?.cancel();
        throw new StreamError(response.status === 404 ? 'Gemma chat route or model was not found. Check configuration.'
          : [401, 403].includes(response.status) ? 'Gemma denied access. Check the API key.'
          : `Gemma chat request failed (HTTP ${response.status}).`, false, [401, 403, 404].includes(response.status));
      }
      let raw = '', published = '';
      for await (const data of streamEvents(response)) {
        let event: { choices?: Array<{ delta?: { content?: unknown }; finish_reason?: unknown }> };
        try { event = JSON.parse(data); } catch { throw new StreamError('Gemma returned an invalid chat event.'); }
        if (!event || !Array.isArray(event.choices)) { throw new StreamError('Gemma returned an invalid chat event.'); }
        if (event.choices[0]?.finish_reason === 'length') { throw new StreamError('Gemma chat reply was cut off. Ask for a shorter answer.'); }
        const content = event.choices[0]?.delta?.content;
        if (content === undefined || content === null) { continue; }
        if (typeof content !== 'string') { throw new StreamError('Gemma returned an invalid chat event.'); }
        raw += content;
        if (raw.length > 16_000) { throw new StreamError('Chat reply exceeded the text limit. Ask a shorter question.'); }
        const safe = safeChatText(raw);
        if (safe !== published) { published = safe; request.onText(safe); }
      }
      const result = safeChatText(raw, true);
      if (!result.trim()) { throw new StreamError('Gemma returned no chat text. Retry the message.'); }
      request.onText(result); return result;
    }, controller.signal);
  } catch (error) {
    if (request.signal?.aborted) { throw new StreamError('Chat cancelled.'); }
    if (controller.signal.aborted) { throw new StreamError('Gemma chat timed out. Try a smaller selection.', true); }
    if (error instanceof StreamError) { throw error; }
    throw new StreamError('Gemma is offline or unreachable. Git and Focus remain available.', true);
  } finally { clearTimeout(timer); request.signal?.removeEventListener('abort', cancel); }
}
