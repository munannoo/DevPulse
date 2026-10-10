import { createRequire } from 'node:module';
import path from 'node:path';
import { cleanEnvironment } from './launch-extension.mjs';

// Use the production configuration resolver; keep credentials in child memory.
export async function presentationEnvironment(project, environment = process.env) {
  const { loadConfig } = createRequire(import.meta.url)(path.join(project, 'dist', 'config.js'));
  const config = await loadConfig({ scriptDirectory: project, env: environment });
  const env = cleanEnvironment(environment);
  env.DEVPULSE_LLM_BASE_URL = config.baseUrl;
  env.DEVPULSE_LLM_MODEL = config.model;
  if (config.apiKey) { env.DEVPULSE_LLM_API_KEY = config.apiKey; }
  return env;
}
