import test from 'node:test';
import assert from 'node:assert/strict';
import { buildControlMessage } from '../lib/commands.js';
import { CONTROL_TOPICS, DEFAULT_TOPIC_PREFIX, ANIMAL_PRESETS, SENSOR_IDS } from '../lib/constants.js';

const ID = 'BROODIINNOX-002';
const noCtx = { locked: false, minTemp: null, maxTemp: null };

function msg(command, value, ctx = noCtx) {
  return buildControlMessage(ID, command, value, ctx);
}

/* ------------------------------------------------------------------ */
/* Exhaustive command surface: every control topic the firmware has    */
/* ------------------------------------------------------------------ */
test('every firmware control command has a builder that produces a topic+payload', () => {
  const vectors = [
    ['relay', 'ON'], ['max_temp', '36'], ['min_temp', '32'], ['total_days', '30'],
    ['sensor', 'DS1:ON'], ['factory_reset', 'RESET'], ['animal_preset', 'Chicken'],
    ['device_active', 'ACTIVE'], ['set_time', 'now'],
  ];
  for (const [cmd, value] of vectors) {
    const out = msg(cmd, value);
    assert.equal(out.ok, true, `${cmd} should be accepted`);
    assert.equal(out.command, cmd);
    assert.equal(out.topic, `${DEFAULT_TOPIC_PREFIX}/${ID}/control/${CONTROL_TOPICS[cmd]}`);
    assert.equal(typeof out.payload, 'string');
    assert.ok(out.payload.length > 0 && out.payload.length <= 128, `${cmd} payload sane`);
  }
});

test('unknown commands and malformed device ids are rejected', () => {
  assert.equal(msg('format_c', 1).ok, false);
  assert.equal(msg('', 1).ok, false);
  assert.equal(msg('relay', 'ON', { ...noCtx, locked: false }).ok, true);
  for (const bad of ['', ' ', 'a'.repeat(40), 'has space', 'BROODIINNOX/X']) {
    assert.equal(buildControlMessage(bad, 'relay', 'ON').ok, false, `device id ${JSON.stringify(bad)} rejected`);
  }
});

/* ------------------------------------------------------------------ */
/* relay: exactly ON|OFF|AUTO, case-insensitive in, canonical out      */
/* ------------------------------------------------------------------ */
test('relay accepts only ON/OFF/AUTO and canonicalizes case', () => {
  for (const v of ['ON', 'on', 'On']) assert.equal(msg('relay', v).payload, 'ON');
  assert.equal(msg('relay', 'OFF').payload, 'OFF');
  assert.equal(msg('relay', 'auto').payload, 'AUTO');
  for (const bad of ['ONN', '1', '', 'AUTO ', null, 0, 'MANUAL']) {
    assert.equal(msg('relay', bad).ok, false, `relay ${JSON.stringify(bad)} rejected`);
  }
});

/* ------------------------------------------------------------------ */
/* max_temp / min_temp: firmware integer bounds, cross-field ordering  */
/* ------------------------------------------------------------------ */
test('max_temp: integer > current min_temp and <= 50', () => {
  const ctx = { ...noCtx, minTemp: 32 };
  assert.equal(msg('max_temp', 33, ctx).ok, true);
  assert.equal(msg('max_temp', 50, ctx).ok, true);
  assert.equal(msg('max_temp', 32, ctx).ok, false, 'must stay > min_temp');
  assert.equal(msg('max_temp', 51, ctx).ok, false, 'firmware cap 50');
  for (const bad of ['32.5', 'abc', '', null]) assert.equal(msg('max_temp', bad, ctx).ok, false);
});

test('min_temp: integer >= 10 and < current max_temp', () => {
  const ctx = { ...noCtx, maxTemp: 36 };
  assert.equal(msg('min_temp', 35, ctx).ok, true);
  assert.equal(msg('min_temp', 10, ctx).ok, true);
  assert.equal(msg('min_temp', 36, ctx).ok, false, 'must stay < max_temp');
  assert.equal(msg('min_temp', 9, ctx).ok, false, 'firmware floor 10');
  for (const bad of ['10.5', 'x', null]) assert.equal(msg('min_temp', bad, ctx).ok, false);
});

test('min/max ordering is symmetric: server and firmware agree both ways', () => {
  // firmware: max must be > min AND min must be < max — same rule
  const a = msg('max_temp', 30, { ...noCtx, minTemp: 31 });
  const b = msg('min_temp', 37, { ...noCtx, maxTemp: 36 });
  assert.equal(a.ok, false);
  assert.equal(b.ok, false);
});

/* ------------------------------------------------------------------ */
/* total_days: 1..365                                                  */
/* ------------------------------------------------------------------ */
test('total_days boundaries 1 and 365', () => {
  assert.equal(msg('total_days', 1).ok, true);
  assert.equal(msg('total_days', 365).ok, true);
  assert.equal(msg('total_days', 0).ok, false);
  assert.equal(msg('total_days', 366).ok, false);
  assert.equal(msg('total_days', '30.5').ok, false);
  assert.equal(msg('total_days', 30).payload, '30');
});

/* ------------------------------------------------------------------ */
/* sensor enable: DS1..DS4 × ON|OFF                                    */
/* ------------------------------------------------------------------ */
test('sensor selector accepts every DSx:ON/OFF combination, rejects the rest', () => {
  for (const s of SENSOR_IDS) {
    for (const mode of ['ON', 'OFF']) {
      const out = msg('sensor', `${s}:${mode}`);
      assert.equal(out.ok, true, `${s}:${mode}`);
      assert.equal(out.payload, `${s}:${mode}`);
    }
  }
  assert.equal(msg('sensor', 'ds3:on').payload, 'DS3:ON', 'lowercase canonicalized');
  for (const bad of ['DS5:ON', 'DS1:MAYBE', 'DS1', '1:ON', '', 'DS1 :ON']) {
    assert.equal(msg('sensor', bad).ok, false, `sensor ${JSON.stringify(bad)} rejected`);
  }
});

