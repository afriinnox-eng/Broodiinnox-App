/**
 * One-command verification: parses every source file (node --check) and runs
 * the node:test invariant suites. Works before dependencies are installed
 * (the protocol/store-under-test modules have zero external imports).
 *
 *   npm test   (== node scripts/verify.mjs)
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === '.git') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(root);
let failed = 0;

console.log('--- syntax check (node --check) ---');
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed += 1;
    console.error(`[FAIL] ${f}\n${r.stderr}`);
  }
}
console.log(failed === 0 ? `all ${files.length} source files parse OK` : `${files.length} files checked, ${failed} failed`);

console.log('\n--- invariant tests (node --test) ---');
const t = spawnSync(process.execPath, ['--test'], { encoding: 'utf8', cwd: root });
process.stdout.write(t.stdout);
if (t.stderr) process.stderr.write(t.stderr);
if (t.status !== 0) failed += 1;

console.log(failed === 0 ? '\nVERIFY OK' : `\nVERIFY FAILED (${failed} problems)`);
process.exitCode = failed === 0 ? 0 : 1;
