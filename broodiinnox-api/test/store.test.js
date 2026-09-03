import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../lib/store.js';

const ID = 'BROODIINNOX-002';

function reading(deviceId, tsMs, patch = {}) {
  return {
    device_id: deviceId,
    temp1: 33 + (tsMs % 3) / 10,
    ave_temp: 33,
    relay_state: true,
    manual_control: false,
    day: 5,
    total_days: 30,
    max_temp: 35,
    min_temp: 32,
    failsafe_mode: false,
    sensor_error: false,
    mismatch_error: false,
    device_locked: false,
    signal_quality: 15,
    error: null,
    tsMs,
    ...patch,
  };
}

async function fresh() {
  const s = new MemoryStore();
  await s.init();
  return s;
}

test('register/get round-trip and unknown devices return null', async () => {
  const s = await fresh();
  assert.equal(await s.getDevice(ID), null);

  const reg = await s.registerDevice({ device_id: ID, name: 'Main Farm', farmer_id: 'f1', location: 'Kigali' });
  assert.equal(reg.name, 'Main Farm');
  assert.equal(reg.farmer_id, 'f1');

  const got = await s.getDevice(ID);
  assert.equal(got.device_id, ID);
  assert.equal(got.name, 'Main Farm');

  // re-registering is an upsert, not a duplicate
  await s.registerDevice({ device_id: ID, name: 'Main Farm 2' });
  const again = await s.getDevice(ID);
  assert.equal(again.name, 'Main Farm 2');
});

test('register/state merge is idempotent and never loses fields', async () => {
  const s = await fresh();
  await s.registerDevice({ device_id: ID, name: 'A' });
  // store interface speaks camelCase state; DB/memory reads come back snake_case
  await s.upsertState(ID, { online: true, lastSeenAt: Date.now(), locked: true, temp1: 33.1 });
  await s.upsertState(ID, { online: false, lastSeenAt: Date.now(), day: 7 });
  const d = await s.getDevice(ID);
  assert.equal(d.name, 'A', 'registry survives state writes');
  assert.equal(d.device_locked, true, 'previous state survives partial patch');
  assert.equal(d.temp1, 33.1, 'previous state survives partial patch');
  assert.equal(d.online, false);
  assert.equal(d.day, 7);
});

test('readings are stored newest-first with limit and window filtering', async () => {
  const s = await fresh();
  for (let i = 1; i <= 10; i++) await s.saveReading(reading(ID, i * 1000));

  const all = await s.getReadings(ID, {});
  assert.equal(all.length, 10);
  // newest first: the highest tsMs is row 10
  assert.equal(all[0].day, 5); // day fixed; use ts ordering via device field
  assert.equal(new Date(all[0].ts).getTime(), 10000);
  assert.equal(new Date(all[9].ts).getTime(), 1000);

  const lim = await s.getReadings(ID, { limit: 3 });
  assert.equal(lim.length, 3);
  assert.equal(new Date(lim[0].ts).getTime(), 10000);

  const win = await s.getReadings(ID, { from: '1970-01-01T00:00:06Z', to: '1970-01-01T00:00:08Z' });
  assert.deepEqual(win.map((r) => new Date(r.ts).getTime()), [8000, 7000, 6000]);
});

test('memory readings are capped (ring buffer) and never grow unbounded', async () => {
  const s = await fresh();
  for (let i = 1; i <= 1500; i++) await s.saveReading(reading(ID, i * 10));
  const all = await s.getReadings(ID, { limit: 5000 }); // explicit cap-observing limit
  assert.equal(all.length, 1000, 'capped at MEMORY_READINGS_CAP');
  assert.equal(new Date(all[0].ts).getTime(), 15000, 'keeps the NEWEST rows');
  assert.equal(new Date(all[999].ts).getTime(), 5010, 'drops the oldest rows');
});

test('readings are isolated per device', async () => {
  const s = await fresh();
  await s.saveReading(reading('A', 1));
  await s.saveReading(reading('B', 2));
  assert.equal((await s.getReadings('A', {})).length, 1);
  assert.equal((await s.getReadings('B', {})).length, 1);
});

test('audit log records published and refused commands, newest first', async () => {
  const s = await fresh();
  await s.logCommand({ device_id: ID, command: 'relay', value: 'ON', topic: 't1', payload: 'ON', published: true, error: null });
  await s.logCommand({ device_id: ID, command: 'relay', value: 'MAYBE', topic: '', payload: '', published: false, error: 'not a mode' });
  await s.logCommand({ device_id: 'OTHER', command: 'relay', value: 'OFF', topic: 't2', payload: 'OFF', published: true, error: null });

  const only = await s.listAudit(ID);
  assert.equal(only.length, 2);
  assert.equal(only[0].command, 'relay');
  assert.equal(only[0].value, 'MAYBE', 'newest first');
  assert.equal(only[1].published, true);

  const all = await s.listAudit();
  assert.equal(all.length, 3);
});

test('alerts are logged with severity/kind and filterable by device', async () => {
  const s = await fresh();
  await s.logAlert({ device_id: ID, severity: 'critical', kind: 'device.locked', message: 'x' });
  await s.logAlert({ device_id: 'OTHER', severity: 'warning', kind: 'device.offline', message: 'y' });

  const mine = await s.listAlerts(ID);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].kind, 'device.locked');
  assert.equal(mine[0].severity, 'critical');

  const all = await s.listAlerts();
  assert.equal(all.length, 2);
});

test('listDevices is deterministic and empty-safe', async () => {
  const s = await fresh();
  assert.deepEqual(await s.listDevices(), []);
  await s.registerDevice({ device_id: 'B' });
  await s.registerDevice({ device_id: 'A' });
  const ids = (await s.listDevices()).map((d) => d.device_id);
  assert.deepEqual(ids, ['A', 'B']);
});
