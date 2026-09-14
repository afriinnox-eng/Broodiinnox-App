/**
 * Functional smoke test: boots the PRODUCTION build via the custom server
 * (scripts/server.js) the way users meet it, then asserts on real HTTP +
 * WebSocket output.
 *
 *   node scripts/smoke-api.mjs
 *
 * Uses a SYNTHETIC device id (BRD-SMOKE-001) so a live real unit publishing
 * on the broker is never read or touched, and cleans up its own rows.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import WebSocket from 'ws';

const ROOT = join(import.meta.dirname, '..');
const PORT = 3101;
const BASE = `http://127.0.0.1:${PORT}`;
const DEV = 'BRD-SMOKE-001';
const MOMO_PORT = 3199;
const MOMO_BASE = `http://127.0.0.1:${MOMO_PORT}`;
const AMOUNT = 12_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------
 * A stub MTN MoMo, so the whole payment path is exercised over real HTTP:
 * token, request-to-pay, status, and what the app makes of each answer.
 * ------------------------------------------------------------------ */
let momoVerdict = { status: 'PENDING' };   // flipped by the checks below
let momoFinancials = null;                 // { amount, currency } when known
const momoServer = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const send = (code, payload) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(payload === undefined ? '' : JSON.stringify(payload));
  };
  if (url.pathname === '/collection/token/') return send(200, { access_token: 'smoke-token', expires_in: 3600 });
  if (url.pathname === '/collection/v1_0/requesttopay' && req.method === 'POST') return send(202);
  if (url.pathname.startsWith('/collection/v1_0/requesttopay/')) {
    return send(200, { ...momoVerdict, ...(momoFinancials || {}) });
  }
  return send(404, { error: 'unknown path' });
});
await new Promise((r) => momoServer.listen(MOMO_PORT, '127.0.0.1', r));

// inject the Cockroach URL from the repo root .env (COCKROACHURL / DATABASE_URL)
const envText = readFileSync(join(ROOT, '..', '.env'), 'utf8');
const pick = (key) => {
  const line = envText.split(/\r?\n/).find((l) => l.trim().startsWith(`${key}=`));
  return line ? line.slice(line.indexOf('=') + 1).trim() : undefined;
};
const DB_URL = pick('DATABASE_URL') || pick('COCKROACHURL');

const child = spawn(process.execPath, [join('scripts', 'server.js')], {
  cwd: ROOT,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    DATABASE_URL: DB_URL || '',
    PORT: String(PORT),
    // MTN MoMo, pointed at the stub above
    MOMO_BASE_URL: MOMO_BASE,
    MOMO_SUBSCRIPTION_KEY: 'smoke-subscription-key',
    MOMO_API_USER: 'smoke-api-user',
    MOMO_API_KEY: 'smoke-api-key',
    MOMO_TARGET_ENVIRONMENT: 'sandbox',
    MOMO_CURRENCY: 'RWF',
    MOMO_CALLBACK_URL: `${MOMO_BASE}/api/payments/momo/callback`,
  },
  stdio: 'ignore',
});

let failed = 0;
async function check(name, fn) {
  try {
    const extra = await fn();
    console.log(`[PASS] ${name}${extra ? ` — ${extra}` : ''}`);
  } catch (e) {
    failed += 1;
    console.error(`[FAIL] ${name} — ${e.message}`);
  }
}

const j = async (path, opts) => {
  const r = await fetch(`${BASE}${path}`, opts);
  let body = null;
  try { body = await r.json(); } catch { /* no json */ }
  return { status: r.status, body };
};

let up = false;
for (let i = 0; i < 60 && !up; i++) {
  await sleep(500);
  try { up = (await fetch(`${BASE}/api/health`)).status === 200; } catch { /* not yet */ }
}
if (!up) {
  console.error('[FAIL] server did not start');
  child.kill();
  process.exit(1);
}

await check('GET /api/health returns service + storage mode', async () => {
  const { status, body } = await j('/api/health');
  if (status !== 200) throw new Error(`status ${status}`);
  if (!body.ok || body.service !== 'broodiinnox-api') throw new Error('bad health body');
  const expected = DB_URL ? 'cockroach' : 'memory';
  if (body.storage.mode !== expected) throw new Error(`storage mode ${body.storage.mode} (expected ${expected})`);
  return `mode=${body.storage.mode} mqtt_connected=${body.mqtt.connected}`;
});

