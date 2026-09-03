import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deviceIdFromTopic, ingestMessage, parseDataMessage, parseStatusMessage, toReadingRow,
} from '../lib/ingest.js';

/* A /data payload exactly as safe_publish_sensor_data() in BROODIINNOX_V11.ino
 * would serialize it (keys & value encodings preserved, -999 for NaN). */
const DATA_SAMPLE = JSON.stringify({
  device_id: 'BROODIINNOX-002',
  device_name: 'BROODIINNOX',
  timestamp: 1754400600,
  day: 12,
  total_days: 30,
  max_temp: 35,
  min_temp: 32,
  ave_temp: 33.4,
  relay_state: true,
  manual_control: false,
  failsafe_mode: false,
  sensor_error: false,
  mismatch_error: false,
  signal_quality: 17,
  device_locked: false,
  sensor1: 33.1, sensor2: 33.6, sensor3: 34.2,
  s1_enabled: true, s2_enabled: true, s3_enabled: true, s4_enabled: true,
  weekly_reduce_enabled: true,
  weekly_reduce_deg: 3,
  last_reduction_day: 7,
  error: '1 SENSOR FAIL',
});

test('deviceIdFromTopic extracts the id between prefix and suffix', () => {
  assert.equal(deviceIdFromTopic('BROODIINNOX/BROODIINNOX-002/data'), 'BROODIINNOX-002');
  assert.equal(deviceIdFromTopic('BROODIINNOX/BRD007/status'), 'BRD007');
  assert.equal(deviceIdFromTopic('data'), null);
  assert.equal(deviceIdFromTopic(''), null);
  assert.equal(deviceIdFromTopic(null), null);
});

test('ingestMessage routes /data and /status topics and fills missing ids', () => {
  const d = ingestMessage('BROODIINNOX/BROODIINNOX-002/data', DATA_SAMPLE);
  assert.equal(d.kind, 'data');
  assert.equal(d.deviceId, 'BROODIINNOX-002');

  const s = ingestMessage('BROODIINNOX/BRD009/status', '{"device_id":"BRD009","status":"online"}');
  assert.equal(s.kind, 'status');
  assert.equal(s.deviceId, 'BRD009');

  const off = ingestMessage('BROODIINNOX/BRD009/status', 'offline');
  assert.equal(off.kind, 'offline');
  assert.equal(off.deviceId, 'BRD009');

  assert.equal(ingestMessage('not/a/broodiinnox/topic', '{}'), null);
});

test('data snapshot normalizes every field (numbers, bools, -999, clamps)', () => {
  const d = parseDataMessage(DATA_SAMPLE);
  assert.equal(d.kind, 'data');
  assert.equal(d.device_id, 'BROODIINNOX-002');
  assert.equal(d.relayOn, true);
  assert.equal(d.manual, false);
  assert.equal(d.day, 12);
  assert.equal(d.total_days, 30);
  assert.equal(d.max_temp, 35);
  assert.equal(d.min_temp, 32);
  assert.equal(d.ave_temp, 33.4);
  assert.equal(d.temp1, 33.1);
  assert.equal(d.temp4, null, 'missing sensor is null');
  assert.equal(d.failsafe_mode, false);
  assert.equal(d.signal_quality, 17);
  assert.equal(d.error, '1 SENSOR FAIL');
  assert.equal(d.device_ts, 1754400600);
});

test('firmware -999 average maps back to null (never a temperature)', () => {
  const raw = JSON.parse(DATA_SAMPLE);
  raw.ave_temp = -999;
  const d = parseDataMessage(JSON.stringify(raw));
  assert.equal(d.ave_temp, null);
});

test('out-of-range and junk temperatures become null instead of poisoning data', () => {
  for (const bad of [300, -999, 'abc', null, NaN]) {
    const r = JSON.parse(DATA_SAMPLE);
    r.sensor1 = bad;
    const d = parseDataMessage(JSON.stringify(r));
    assert.equal(d.temp1, null, `${bad} rejected`);
  }
  const hot = JSON.parse(DATA_SAMPLE);
  hot.sensor2 = '36.5';
  assert.equal(parseDataMessage(JSON.stringify(hot)).temp2, 36.5, 'numeric strings accepted');
});