/* ------------------------------------------------------------------ */
/* factory_reset / animal_preset                                       */
/* ------------------------------------------------------------------ */
test('factory_reset only accepts RESET', () => {
  assert.equal(msg('factory_reset', 'RESET').ok, true);
  assert.equal(msg('factory_reset', 'reset').ok, true);
  for (const bad of ['YES', 'REBOOT', '', 'RESET NOW']) assert.equal(msg('factory_reset', bad).ok, false);
});

test('animal_preset accepts exactly the firmware preset names', () => {
  assert.deepEqual(ANIMAL_PRESETS, ['Chicken', 'Pig', 'Turkey', 'Duck']);
  for (const name of ANIMAL_PRESETS) {
    assert.equal(msg('animal_preset', name).payload, name);
  }
  assert.equal(msg('animal_preset', 'chicken').payload, 'Chicken', 'case-insensitive in, canonical out');
  for (const bad of ['Goat', 'Cow', ''] ) assert.equal(msg('animal_preset', bad).ok, false);
});

/* ------------------------------------------------------------------ */
/* device_active: the lock kill-switch is NEVER blocked by the lock    */
/* ------------------------------------------------------------------ */
test('device_active accepts LOCKED/ACTIVE and works while locked', () => {
  assert.equal(msg('device_active', 'LOCKED').payload, 'LOCKED');
  assert.equal(msg('device_active', 'ACTIVE').payload, 'ACTIVE');
  assert.equal(msg('device_active', 'locked').payload, 'LOCKED');
  assert.equal(msg('device_active', 'PAUSED').ok, false);
  const lockedCtx = { ...noCtx, locked: true };
  assert.equal(msg('device_active', 'ACTIVE', lockedCtx).ok, true, 'unlock allowed while locked');
});

/* ------------------------------------------------------------------ */
/* LOCK SEMANTICS: every lockable command is refused while locked —    */
/* exactly the set the firmware guards in mqtt_callback()              */
/* ------------------------------------------------------------------ */
test('while locked, every firmware-guarded command is refused; nothing else is', () => {
  const ctx = { ...noCtx, locked: true };
  const samples = {
    relay: 'ON', max_temp: '36', min_temp: '32', total_days: '30',
    sensor: 'DS1:ON', factory_reset: 'RESET', animal_preset: 'Chicken', set_time: 'now',
  };
  for (const [cmd, value] of Object.entries(samples)) {
    const out = msg(cmd, value, ctx);
    assert.equal(out.ok, false, `${cmd} must be refused while locked`);
    assert.match(out.error, /LOCKED/i);
  }
  assert.equal(msg('device_active', 'ACTIVE', ctx).ok, true);
  assert.equal(msg('device_active', 'LOCKED', ctx).ok, true);
});

/* ------------------------------------------------------------------ */
/* set_time: epoch | text, plausibility & calendar truth               */
/* ------------------------------------------------------------------ */
test('set_time accepts unix epochs that map to 2000-2100', () => {
  const ok = msg('set_time', '1754400600'); // 2025-08-05
  assert.equal(ok.ok, true);
  assert.equal(ok.payload, '1754400600');
  assert.equal(msg('set_time', 'now').ok, true);
  assert.equal(msg('set_time', '1').ok, false, '1970 out of range');
  assert.equal(msg('set_time', '9999999999999999').ok, false, 'far-future epoch out of range');
});

test('set_time accepts text dates and normalizes to firmware format', () => {
  const a = msg('set_time', '2026-08-05 14:30:00');
  assert.equal(a.ok, true);
  assert.equal(a.payload, '2026-08-05 14:30:00');
  const b = msg('set_time', '2026-08-05T14:30');
  assert.equal(b.ok, true);
  assert.equal(b.payload, '2026-08-05 14:30:00');
});

test('set_time rejects calendar lies: 2026-02-30 must fail', () => {
  for (const bad of ['2026-02-30 10:00:00', '2026-13-01 10:00:00', '2026-00-10 10:00:00', '2026-08-05 25:00:00', 'not-a-date']) {
    assert.equal(msg('set_time', bad).ok, false, `${bad} rejected`);
  }
});

/* ------------------------------------------------------------------ */
/* Determinism: same input, same output (pure function)                */
/* ------------------------------------------------------------------ */
test('command building is deterministic and idempotent', () => {
  for (const [cmd, value, ctx] of [
    ['max_temp', '37', { ...noCtx, minTemp: 32 }],
    ['sensor', 'DS2:OFF', noCtx],
    ['set_time', '2026-08-05 14:30:00', noCtx],
  ]) {
    const first = msg(cmd, value, ctx);
    const second = msg(cmd, value, ctx);
    assert.deepEqual(first, second);
    assert.deepEqual(msg(cmd, value, ctx), msg(cmd, value, ctx));
  }
});

/* ------------------------------------------------------------------ */
/* Custom topic prefix respected                                       */
/* ------------------------------------------------------------------ */
test('custom topic prefix flows into the control topic', () => {
  const out = buildControlMessage(ID, 'relay', 'ON', { ...noCtx, prefix: 'AFR' });
  assert.equal(out.topic, `AFR/${ID}/control/relay`);
});
