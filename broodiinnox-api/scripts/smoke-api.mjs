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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import WebSocket from 'ws';

const ROOT = join(import.meta.dirname, '..');
const PORT = 3101;
const BASE = `http://127.0.0.1:${PORT}`;
const DEV = 'BRD-SMOKE-001';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// inject the Cockroach URL from the repo root .env (COCKROACHURL / DATABASE_URL)
const envText = readFileSync(join(ROOT, '..', '.env'), 'utf8');
const pick = (key) => {
  const line = envText.split(/\r?\n/).find((l) => l.trim().startsWith(`${key}=`));
  return line ? line.slice(line.indexOf('=') + 1).trim() : undefined;
};
const DB_URL = pick('DATABASE_URL') || pick('COCKROACHURL');

const child = spawn(process.execPath, [join('scripts', 'server.js')], {
  cwd: ROOT,
  env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: DB_URL || '', PORT: String(PORT) },
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

// remove only the synthetic unit's own rows from the real cluster
if (DB_URL) {
  try {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: DB_URL, max: 1, ssl: { rejectUnauthorized: false } });
    for (const table of ['commands_log', 'readings', 'alerts', 'device_state', 'devices']) {
      await pool.query(`DELETE FROM ${table} WHERE device_id = $1`, [DEV]);
    }
    await pool.end();
  } catch (err) {
    console.error(`[warn] smoke cleanup failed: ${err.message}`);
  }
}

child.kill();
console.log(failed ? `\nAPI SMOKE FAILED (${failed})` : '\nAPI SMOKE OK');
process.exitCode = failed === 0 ? 0 : 1;
