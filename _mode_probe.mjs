/**
 * End-to-end probe of the AUT/MAN selector against the REAL brooder.
 *
 *   node _mode_probe.mjs [deviceId]
 *
 * Sends exactly what the dashboard now sends — `relay ON` / `relay OFF` inside
 * MAN, `relay AUTO` for AUT — and watches the unit's own telemetry to see
 * whether the firmware applied each one. The probe RESTORES the unit to the
 * state it found, so it is safe to run on a system that is in use.
 *
 *   MAN ON   manual_control=true  relay_state=true
 *   MAN OFF  manual_control=true  relay_state=false
 *   AUT      manual_control=false (relay_state follows the thermostat)
 */
import process from 'node:process';

const API = 'https://broodiinnox-api.onrender.com';
const ID = process.argv[2] || 'BROODIINNOX-001';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readState() {
  const r = await fetch(`${API}/api/devices/${encodeURIComponent(ID)}`);
  const j = await r.json();
  return j.device || j;
}

function show(label, d) {
  console.log(`${label.padEnd(24)} manual=${String(d.manual_control).padEnd(5)} relay=${String(d.relay_state).padEnd(5)} ave=${d.ave_temp} band=${d.min_temp}-${d.max_temp} locked=${d.device_locked}`);
  return d;
}

async function command(value) {
  const r = await fetch(`${API}/api/devices/${encodeURIComponent(ID)}/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: 'relay', value }),
  });
  const j = await r.json();
  console.log(`[cmd] relay ${value.padEnd(4)} -> HTTP ${r.status} ${JSON.stringify(j).slice(0, 140)}`);
  return r.ok;
}

/** Poll until the unit reports the wanted (manual, relay) pair. */
async function waitFor(label, wantManual, wantRelay, seconds = 20) {
  const deadline = Date.now() + seconds * 1000;
  let last = null;
  while (Date.now() < deadline) {
    await sleep(3000);
    const d = await readState();
    last = { manual: d.manual_control, relay: d.relay_state };
    console.log(`      ... ${label}: manual_control=${last.manual} relay_state=${last.relay}`);
    const relayOk = wantRelay === null ? true : last.relay === wantRelay;
    if (last.manual === wantManual && relayOk) return { ok: true, ...last };
  }
  return { ok: false, ...(last || {}) };
}

const before = show('[probe] before', await readState());
const results = [];

try {
  console.log('\n[probe] 1. MAN ON (what the selector sends when MAN takes a running heater over)');
  await command('ON');
  results.push(['MAN ON', await waitFor('MAN ON', true, true)]);

  console.log('\n[probe] 2. MAN OFF (what the switch sends when it is turned off inside MAN)');
  await command('OFF');
  results.push(['MAN OFF', await waitFor('MAN OFF', true, false)]);

  console.log('\n[probe] 3. AUT (what the selector sends going back to automatic)');
  await command('AUTO');
  results.push(['AUT', await waitFor('AUT', false, null)]);
} finally {
  console.log('\n[probe] restoring the state the unit was found in');
  const restore = before.manual_control ? (before.relay_state ? 'ON' : 'OFF') : 'AUTO';
  await command(restore);
  const back = await waitFor(`restore (${restore})`, !!before.manual_control, before.manual_control ? before.relay_state : null);
  console.log(`[probe] restored: ${back.ok ? 'YES' : 'NO'}`);
}

const after = show('\n[probe] after', await readState());
console.log('');
for (const [name, res] of results) {
  console.log(`[probe] ${name.padEnd(8)} applied by the firmware: ${res.ok ? 'YES' : 'NO'}`);
}
const allOk = results.every(([, r]) => r.ok);
console.log(`[probe] verdict: the unit answers MAN ON / MAN OFF / AUT: ${allOk ? 'YES' : 'NO'}`);
console.log(`[probe] state unchanged by the test: ${before.manual_control === after.manual_control && before.relay_state === after.relay_state ? 'YES' : 'NO'}`);
if (!allOk) process.exitCode = 1;
