/**
 * The ekopay-check CLI's contract — the part a caller (or a cron job, or a
 * deploy script) actually depends on.
 *
 *   INVARIANT   an unconfigured environment exits 2 — not 0, and not 1 — and
 *               names every variable that is still to be set, because exit 0 is
 *               the only answer a caller may read as "farmers can pay".
 *   INVARIANT   a value that is only whitespace is missing, not configured, and
 *               a merchant number that cannot be an MSISDN is unusable rather
 *               than quietly accepted.
 *   INVARIANT   a credential value is never echoed, in either output mode, and
 *               --json says exactly what the human-readable run says.
 *
 * Spawned rather than imported: the script is a CLI that reads the environment
 * and calls process.exit. Every case is forced THROUGH the environment — an
 * explicit empty value in process.env overrides anything in
 * broodiinnox-api/.env — so no file on disk and no network can change the
 * answer, and none of these cases reaches Ekorana.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/ekopay-check.mjs', import.meta.url));
const REQUIRED = ['EKOPAY_API_KEY', 'EKOPAY_TRANSFER_PHONE'];

/** Run the CLI with every credential forced blank, then whatever the case sets. */
function runEkopayCheck(env = {}, args = []) {
  const blank = Object.fromEntries(REQUIRED.map((k) => [k, '']));
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...blank, ...env },
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

test('ekopay-check: nothing configured exits 2, names every variable still to be set', () => {
  const { status, stdout } = runEkopayCheck();

  assert.equal(status, 2, 'exit 2 is "not configured" — 0 would be read as paying');
  assert.match(stdout, /NOT CONFIGURED/);
  for (const k of REQUIRED) assert.match(stdout, new RegExp(k), `the output must name ${k}`);
  assert.match(stdout, /broodiinnox-api\/\.env|Render/, 'it must say where to set them');
});

test('ekopay-check: a value that is only whitespace is missing, not configured', () => {
  const { status, stdout } = runEkopayCheck({ EKOPAY_API_KEY: '   ', EKOPAY_TRANSFER_PHONE: '\t' });

  assert.equal(status, 2);
  for (const k of REQUIRED) assert.match(stdout, new RegExp(`${k} MISSING`));
});

test('ekopay-check: a merchant number that cannot be an MSISDN is unusable, not accepted', () => {
  const { status, stdout } = runEkopayCheck({ EKOPAY_API_KEY: 'a-key', EKOPAY_TRANSFER_PHONE: 'not-a-number' });

  assert.equal(status, 2, 'a config that cannot collect must not read as ready');
  assert.match(stdout, /EKOPAY_TRANSFER_PHONE set but unusable/);
  assert.match(stdout, /fix EKOPAY_TRANSFER_PHONE/);
});

test('ekopay-check: a credential value is never echoed, in either output mode', () => {
  const sentinel = 'sentinel-must-never-be-printed-1234567890';

  const plain = runEkopayCheck({ EKOPAY_API_KEY: sentinel });
  assert.equal(plain.status, 2);
  assert.ok(!plain.stdout.includes(sentinel), 'stdout must not carry the value');
  assert.ok(!plain.stderr.includes(sentinel), 'stderr must not carry the value');
  assert.match(plain.stdout, new RegExp(`EKOPAY_API_KEY set \\(${sentinel.length} chars\\)`), 'it may say it is set, and how long');

  const asJson = runEkopayCheck({ EKOPAY_API_KEY: sentinel }, ['--json']);
  assert.equal(asJson.status, 2, 'the exit code must not depend on the output mode');
  assert.ok(!asJson.stdout.includes(sentinel), 'the JSON must not carry the value either');

  const parsed = JSON.parse(asJson.stdout);
  assert.equal(parsed.verdict.ok, false);
  assert.equal(parsed.verdict.step, 'config');
  assert.deepEqual(parsed.config.missing, ['EKOPAY_TRANSFER_PHONE']);
  assert.equal(parsed.credentials.EKOPAY_API_KEY, `set (${sentinel.length} chars)`);
});

test('ekopay-check: a complete config is reported without printing the merchant number', () => {
  const merchant = '0788765432';
  // Pointed at a port nothing listens on, so the case stays offline and
  // deterministic: the config is complete, so the CLI asks the gateway and
  // reports what it got back. No case in this file reaches Ekorana.
  const { status, stdout } = runEkopayCheck({
    EKOPAY_API_KEY: 'a-key',
    EKOPAY_TRANSFER_PHONE: merchant,
    EKOPAY_BASE_URL: 'http://127.0.0.1:1/api/v1',
    EKOPAY_TIMEOUT_MS: '2000',
  });

  assert.equal(status, 1, 'a complete config reaches the gateway and cannot pass here — nothing is listening');
  assert.ok(!stdout.includes(merchant), 'the merchant number is not echoed');
  assert.match(stdout, /EKOPAY_TRANSFER_PHONE set \(\d+ chars\)/);
  assert.match(stdout, /REJECTED/);
});
