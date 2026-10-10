import { execFile } from 'node:child_process';
import { isAbsolute, basename } from 'node:path';

/** The extension host executable is Electron; hooks must run with standalone Node. */
export async function nodeRuntime(): Promise<string> {
  if (/^node(?:\.exe)?$/i.test(basename(process.execPath))) { return process.execPath; }
  const env = { ...process.env };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'VSCODE_INSPECTOR_OPTIONS', 'VSCODE_IPC_HOOK_CLI']) { delete env[key]; }
  return new Promise((resolve, reject) => {
    execFile('node', ['-p', 'JSON.stringify({path:process.execPath,version:process.versions.node})'],
      { env, timeout: 5000, maxBuffer: 4096, windowsHide: true }, (error, stdout) => {
        try {
          if (error) { throw error; }
          const value = JSON.parse(stdout) as { path?: unknown; version?: unknown };
          const version = typeof value.version === 'string' ? value.version.split('.').map(Number) : [];
          if (typeof value.path !== 'string' || !isAbsolute(value.path) || !/^node(?:\.exe)?$/i.test(basename(value.path))
            || version.length !== 3 || !(version[0] >= 24 || version[0] === 22 && version[1] >= 13 || version[0] === 20 && version[1] >= 19)) { throw new Error(); }
          resolve(value.path);
        } catch { reject(new Error('Install a supported Node version on PATH, then reinstall the DevPulse hook.')); }
      });
  });
}