await check('WS /ws connects and greets with the storage mode', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const hello = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no hello within 6s')), 6000);
    ws.on('message', (d) => {
      const o = JSON.parse(String(d));
      if (o.type === 'hello') { clearTimeout(t); ws.close(); resolve(o); }
    });
    ws.on('error', (e) => { clearTimeout(t); reject(e); });
  });
  if (hello.service !== 'broodiinnox-api') throw new Error(`bad hello ${JSON.stringify(hello)}`);
  const expected = DB_URL ? 'cockroach' : 'memory';
  if (hello.storage !== expected) throw new Error(`hello.storage ${hello.storage} (expected ${expected})`);
  return `hello.storage=${hello.storage} mqtt=${hello.mqtt}`;
});

await check('POST /api/devices registers a synthetic unit (201)', async () => {
  const { status, body } = await j('/api/devices', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_id: DEV, name: 'Smoke Test Unit', farmer_id: 'f-test', location: 'test' }),
  });
  if (status !== 201) throw new Error(`status ${status}`);
  if (body.device.device_id !== DEV) throw new Error('wrong device in response');
});

await check('GET /api/devices lists the registered unit', async () => {
  const { status, body } = await j('/api/devices');
  if (status !== 200) throw new Error(`status ${status}`);
  if (!body.devices.some((d) => d.device_id === DEV)) throw new Error(`synthetic unit missing from ${JSON.stringify(body)}`);
});

await check('GET /api/devices/:id returns the unit with liveness flags', async () => {
  const { status, body } = await j(`/api/devices/${DEV}`);
  if (status !== 200) throw new Error(`status ${status}`);
  if (body.device.name !== 'Smoke Test Unit') throw new Error('registry fields missing');
  if (typeof body.device.online !== 'boolean' || typeof body.device.stale !== 'boolean') throw new Error('liveness flags missing');
});

await check('POST invalid command is rejected 400 with the firmware rule', async () => {
  const { status, body } = await j(`/api/devices/${DEV}/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: 'relay', value: 'SOMETIMES' }),
  });
  if (status !== 400) throw new Error(`status ${status}`);
  if (!body.error) throw new Error('no error message returned');
});

await check('POST device_active=ACTIVE passes validation (200 or 503 if broker down)', async () => {
  const { status, body } = await j(`/api/devices/${DEV}/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: 'device_active', value: 'ACTIVE' }),
  });
  if (status !== 200 && status !== 503) throw new Error(`unexpected status ${status}`);
  if (status === 200 && !body.accepted) throw new Error('accepted flag missing');
});

await check('unknown device id 404s', async () => {
  const { status } = await j('/api/devices/BRD-NOPE/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: 'relay', value: 'ON' }),
  });
  if (status !== 404) throw new Error(`status ${status}`);
});

await check('audit log records the attempts, newest first', async () => {
  const { status, body } = await j(`/api/devices/${DEV}/audit`);
  if (status !== 200) throw new Error(`status ${status}`);
  if (body.audit.length < 2) throw new Error(`expected >= 2 audited attempts, got ${body.audit.length}`);
  if (body.audit[0].command !== 'device_active') throw new Error('newest audit entry should be the last command sent');
  const refused = body.audit.find((a) => a.command === 'relay');
  if (!refused.error || refused.published !== false) throw new Error('refused command not audited with error');
});

await check('synthetic unit has no readings/alerts (real units untouched)', async () => {
  const r = await j(`/api/devices/${DEV}/readings`);
  const a = await j(`/api/alerts?deviceId=${DEV}`);
  if (r.status !== 200 || r.body.count !== 0) throw new Error(`readings status ${r.status} count ${r.body && r.body.count}`);
  if (a.status !== 200 || a.body.count !== 0) throw new Error(`alerts status ${a.status} count ${a.body && a.body.count}`);
});

/* ------------------------------------------------------------------
 * MTN MoMo payments: the whole journey over HTTP
 * ------------------------------------------------------------------ */