test('clamps: signal 0..31, day >= 0, total_days 1..365', () => {
  const raw = JSON.parse(DATA_SAMPLE);
  raw.signal_quality = 99;
  raw.day = -4;
  raw.total_days = 999;
  const d = parseDataMessage(JSON.stringify(raw));
  assert.equal(d.signal_quality, 31);
  assert.equal(d.day, 0);
  assert.equal(d.total_days, 365);
});

test('status payloads: online heartbeat JSON and the LWT offline string', () => {
  const on = parseStatusMessage(JSON.stringify({
    device_id: 'BROODIINNOX-002',
    status: 'online',
    timestamp: 1754400600,
    device_locked: false,
    signal_quality: 14,
    mqtt_connected: true,
    sensors_ok: true,
    relay_state: 'ON',
    day: 12,
    total_days: 30,
    failsafe_mode: false,
  }));
  assert.equal(on.kind, 'status');
  assert.equal(on.online, true);
  assert.equal(on.locked, false);
  assert.equal(on.relayOn, true, 'status "ON" string decodes to boolean');
  assert.equal(on.signal_quality, 14);

  const off = parseStatusMessage(Buffer.from('offline'));
  assert.equal(off.kind, 'offline');
  assert.equal(parseStatusMessage(' offline ').kind, 'offline', 'trimmed LWT');
  assert.equal(parseStatusMessage('garbage').kind, 'unknown');
});

test('locked status heartbeat is detected from status text and/or flag', () => {
  const a = parseStatusMessage(JSON.stringify({ device_id: 'X', status: 'locked' }));
  assert.equal(a.locked, true);
  // "locked" still means the device PUBLISHED it — it is reachable, only "offline" is off
  assert.equal(a.online, true);
  const b = parseStatusMessage(JSON.stringify({ device_id: 'X', status: 'online', device_locked: true }));
  assert.equal(b.locked, true);
});

test('garbage data payloads are rejected outright', () => {
  assert.equal(parseDataMessage('not json'), null);
  assert.equal(parseDataMessage(''), null);
  assert.equal(parseDataMessage('[]'), null, 'array is not a snapshot');
  assert.equal(parseDataMessage('42'), null);
});

test('toReadingRow produces a consistent column set for every data event', () => {
  const ev = ingestMessage('BROODIINNOX/BROODIINNOX-002/data', DATA_SAMPLE);
  const row = toReadingRow(ev);
  assert.ok(row);
  assert.equal(row.device_id, 'BROODIINNOX-002');
  assert.equal(row.ave_temp, 33.4);
  assert.equal(row.relay_state, true);
  // invariant: the storage row is always complete (no undefined columns)
  const expected = ['device_id', 'device_ts', 'temp1', 'temp2', 'temp3', 'temp4', 'ave_temp',
    'relay_state', 'manual_control', 'day', 'total_days', 'max_temp', 'min_temp',
    'failsafe_mode', 'sensor_error', 'mismatch_error', 'device_locked', 'signal_quality', 'error'];
  assert.deepEqual(Object.keys(row).sort(), expected.sort());
  for (const [k, v] of Object.entries(row)) {
    if (k === 'device_id' || k === 'error') continue; // TEXT columns, may be null
    if (v === null) continue;
    if (['relay_state', 'manual_control', 'failsafe_mode', 'sensor_error', 'mismatch_error', 'device_locked'].includes(k)) {
      assert.equal(typeof v, 'boolean', k);
    } else if (['day', 'total_days', 'max_temp', 'min_temp', 'signal_quality'].includes(k)) {
      assert.equal(Number.isInteger(v), true, k);
    } else {
      assert.equal(typeof v, 'number', k);
    }
  }
});

