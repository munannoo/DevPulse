import { redact } from '../security/redact';

export class StreamError extends Error {}

export async function* streamEvents(response: Response): AsyncGenerator<string> {
  if (!response.body) { throw new StreamError('Gemma returned an empty chat stream.'); }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) { throw new StreamError('Gemma chat ended before completion. Retry the message.'); }
      bytes += part.value.byteLength;
      if (bytes > 1_000_000) { throw new StreamError('Gemma chat exceeded the response limit.'); }
      buffer += decoder.decode(part.value, { stream: true });
      let separator: RegExpExecArray | null;
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        const event = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        if (event.length > 65_536) { throw new StreamError('Gemma chat event exceeded the size limit.'); }
        const data = event.split(/\r?\n/).filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).replace(/^ /, '')).join('\n');
        if (data === '[DONE]') { return; }
        if (data) { yield data; }
      }
      if (buffer.length > 65_536) { throw new StreamError('Gemma chat event exceeded the size limit.'); }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Hold incomplete lines so token fragments of credentials never reach panel state. */
export function safeChatText(raw: string, complete = false): string {
  const text = raw.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');
  return redact(complete ? text : text.slice(0, text.lastIndexOf('\n') + 1));
}