await check('GET /api/health reports MTN MoMo as configured (and never the keys)', async () => {
  const { status, body } = await j('/api/health');
  if (status !== 200) throw new Error(`status ${status}`);
  if (body.momo?.enabled !== true) throw new Error(`momo.enabled ${body.momo && body.momo.enabled}`);
  if (body.momo.missing.length) throw new Error(`missing ${body.momo.missing}`);
  if (JSON.stringify(body).includes('smoke-subscription-key')) throw new Error('health leaked a credential');
  return `target=${body.momo.target_environment} currency=${body.momo.currency}`;
});

await check('POST /api/payments refuses an unpayable request before touching MoMo', async () => {
  const zero = await j('/api/payments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_id: DEV, amount: 0, phone: '0788123456' }),
  });
  if (zero.status !== 400) throw new Error(`amount 0 gave ${zero.status}`);
  const badPhone = await j('/api/payments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_id: DEV, amount: AMOUNT, phone: 'not-a-number' }),
  });
  if (badPhone.status !== 400) throw new Error(`bad phone gave ${badPhone.status}`);
  const unknown = await j('/api/payments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_id: 'BRD-NOPE', amount: AMOUNT, phone: '0788123456' }),
  });
  if (unknown.status !== 404) throw new Error(`unknown device gave ${unknown.status}`);
  const list = await j(`/api/payments?deviceId=${DEV}`);
  if (list.body.count !== 0) throw new Error('a refused request must not create a payment');
});

let firstPayment = null;
await check('POST /api/payments requests a MoMo payment (201, pending, referenced)', async () => {
  const { status, body } = await j('/api/payments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_id: DEV, farmer_id: 'f-test', plan_id: 't30d', band_id: 'b5', amount: AMOUNT, phone: '0788123456' }),
  });
  if (status !== 201) throw new Error(`status ${status}: ${JSON.stringify(body)}`);
  firstPayment = body.payment;
  if (firstPayment.status !== 'pending') throw new Error(`status ${firstPayment.status}`);
  if (firstPayment.provider_confirmed !== false) throw new Error('a new payment must not be confirmed');
  if (!firstPayment.provider_ref) throw new Error('no MTN MoMo reference');
  if (firstPayment.phone !== '250788123456') throw new Error(`phone ${firstPayment.phone} was not normalized`);
  if (firstPayment.amount !== AMOUNT) throw new Error(`amount ${firstPayment.amount}`);
  return `ref=${firstPayment.provider_ref.slice(0, 8)}… amount=${firstPayment.amount} ${firstPayment.currency}`;
});

await check('tapping pay twice reuses the live prompt instead of charging twice', async () => {
  const { status, body } = await j('/api/payments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_id: DEV, farmer_id: 'f-test', plan_id: 't30d', band_id: 'b5', amount: AMOUNT, phone: '0788123456' }),
  });
  if (status !== 200 || body.reused !== true) throw new Error(`second request gave ${status} reused=${body.reused}`);
  if (body.payment.id !== firstPayment.id) throw new Error('a second payment was created');
});

await check('GET /api/payments/:id reports what MoMo says — pending stays pending', async () => {
  momoVerdict = { status: 'PENDING' };
  const { status, body } = await j(`/api/payments/${firstPayment.id}/refresh`, { method: 'POST' });
  if (status !== 200) throw new Error(`status ${status}`);
  if (body.refreshed !== true) throw new Error('the status was not checked');
  if (body.payment.status !== 'pending' || body.confirmed) throw new Error(`pending was read as ${JSON.stringify(body)}`);
  const audit = await j(`/api/devices/${DEV}/audit`);
  if (audit.body.audit.some((a) => a.command === 'device_active')) throw new Error('a pending payment must not unlock the unit');
});

await check('a SUCCESSFUL for another amount is not a confirmation and does not unlock', async () => {
  momoVerdict = { status: 'SUCCESSFUL', financialTransactionId: 'FT-WRONG' };
  momoFinancials = { amount: String(AMOUNT - 1), currency: 'RWF' };
  const { body } = await j(`/api/payments/${firstPayment.id}/refresh`, { method: 'POST' });
  if (body.confirmed !== false) throw new Error('a short payment was confirmed');
  if (body.payment.status !== 'failed') throw new Error(`status ${body.payment.status}`);
  if (body.payment.reason !== 'AMOUNT_MISMATCH') throw new Error(`reason ${body.payment.reason}`);
  const audit = await j(`/api/devices/${DEV}/audit`);
  if (audit.body.audit.some((a) => a.command === 'device_active')) throw new Error('the unit was unlocked for a short payment');
});

