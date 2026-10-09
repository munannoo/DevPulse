import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { cleanEnvironment, validateProject, waitForReady } from './launch-extension.mjs';

test('launcher removes inherited Electron/debugger routing without mutating its caller', () => {
  const original = { NODE_OPTIONS: 'injected', ELECTRON_RUN_AS_NODE: '1', VSCODE_INSPECTOR_OPTIONS: 'injected', VSCODE_IPC_HOOK_CLI: 'old-window', PATH: 'keep', DEVPULSE_LLM_MODEL: 'keep' };
  assert.deepEqual(cleanEnvironment(original), { PATH: 'keep', DEVPULSE_LLM_MODEL: 'keep' });
  assert.equal(original.ELECTRON_RUN_AS_NODE, '1');
});

test('launcher rejects wrong folders and missing bundles, then waits for the correct loaded host', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'devpulse-launch-'));
  try {
    await assert.rejects(validateProject(directory), /project folder/);
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'devpulse', main: 'extension.js' }));
    await assert.rejects(validateProject(directory), /bundle is missing/);
    await writeFile(path.join(directory, 'extension.js'), '');
    await validateProject(directory);
    const marker = path.join(directory, 'ready.json');
    const running = { exitCode: null, signalCode: null };
    await writeFile(marker, JSON.stringify({ extensionPath: 'other-project', panelVisible: true }));
    await assert.rejects(waitForReady(marker, directory, running, 20), /did not become ready/);
    await writeFile(marker, JSON.stringify({ extensionPath: directory, panelVisible: true }));
    await waitForReady(marker, directory, running, 100);
    await rm(marker);
    await assert.rejects(waitForReady(marker, directory, { exitCode: 1, signalCode: null }, 100), /exited before/);
  } finally {
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('devpulse-launch-'));
    await rm(directory, { recursive: true, force: true });
  }
});
