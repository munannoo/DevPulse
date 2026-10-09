import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type LlmConfig = { baseUrl: string; model: string; apiKey?: string; jsonMode: boolean };
export type ConfigOptions = {
  scriptDirectory?: string;
  env?: NodeJS.ProcessEnv;
  settings?: { baseUrl?: string; model?: string; modelOverride?: string; jsonMode?: boolean };
  secretApiKey?: string;
};

export function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) { continue; }
    let value = match[2];
    if (/^["']/.test(value)) {
      const end = value.indexOf(value[0], 1);
      if (end < 0) { continue; }
      value = value.slice(1, end);
    } else { value = value.replace(/\s+#.*$/, '').trim(); }
    values[match[1]] = value;
  }
  return values;
}

export async function loadConfig(options: ConfigOptions = {}): Promise<LlmConfig> {
  let directory = options.scriptDirectory ?? __dirname;
  let dotenv: Record<string, string> = {};
  while (true) {
    try { dotenv = parseEnv(await readFile(join(directory, '.env'), 'utf8')); break; }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw new Error('Could not read the DevPulse .env configuration.');
      }
    }
    const parent = dirname(directory);
    if (parent === directory) { break; }
    directory = parent;
  }
  const env = options.env ?? process.env;
  const first = (...values: Array<string | undefined>) => values.find(value => value?.trim())?.trim();
  const baseUrl = first(env.DEVPULSE_LLM_BASE_URL, dotenv.DEVPULSE_LLM_BASE_URL,
    options.settings?.baseUrl, 'http://localhost:11434/v1')!;
  let parsed: URL;
  try { parsed = new URL(baseUrl); } catch { throw new Error('DevPulse LLM base URL is invalid.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Use an HTTP(S) base URL without credentials, query parameters, or a fragment.');
  }
  // Origin-only server addresses use the standard OpenAI-compatible API prefix.
  if (parsed.pathname === '/') { parsed.pathname = '/v1'; }
  return {
    baseUrl: parsed.toString().replace(/\/+$/, ''),
    // An explicit editor selection overrides the default; CLI callers keep env/.env precedence.
    model: first(options.settings?.modelOverride, env.DEVPULSE_LLM_MODEL, dotenv.DEVPULSE_LLM_MODEL, options.settings?.model, 'gemma4:e4b')!,
    apiKey: first(env.DEVPULSE_LLM_API_KEY, dotenv.DEVPULSE_LLM_API_KEY, options.secretApiKey),
    jsonMode: options.settings?.jsonMode ?? true,
  };
}
