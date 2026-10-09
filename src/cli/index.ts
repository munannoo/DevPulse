import * as path from 'node:path';
import { readFile, writeFile, open } from 'node:fs/promises';
import { repository } from '../core/git/repo';
import { installHook } from '../core/git/hook';
import { verifyStaged } from '../core/security/precommit';
import { planFix, validatePlan, stageFix } from '../core/security/autofix';

async function confirm(): Promise<boolean> {
  // Hooks have no ordinary stdin. Failure to open a terminal means no consent.
  try {
    const tty = await open('/dev/tty', 'r+');
    try {
      await tty.write('Apply this fix? [y/N] ');
      const buffer = Buffer.alloc(64);
      const { bytesRead } = await tty.read(buffer, 0, buffer.length, null);
      return /^y(?:es)?$/i.test(buffer.subarray(0, bytesRead).toString().trim());
    } finally { await tty.close(); }
  } catch { return false; }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || command === '--help' || command === '-h') {
    console.log('DevPulse: init | precommit | fix <finding-id>\nRegex secret verification of staged additions.');
    return;
  }
  const root = await repository(process.cwd());
  if (command === 'init') {
    await installHook(root, path.join(__dirname, 'cli.js'));
    console.log('DevPulse pre-commit guard installed.');
  } else if (command === 'precommit') {
    const result = await verifyStaged(root);
    if (result.findings.length) {
      for (const item of result.findings) {
        console.error(`${item.file}:${item.startLine}: ${item.title}${item.canFix ? ` (fix: ${item.id})` : ' (manual fix required)'}`);
      }
      console.error('Commit blocked. Open DevPulse Security in VS Code to preview a fix.');
      process.exitCode = 1;
    } else { console.log('DevPulse: no secrets found in staged additions.'); }
  } else if (command === 'fix' && process.argv[3]) {
    const plan = await planFix(root, process.argv[3]);
    console.log(plan.preview);
    if (!await confirm()) { console.log('Fix cancelled. Use VS Code to apply the previewed fix.'); return; }
    await validatePlan(root, plan);
    // Keep source comparison immediately before the write; never print its contents.
    if (await readFile(path.join(root, plan.file), 'utf8') !== plan.original) { throw new Error('Source changed. Scan again.'); }
    await writeFile(path.join(root, plan.file), plan.replacement);
    await writeFile(path.join(root, '.env'), plan.env, { mode: 0o600 });
    await writeFile(path.join(root, '.gitignore'), plan.ignore);
    await stageFix(root, plan);
    console.log('Fix applied and re-staged. Configure the value in your local .env, then commit again.');
  } else { throw new Error('Unknown command. Run --help for supported commands.'); }
}

main().catch(() => {
  console.error('DevPulse could not complete verification or the fix. Check Git and file permissions; retry before committing.');
  process.exitCode = 1;
});