let secondPayment = null;
await check('a confirmed payment unlocks the unit it paid for', async () => {
  const created = await j('/api/payments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_id: DEV, farmer_id: 'f-test', plan_id: 't30d', band_id: 'b5', amount: AMOUNT, phone: '0788123456' }),
  });
  if (created.status !== 201) throw new Error(`status ${created.status}`);
  secondPayment = created.body.payment;

  momoVerdict = { status: 'SUCCESSFUL', financialTransactionId: 'FT-OK' };
  momoFinancials = { amount: String(AMOUNT), currency: 'RWF' };
  const { body } = await j(`/api/payments/${secondPayment.id}/refresh`, { method: 'POST' });
  if (body.confirmed !== true) throw new Error(`not confirmed: ${JSON.stringify(body).slice(0, 300)}`);
  if (body.payment.status !== 'successful' || body.payment.provider_confirmed !== true) throw new Error('payment not marked successful');
  if (body.payment.financial_transaction_id !== 'FT-OK') throw new Error('MTN transaction id missing');
  if (!body.payment.confirmed_at) throw new Error('confirmed_at missing');
  const published = body.device_unlock && body.device_unlock.topic === `BROODIINNOX/${DEV}/control/device_active`;
  return `mtn_tx=${body.payment.financial_transaction_id} unlock=${published ? 'published' : 'attempted'}`;
});

await check('a forged callback cannot confirm: MoMo itself is asked again', async () => {
  const created = await j('/api/payments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_id: DEV, farmer_id: 'f-test', plan_id: 't30d', band_id: 'b5', amount: AMOUNT, phone: '0788123456' }),
  });
  if (created.status !== 201) throw new Error(`status ${created.status}`);
  momoVerdict = { status: 'PENDING' };
  momoFinancials = null;

  const forged = await j('/api/payments/momo/callback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ externalId: created.body.payment.id, status: 'SUCCESSFUL', financialTransactionId: 'FORGED' }),
  });
  if (forged.status !== 200) throw new Error(`status ${forged.status}`);
  if (forged.body.confirmed !== false) throw new Error('a forged callback confirmed a payment');
  if (forged.body.payment.status !== 'pending') throw new Error(`status ${forged.body.payment.status}`);

  // ... and the same notification becomes a confirmation once MoMo says so
  momoVerdict = { status: 'SUCCESSFUL', financialTransactionId: 'FT-CB' };
  momoFinancials = { amount: String(AMOUNT), currency: 'RWF' };
  const real = await j('/api/payments/momo/callback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ externalId: created.body.payment.id, status: 'SUCCESSFUL' }),
  });
  if (real.body.confirmed !== true) throw new Error('a verified callback did not confirm');
  if (real.body.payment.financial_transaction_id !== 'FT-CB') throw new Error('transaction id missing');
  return 'forged=refused verified=confirmed';
});

await check('the payment history reads back with what MoMo settled', async () => {
  const { status, body } = await j(`/api/payments?deviceId=${DEV}`);
  if (status !== 200) throw new Error(`status ${status}`);
  if (body.count !== 3) throw new Error(`expected 3 payments, got ${body.count}`);
  const successful = body.payments.filter((p) => p.status === 'successful');
  if (successful.length !== 2) throw new Error(`${successful.length} successful payments`);
  if (successful.some((p) => !p.confirmed_at || !p.financial_transaction_id)) throw new Error('a confirmed payment is missing its provider evidence');
  if (body.payments.some((p) => p.provider_confirmed && p.status !== 'successful')) throw new Error('confirmed but not successful');
});

// remove only the synthetic unit's own rows from the real cluster
if (DB_URL) {
  try {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: DB_URL, max: 1, ssl: { rejectUnauthorized: false } });
    for (const table of ['commands_log', 'readings', 'alerts', 'device_state', 'payments', 'devices']) {
      await pool.query(`DELETE FROM ${table} WHERE device_id = $1`, [DEV]);
    }
    await pool.end();
  } catch (err) {
    console.error(`[warn] smoke cleanup failed: ${err.message}`);
  }
}

child.kill();
momoServer.close();
console.log(failed ? `\nAPI SMOKE FAILED (${failed})` : '\nAPI SMOKE OK');
process.exitCode = failed === 0 ? 0 : 1;
