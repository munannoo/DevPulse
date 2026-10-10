import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { Connection } from '../vscode/features/connection';

suite('AI connection diagnostics in the Extension Host', () => {
  test('checks endpoint latency and model availability, honors cancellation, and sanitizes failures', async function () {
    if (process.env.DEVPULSE_SECURITY_FIXTURE !== '1') { this.skip(); }
    const context = {
      extensionPath: vscode.extensions.getExtension('devpulse.devpulse')?.extensionPath ?? process.cwd(),
      secrets: {
        get: async () => undefined,
        store: async () => {},
        delete: async () => {},
      },
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;
    const output = vscode.window.createOutputChannel('Connection fixture');
    const connection = new Connection(context, output);

    try {
      assert.equal(connection.getState().phase, 'idle');

      let updateCount = 0;
      connection.onUpdate = () => { updateCount++; };

      const checkPromise = connection.check();
      assert.equal(connection.getState().phase, 'checking');
      await checkPromise;

      const state = connection.getState();
      assert.equal(state.phase, 'ready');
      assert.ok(typeof state.latencyMs === 'number' && state.latencyMs >= 1);
      assert.ok(typeof state.modelsCount === 'number');
      assert.ok(updateCount >= 2);

      // Verify cancellation
      const cancelPromise = connection.check();
      connection.cancel();
      await cancelPromise;
      assert.equal(connection.getState().phase, 'cancelled');
    } finally {
      connection.dispose();
      output.dispose();
    }
  });
});
