/**
 * Functional smoke test: boots the PRODUCTION build (next start) the way a
 * user meets it and asserts on real HTTP output.
 *
 *   node scripts/smoke-api.mjs
 *
 * Deterministic by design: with no DATABASE_URL it runs on the in-memory
 * store, and no command that requires a live MQTT broker is ever asserted
 * (broker-dependent outcomes are reported, not required).
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';

const ROOT = join(import.meta.dirname, '..');
const PORT = 3101;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(process.execPath, [
  join('node_modules', 'next', 'dist', 'bin', 'next'),
  'start', '-p', String(PORT), '-H', '127.0.0.1',
], { cwd: ROOT, stdio: 'ignore' });

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
  if (!['cockroach', 'memory'].includes(body.storage.mode)) throw new Error(`unexpected storage mode ${body.storage.mode}`);
  return `mode=${body.storage.mode} mqtt_connected=${body.mqtt.connected}`;
});

await check('POST /api/devices registers a unit (201)', async () => {
  const { status, body } = await j('/api/devices', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_id: 'BROODIINNOX-002', name: 'Main Farm', farmer_id: 'f1', location: 'Kigali' }),
  });
  if (status !== 201) throw new Error(`status ${status}`);
  if (body.device.device_id !== 'BROODIINNOX-002') throw new Error('wrong device in response');
  if (body.device.name !== 'Main Farm') throw new Error('name not stored');
});

await check('GET /api/devices lists the registered unit', async () => {
  const { status, body } = await j('/api/devices');
  if (status !== 200) throw new Error(`status ${status}`);
  if (body.count !== 1 || body.devices[0].device_id !== 'BROODIINNOX-002') throw new Error(`unexpected list ${JSON.stringify(body)}`);
});

await check('GET /api/devices/:id returns the unit', async () => {
  const { status, body } = await j('/api/devices/BROODIINNOX-002');
  if (status !== 200) throw new Error(`status ${status}`);
  if (body.device.name !== 'Main Farm') throw new Error('registry fields missing');
  if (typeof body.device.online !== 'boolean') throw new Error('liveness flag missing');
});

await check('GET /api/devices/:id/readings returns empty history (no messages yet)', async () => {
  const { status, body } = await j('/api/devices/BROODIINNOX-002/readings');
  if (status !== 200 || body.count !== 0) throw new Error(`status ${status} count ${body && body.count}`);
});

await check('POST invalid command is rejected 400 with the firmware rule', async () => {
  const { status, body } = await j('/api/devices/BROODIINNOX-002/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: 'relay', value: 'SOMETIMES' }),
  });
  if (status !== 400) throw new Error(`status ${status} — expected firmware validation to reject`);
  if (!body.error) throw new Error('no error message returned');
});

await check('POST max_temp violating current bounds is rejected 400', async () => {
  // fresh device: no min/max known yet -> rule = integer <= 50
  const { status } = await j('/api/devices/BROODIINNOX-002/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: 'max_temp', value: '75' }),
  });
  if (status !== 400) throw new Error(`status ${status}`);
});

await check('POST device_active=ACTIVE passes validation (accepted or 503 if broker down)', async () => {
  const { status, body } = await j('/api/devices/BROODIINNOX-002/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: 'device_active', value: 'ACTIVE' }),
  });
  if (status !== 200 && status !== 503) throw new Error(`unexpected status ${status}`);
  if (status === 200 && !body.accepted) throw new Error('accepted flag missing');
});

await check('unknown device id 404s', async () => {
  const { status } = await j('/api/devices/NOPE/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: 'relay', value: 'ON' }),
  });
  if (status !== 404) throw new Error(`status ${status}`);
});

await check('audit log records the attempts, newest first', async () => {
  const { status, body } = await j('/api/devices/BROODIINNOX-002/audit');
  if (status !== 200) throw new Error(`status ${status}`);
  if (body.audit.length < 3) throw new Error(`expected >= 3 audited attempts, got ${body.audit.length}`);
  if (body.audit[0].command !== 'device_active') throw new Error('newest audit entry should be the last command sent');
  const kinds = new Set(body.audit.map((a) => a.command));
  if (!kinds.has('relay') || !kinds.has('max_temp') || !kinds.has('device_active')) throw new Error(`missing commands ${[...kinds]}`);
  // every refusal must have been audited with its reason
  const refused = body.audit.find((a) => a.command === 'relay');
  if (!refused.error || refused.published !== false) throw new Error('refused command not audited with error');
});

await check('GET /api/alerts is empty before any device message', async () => {
  const { status, body } = await j('/api/alerts');
  if (status !== 200 || body.count !== 0) throw new Error(`status ${status} count ${body && body.count}`);
});

child.kill();
console.log(failed ? `\nAPI SMOKE FAILED (${failed})` : '\nAPI SMOKE OK');
process.exitCode = failed === 0 ? 0 : 1;
