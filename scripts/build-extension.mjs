import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const project = fileURLToPath(new URL('../', import.meta.url));
// F5 runs this with VS Code's bundled Node, bypassing an outdated node on PATH.
for (const [script, args] of [
  ['node_modules/typescript/bin/tsc', ['--noEmit']],
  ['node_modules/eslint/bin/eslint.js', ['src']],
  ['esbuild.mjs', []],
]) {
  try { await access(path.join(project, script)); }
  catch { console.error('Build tools are missing. Install a supported Node version, run npm install in the extension folder, then retry F5.'); process.exit(1); }
  const code = await new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(project, script), ...args], {
      cwd: project, stdio: 'inherit', windowsHide: true, env: process.env,
    });
    child.once('error', () => resolve(1));
    child.once('exit', code => resolve(code ?? 1));
  });
  if (code !== 0) { process.exit(code); }
}
