import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as vscode from 'vscode';
import { Connection } from '../vscode/features/connection';

suite('AI connection diagnostics', () => {
  test('checks fresh availability, missing models, failure and cancellation without leaking credentials', async function () {
    if (process.env.DEVPULSE_SECURITY_FIXTURE !== '1') { this.skip(); return; }
    const keys = ['DEVPULSE_LLM_BASE_URL', 'DEVPULSE_LLM_MODEL', 'DEVPULSE_LLM_API_KEY'] as const;
    const previous = keys.map(key => process.env[key]); let mode = 'ready', requests = 0;
    const server = createServer((request, response) => {
      requests++; assert.equal(request.headers.authorization, 'Bearer fixture');
      if (mode === 'hold') { return; }
      response.writeHead(mode === 'failed' ? 503 : 200);
      response.end(JSON.stringify({ data: [{ id: 'fixture-model' }] }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const output = vscode.window.createOutputChannel('Connection fixture');
    const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'devpulse')!;
    const connection = new Connection({ extensionPath: extension.extensionPath, secrets: { get: async () => undefined } } as unknown as vscode.ExtensionContext, output);
    try {
      process.env.DEVPULSE_LLM_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
      process.env.DEVPULSE_LLM_MODEL = 'fixture-model'; process.env.DEVPULSE_LLM_API_KEY = 'fixture';
      await connection.check(); assert.equal(connection.getState().reviewFound, true); assert.ok(connection.getState().latencyMs! >= 0);
      await connection.check(); assert.equal(requests, 2, 'diagnostic bypasses cached catalog');
      process.env.DEVPULSE_LLM_MODEL = 'missing'; await connection.check(); assert.equal(connection.getState().reviewFound, false);
      mode = 'failed'; await connection.check(); assert.equal(connection.getState().phase, 'failed');
      assert.ok(!JSON.stringify(connection.getState()).includes('127.0.0.1'));
      mode = 'hold'; const pending = connection.check();
      const deadline = Date.now() + 3000;
      while (requests < 5 && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 20)); }
      assert.equal(requests, 5); connection.cancel(); await pending; assert.equal(connection.getState().phase, 'idle');
      connection.dispose(); await connection.check(); assert.equal(requests, 5);
    } finally {
      connection.dispose(); output.dispose(); keys.forEach((key, index) => { if (previous[index] === undefined) { delete process.env[key]; } else { process.env[key] = previous[index]; } });
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
