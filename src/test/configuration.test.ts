import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import * as vscode from 'vscode';
import { loadEditorConfig } from '../vscode/configuration';

suite('Workspace endpoint configuration', () => {
  test('reads project .env outside the extension installation and retains process precedence', async function () {
    if (process.env.DEVPULSE_SECURITY_FIXTURE !== '1') { this.skip(); return; }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri; assert.ok(root);
    const file = vscode.Uri.joinPath(root, '.env').fsPath;
    const original = await readFile(file, 'utf8').catch(() => undefined);
    const previous = process.env.DEVPULSE_LLM_BASE_URL;
    try {
      delete process.env.DEVPULSE_LLM_BASE_URL;
      await writeFile(file, 'DEVPULSE_LLM_BASE_URL=https://ai.example.com/v1\n');
      assert.equal((await loadEditorConfig({ scriptDirectory: __dirname }, root)).baseUrl, 'https://ai.example.com/v1');
      await writeFile(file, 'DEVPULSE_LLM_BASE_URL=http://192.0.2.10:11434/v1\n');
      assert.equal((await loadEditorConfig({ scriptDirectory: __dirname }, root)).baseUrl, 'http://192.0.2.10:11434/v1');
      process.env.DEVPULSE_LLM_BASE_URL = 'http://localhost:1234/v1';
      assert.equal((await loadEditorConfig({ scriptDirectory: __dirname }, root)).baseUrl, 'http://localhost:1234/v1');
    } finally {
      if (original === undefined) { await unlink(file); } else { await writeFile(file, original); }
      if (previous === undefined) { delete process.env.DEVPULSE_LLM_BASE_URL; } else { process.env.DEVPULSE_LLM_BASE_URL = previous; }
    }
  });
});
