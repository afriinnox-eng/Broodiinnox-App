/**
 * The momo-check CLI's contract — the part a caller (or a cron job, or a
 * deploy script) actually depends on.
 *
 *   INVARIANT   an unconfigured environment exits 2 — not 0, and not 1 — and
 *               names every variable that is missing, because exit 0 is the
 *               only answer a caller may read as "farmers can pay".
 *   INVARIANT   a value that is only whitespace is missing, not configured.
 *   INVARIANT   a credential value is never echoed, in either output mode, and
 *               --json says exactly what the human-readable run says.
 *
 * Spawned rather than imported: the script is a CLI that reads the environment
 * and calls process.exit. Every case is forced THROUGH the environment — an
 * explicit empty value in process.env overrides anything in
 * broodiinnox-api/.env — so no file on disk and no network can change the
 * answer, and none of these cases reaches MTN.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/momo-check.mjs', import.meta.url));
const REQUIRED = ['MOMO_SUBSCRIPTION_KEY', 'MOMO_API_USER', 'MOMO_API_KEY'];

/** Run the CLI with every credential forced blank, then whatever the case sets. */
function runMomoCheck(env = {}, args = []) {
  const blank = Object.fromEntries(REQUIRED.map((k) => [k, '']));
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...blank, ...env },
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

test('momo-check: nothing configured exits 2, names every missing variable', () => {
  const { status, stdout } = runMomoCheck();

  assert.equal(status, 2, 'exit 2 is "not configured" — 0 would be read as paying');
  assert.match(stdout, /NOT CONFIGURED/);
  for (const k of REQUIRED) assert.match(stdout, new RegExp(k), `the output must name ${k}`);
  assert.match(stdout, /broodiinnox-api\/\.env|Render/, 'it must say where to set them');
});

test('momo-check: a value that is only whitespace is missing, not configured', () => {
  const { status, stdout } = runMomoCheck({
    MOMO_SUBSCRIPTION_KEY: '   ', MOMO_API_USER: '\t', MOMO_API_KEY: ' ',
  });

  assert.equal(status, 2);
  for (const k of REQUIRED) assert.match(stdout, new RegExp(`${k} MISSING`));
});

test('momo-check: a credential value is never echoed, in either output mode', () => {
  const sentinel = 'sentinel-must-never-be-printed-1234567890';

  const plain = runMomoCheck({ MOMO_SUBSCRIPTION_KEY: sentinel });
  assert.equal(plain.status, 2);
  assert.ok(!plain.stdout.includes(sentinel), 'stdout must not carry the value');
  assert.ok(!plain.stderr.includes(sentinel), 'stderr must not carry the value');
  assert.match(plain.stdout, new RegExp(`MOMO_SUBSCRIPTION_KEY set \\(${sentinel.length} chars\\)`), 'it may say it is set, and how long');

  const asJson = runMomoCheck({ MOMO_SUBSCRIPTION_KEY: sentinel }, ['--json']);
  assert.equal(asJson.status, 2, 'the exit code must not depend on the output mode');
  assert.ok(!asJson.stdout.includes(sentinel), 'the JSON must not carry the value either');

  const parsed = JSON.parse(asJson.stdout);
  assert.equal(parsed.verdict.ok, false);
  assert.equal(parsed.verdict.step, 'config');
  assert.deepEqual(parsed.config.missing, ['MOMO_API_USER', 'MOMO_API_KEY']);
  assert.equal(parsed.credentials.MOMO_SUBSCRIPTION_KEY, `set (${sentinel.length} chars)`);
});
