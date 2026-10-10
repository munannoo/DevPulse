import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { presentationEnvironment } from './demo-config.mjs';
import { createRequire } from 'node:module';

const project = path.resolve(import.meta.dirname, '..');
const { loadConfig } = createRequire(import.meta.url)(path.join(project, 'dist', 'config.js'));

test('presentation inherits the project dotenv host/model/auth without mutating process inputs', async () => {
  const env = await presentationEnvironment(project, {});
  const expected = await loadConfig({ scriptDirectory: project, env: {} });
  assert.equal(env.DEVPULSE_LLM_BASE_URL === expected.baseUrl, true);
  assert.equal(env.DEVPULSE_LLM_MODEL === expected.model, true);
  assert.equal(env.DEVPULSE_LLM_API_KEY === expected.apiKey, true);
});

test('explicit process configuration wins and debugger injection is removed', async () => {
  const input = { DEVPULSE_LLM_BASE_URL: 'http://192.0.2.50:8000/custom/v1',
    DEVPULSE_LLM_MODEL: 'demo-model', DEVPULSE_LLM_API_KEY: ['inert', 'fixture'].join('-'),
    NODE_OPTIONS: '--inspect', VSCODE_INSPECTOR_OPTIONS: 'fixture', PATH: process.env.PATH };
  const result = await presentationEnvironment(project, input);
  assert.equal(result.DEVPULSE_LLM_BASE_URL, input.DEVPULSE_LLM_BASE_URL);
  assert.equal(result.DEVPULSE_LLM_MODEL, input.DEVPULSE_LLM_MODEL);
  assert.equal(result.DEVPULSE_LLM_API_KEY === input.DEVPULSE_LLM_API_KEY, true);
  assert.equal(result.NODE_OPTIONS, undefined);
  assert.equal(input.NODE_OPTIONS, '--inspect');
  assert.equal(result.PATH, input.PATH);
});

test('the shared loader normalizes origin-only endpoints and respects nearest dotenv', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'devpulse-demo-config-'));
  const child = path.join(parent, 'child');
  try {
    await mkdir(child);
    await writeFile(path.join(parent, '.env'), 'DEVPULSE_LLM_BASE_URL=http://192.0.2.60:8000\nDEVPULSE_LLM_MODEL=parent-model\n');
    const inherited = await loadConfig({ scriptDirectory: child, env: {} });
    assert.equal(inherited.baseUrl, 'http://192.0.2.60:8000/v1');
    await writeFile(path.join(child, '.env'), 'DEVPULSE_LLM_MODEL=nearest-model\n');
    const nearest = await loadConfig({ scriptDirectory: child, env: {} });
    assert.equal(nearest.model, 'nearest-model');
    assert.equal(nearest.baseUrl, 'http://localhost:11434/v1');
  } finally {
    assert.equal(path.dirname(path.resolve(parent)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(parent).startsWith('devpulse-demo-config-'));
    await rm(parent, { recursive: true, force: true });
  }
});
