// Creates fresh local repositories; never changes the project's remotes or hooks.
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const execute = promisify(execFile);
const project = fileURLToPath(new URL('../', import.meta.url));
const parent = path.join(project, '.vscode-test', 'demos');
await mkdir(parent, { recursive: true });
const root = await mkdtemp(path.join(parent, 'checkout-'));
const origin = path.join(root, 'origin.git');
const producer = path.join(root, 'producer');
const workspace = path.join(root, 'workspace');
const preview = path.join(root, 'incoming-preview');
const git = (cwd, ...args) => execute('git', args, { cwd, timeout: 15_000 });
const commit = (cwd, message) => git(cwd, '-c', 'user.name=Demo Author', '-c', 'user.email=demo@example.invalid', 'commit', '-m', message);
const shellQuote = value => `'${value.replace(/\\/g, '/').replace(/'/g, `'"'"'`)}'`;

await git(root, 'init', '--bare', '--initial-branch=main', origin);
await git(root, 'clone', origin, producer);
for (const file of ['cart.mjs', 'cart.test.mjs', 'autocomplete.mjs', 'ONBOARDING.md']) {
  await copyFile(path.join(project, 'test-repo', 'demo', file), path.join(producer, file));
}
await writeFile(path.join(producer, '.gitignore'), '.env\n.env.*\n!.env.example\n');
await writeFile(path.join(producer, '.env.example'), 'DEVPULSE_LLM_BASE_URL=http://localhost:11434/v1\nDEVPULSE_LLM_MODEL=gemma4:e4b\n');
// An empty local .env prevents inheriting an unrelated parent workspace's .env.
await writeFile(path.join(producer, '.env'), '');
await mkdir(path.join(producer, '.vscode'));
await writeFile(path.join(producer, '.vscode', 'settings.json'), JSON.stringify({
  'devpulse.assistant.inline.enabled': true,
  'editor.inlineSuggest.enabled': true,
  'devpulse.focus.flowMinutes': 1,
}, null, 2) + '\n');
await git(producer, 'add', '.');
await commit(producer, 'feat: add checkout service');
await git(producer, 'push', '-u', 'origin', 'main');
await git(root, 'clone', origin, workspace);
await git(workspace, 'config', 'user.name', 'Demo Author');
await git(workspace, 'config', 'user.email', 'demo@example.invalid');
await writeFile(path.join(workspace, '.env'), '');
const baseline = await readFile(path.join(producer, 'cart.mjs'), 'utf8');
await writeFile(path.join(producer, 'cart.mjs'), baseline.replace('item.price * item.quantity', 'item.price'));
await git(producer, 'add', 'cart.mjs');
await commit(producer, 'feat: simplify checkout calculation (intentional demo bug)');
await git(producer, 'push', 'origin', 'main');
await git(workspace, 'fetch', 'origin');
await git(root, 'clone', origin, preview);
await writeFile(path.join(preview, '.env'), '');
await git(producer, 'switch', '-c', 'demo/shipping');
await writeFile(path.join(producer, 'shipping.mjs'), [
  '// Proposed integration: deliberately missing HTTP failure handling.',
  'export async function shippingOptions(endpoint) {',
  '  const response = await fetch(endpoint);',
  '  return response.json();',
  '}', '',
].join('\n'));
await git(producer, 'add', 'shipping.mjs');
await commit(producer, 'feat: propose shipping integration');
await git(producer, 'push', 'origin', 'demo/shipping');
await git(workspace, 'fetch', 'origin');
await writeFile(path.join(root, 'shipping-pr.diff'), (await git(producer, 'diff', 'main...demo/shipping')).stdout);

// This is a demo-only deterministic push guard, not DevPulse's staged scanner.
await writeFile(path.join(workspace, '.git', 'hooks', 'pre-push'),
  `#!/bin/sh\n# Demo checkout regression check\n${shellQuote(process.execPath)} cart.test.mjs || exit $?\n`, { mode: 0o755 });
await execute(process.execPath, ['cart.test.mjs'], { cwd: workspace, timeout: 10_000 });
const counts = (await git(workspace, 'rev-list', '--left-right', '--count', 'HEAD...@{u}')).stdout.trim().split(/\s+/);
assert.deepEqual(counts, ['0', '1']);
// Prove the failing version is rejected by an actual push to the local remote.
await git(preview, 'switch', '-c', 'demo/push-check');
await copyFile(path.join(workspace, '.git', 'hooks', 'pre-push'), path.join(preview, '.git', 'hooks', 'pre-push'));
let rejected = false;
try { await git(preview, 'push', 'origin', 'HEAD:refs/heads/demo/push-check'); }
catch (error) { rejected = /Quantity must affect payment/.test(error.stderr ?? ''); }
assert.ok(rejected, 'Faulty checkout must be rejected by the demo push guard');
assert.equal((await git(producer, 'ls-remote', 'origin', 'refs/heads/demo/push-check')).stdout, '');
await git(preview, 'switch', 'main');

if (process.argv.includes('--secret')) {
  // Inert synthetic value generated only into the ignored demo workspace.
  const synthetic = ['sk', 'DEMO_NOT_A_REAL_CREDENTIAL_123456'].join('-');
  await writeFile(path.join(workspace, 'credential.mjs'), ['const ', 'demoToken', ' = ', JSON.stringify(synthetic), ';\n'].join(''));
  await git(workspace, 'add', 'credential.mjs');
}
console.log(`Demo ready: ${root}\nOpen: ${workspace}\nIncoming-code preview: ${preview}\nVerified: one incoming commit, baseline passes, faulty push rejected.\nWalkthrough: test-repo/README.md`);
