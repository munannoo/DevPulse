import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import './check-node.cjs';

const project = fileURLToPath(new URL('../', import.meta.url));
// F5 bundles immediately; release/verification builds run both independent checks.
async function run(script, args) {
  try { await access(path.join(project, script)); }
  catch { console.error('Build tools are missing. Install a supported Node version, run npm install in the extension folder, then retry F5.'); process.exit(1); }
  const code = await new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(project, script), ...args], {
      cwd: project, stdio: 'inherit', windowsHide: true, env: process.env,
    });
    child.once('error', () => resolve(1));
    child.once('exit', code => resolve(code ?? 1));
  });
  return code;
}
if (process.argv.includes('--verify')) {
  const codes = await Promise.all([
    run('node_modules/typescript/bin/tsc', ['--noEmit']),
    run('node_modules/eslint/bin/eslint.js', ['src']),
  ]);
  if (codes.some(code => code !== 0)) { process.exit(1); }
}
process.exitCode = await run('esbuild.mjs', process.argv.includes('--production') ? ['--production'] : []);
