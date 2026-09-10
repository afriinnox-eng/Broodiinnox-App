/**
 * Invariant tests for src/lib/live.js — the live IoT page data path.
 */
import { describe, expect, it } from 'vitest';
import {
  POWER_MAX_REASSERTS, deviceDisplayName, liveCommandPlan, liveVmStatus, nearestAnimal,
  overlayLiveDevice, powerIsStale, powerMatchesIntent, powerReassertPlan, storeDeviceFromVm,
} from '../lib/live.js';

function vm(patch = {}) {
  return {
    id: 'BROODIINNOX-001',
    name: 'Main Farm Unit',
    online: true,
    stale: false,
    locked: false,
    failsafe: false,
    sensorError: false,
    mismatchError: false,
    aveTemp: 27.6,
    heaterOn: true,
    manual: false,
    day: 3,
    totalDays: 30,
    signalQuality: 25,
    sensors: [{ id: 1, enabled: true, lastReading: 27.6, health: 'ok' }],
    lastSeenAt: new Date().toISOString(),
    ...patch,
  };
}

const now = () => new Date().toISOString();
const MIN = 60000;

describe('liveVmStatus', () => {
  it('is online while lastSeenAt is fresh', () => {
    expect(liveVmStatus(vm(), now())).toBe('online');
  });

  it('is online exactly at the 15-minute boundary, offline past it', () => {
    const at = new Date().getTime();
    const edge = (ageMin) => new Date(at - ageMin * MIN).toISOString();
    expect(liveVmStatus(vm({ lastSeenAt: edge(15) }), new Date(at).toISOString())).toBe('online');
    expect(liveVmStatus(vm({ lastSeenAt: edge(15.01) }), new Date(at).toISOString())).toBe('offline');
  });

  it('goes offline when lastSeenAt is missing or the VM says offline', () => {
    expect(liveVmStatus(vm({ lastSeenAt: null }), now())).toBe('offline');
    expect(liveVmStatus(vm({ lastSeenAt: undefined }), now())).toBe('offline');
    expect(liveVmStatus(vm({ online: false }), now())).toBe('offline');
  });

  it('locked beats online; failsafe beats offline; sensor faults are warnings', () => {
    expect(liveVmStatus(vm({ locked: true, failsafe: true, online: false }), now())).toBe('locked');
    expect(liveVmStatus(vm({ failsafe: true, sensorError: true, online: false }), now())).toBe('critical');
    expect(liveVmStatus(vm({ sensorError: true, online: true }), now())).toBe('warning');
    expect(liveVmStatus(vm({ mismatchError: true, online: true }), now())).toBe('warning');
  });

  it('returns offline for null/empty input', () => {
    expect(liveVmStatus(null, now())).toBe('offline');
    expect(liveVmStatus({}, now())).toBe('offline');
  });
});

/* ------------------- store overlay (global live mode) ------------------ */

const NOW = '2026-09-04T12:00:00.000Z';

function liveVm(patch = {}) {
  return {
    id: 'BROODIINNOX-001',
    name: 'Main Farm Unit',
    online: true,
    locked: false,
    failsafe: false,
    sensorError: false,
    mismatchError: false,
    aveTemp: 27.6,
    heaterOn: true,
    manual: false,
    day: 3,
    totalDays: 30,
    minTemp: 32,
    maxTemp: 36,
    signalQuality: 25,
    sensors: [
      { id: 1, enabled: true, lastReading: 27.6, health: 'ok' },
      { id: 2, enabled: false, lastReading: null, health: 'err' },
    ],
    lastSeenAt: '2026-09-04T11:59:00.000Z',
    ...patch,
  };
}

function seedDevice(patch = {}) {
  return {
    id: 'BROODIINNOX-001',
    serial: 'BROODIINNOX-001',
    name: 'BROODIINNOX-001',
    farmerId: 'f1',
    location: { district: 'Kigali', sector: 'Nyarugenge', lat: 0, lng: 0 },
    sensors: [{ id: 1, enabled: true, lastReading: 24, health: 'ok' }],
    subscription: { planId: 'p1', status: 'active', startDate: NOW, endDate: '2027-01-01T00:00:00.000Z' },
    ...patch,
  };
}

describe('storeDeviceFromVm', () => {
  it('maps a live VM onto the full store device shape', () => {
    const d = storeDeviceFromVm(liveVm(), NOW);
    expect(d).not.toBeNull();
    expect(d.id).toBe('BROODIINNOX-001');
    expect(d.live).toBe(true);
    expect(d.serial).toBe('BROODIINNOX-001');
    expect(d.baseMin).toBe(32);
    expect(d.baseMax).toBe(36);
    expect(d.heaterOn).toBe(true);
    expect(d.manual).toBe(false);
    expect(d.lastSeen).toBe('2026-09-04T11:59:00.000Z');
    expect(d.sensors).toEqual([
      { id: 1, enabled: true, lastReading: 27.6, health: 'ok' },
      { id: 2, enabled: false, lastReading: null, health: 'err' },
    ]);
  });

  it('derives the batch start date from the reported day (day 3 -> 2 days ago)', () => {
    const d = storeDeviceFromVm(liveVm(), NOW);
    expect(d.batch.durationDays).toBe(30);
    expect(d.batch.status).toBe('running');
    expect(d.batch.startDate).toBe('2026-09-02T12:00:00.000Z');
  });

  it('uses an active placeholder subscription and carries the real lock', () => {
    const d = storeDeviceFromVm(liveVm(), NOW);
    expect(d.subscription.status).toBe('active');
    expect(d.manualLock).toBe(false);
    const locked = storeDeviceFromVm(liveVm({ locked: true }), NOW);
    expect(locked.manualLock).toBe(true);
  });

  it('returns null for a missing id and tolerates absent sensors', () => {
    expect(storeDeviceFromVm(null, NOW)).toBeNull();
    expect(storeDeviceFromVm({ id: 'X' }, NOW)).not.toBeNull();
    expect(storeDeviceFromVm({ id: 'X' }, NOW).sensors).toEqual([]);
  });

  it('never picks a target band outside the firmware bounds', () => {
    const d = storeDeviceFromVm(liveVm({ minTemp: 10, maxTemp: 50 }), NOW);
    expect(d.baseMin).toBe(10);
    expect(d.baseMax).toBe(50);
  });

  it('reads the master ON/OFF switch out of the reported relay state', () => {
    expect(storeDeviceFromVm(liveVm(), NOW).systemOn).toBe(true);            // relay follows the thermostat
    expect(storeDeviceFromVm(liveVm({ manual: true, heaterOn: true }), NOW).systemOn).toBe(true);   // forced heating
    expect(storeDeviceFromVm(liveVm({ manual: true, heaterOn: false }), NOW).systemOn).toBe(false); // switched OFF
  });
});

describe('overlayLiveDevice', () => {
  it('overwrites telemetry with the real values on a matching id', () => {
    const out = overlayLiveDevice(seedDevice(), liveVm(), NOW);
    expect(out.aveTemp).toBeUndefined(); // aveTemp is derived by services
    expect(out.sensors[0].lastReading).toBe(27.6);
    expect(out.heaterOn).toBe(true);
    expect(out.baseMin).toBe(32);
    expect(out.lastSeen).toBe('2026-09-04T11:59:00.000Z');
    expect(out.live).toBe(true);
  });

  it('keeps local meta (farmer, custom name, paid plan, location)', () => {
    const out = overlayLiveDevice(seedDevice({ name: 'My Coop' }), liveVm(), NOW);
    expect(out.name).toBe('My Coop');
    expect(out.farmerId).toBe('f1');
    expect(out.location.district).toBe('Kigali');
    expect(out.subscription.planId).toBe('p1');
  });

  it('uses the API name when the local name is just the serial', () => {
    const out = overlayLiveDevice(seedDevice(), liveVm(), NOW);
    expect(out.name).toBe('Main Farm Unit');
  });

  it('carries the real lock state and returns the device untouched on id mismatch', () => {
    const out = overlayLiveDevice(seedDevice(), liveVm({ locked: true }), NOW);
    expect(out.manualLock).toBe(true);
    const original = seedDevice();
    const other = overlayLiveDevice(original, liveVm({ id: 'BROODIINNOX-999' }), NOW);
    expect(other).toBe(original); // untouched (same reference) on id mismatch
  });

  it('overlay is idempotent on static fields', () => {
    const vm = liveVm();
    const a = overlayLiveDevice(seedDevice(), vm, NOW);
    const b = overlayLiveDevice(a, vm, NOW);
    expect(b.name).toBe(a.name);
    expect(b.farmerId).toBe(a.farmerId);
    expect(b.subscription.planId).toBe(a.subscription.planId);
    expect(b.sensors).toEqual(a.sensors);
  });

  it('keeps a switch command the operator just made, and infers it otherwise', () => {
    // The user switched this unit OFF a moment ago: the app keeps showing that
    // command — and says whether the unit has confirmed it — but nothing is
    // frozen, so the switch can never disagree with the hardware for long.
    const commanded = overlayLiveDevice(
      seedDevice({ systemOn: false, powerIntent: 'off', powerIntentAt: NOW }),
      liveVm(),
      NOW
    );
    expect(commanded.systemOn).toBe(false);
    expect(commanded.powerSetByUser).toBe(true);
    expect(commanded.powerConfirmed).toBe(false); // the unit has not applied it yet
    expect(commanded.powerPending).toBe(true);

    // Nobody commanded anything: the device's own relay state is the truth.
    expect(overlayLiveDevice(seedDevice(), liveVm({ manual: true, heaterOn: false }), NOW).systemOn).toBe(false);
    expect(overlayLiveDevice(seedDevice(), liveVm(), NOW).systemOn).toBe(true);
  });
});

describe('deviceDisplayName', () => {
  const vm = () => ({ id: 'BROODIINNOX-001', name: 'API Name' });
  it('a custom app name (different from serial) wins over the API name', () => {
    expect(deviceDisplayName({ id: 'BROODIINNOX-001', serial: 'BROODIINNOX-001', name: 'Coop A' }, vm())).toBe('Coop A');
  });
  it('a serial-only app name falls back to the API registration name', () => {
    expect(deviceDisplayName({ id: 'BROODIINNOX-001', serial: 'BROODIINNOX-001', name: 'BROODIINNOX-001' }, vm())).toBe('API Name');
  });
  it('without a store device the API name is used; ids are the last resort', () => {
    expect(deviceDisplayName(null, vm())).toBe('API Name');
    expect(deviceDisplayName({ id: 'X', serial: 'X', name: 'X' }, { id: 'X', name: '' })).toBe('X');
    expect(deviceDisplayName(null, null)).toBe('');
  });
});

describe('nearestAnimal', () => {
  it('classifies every preset band to itself', () => {
    expect(nearestAnimal(35, 37)).toBe('chicken');
    expect(nearestAnimal(33, 35)).toBe('duck');
    expect(nearestAnimal(34, 36)).toBe('turkey');
    expect(nearestAnimal(30, 32)).toBe('pig');
  });
  it('tolerates missing targets', () => {
    expect(typeof nearestAnimal(null, null)).toBe('string');
  });
});

describe('liveCommandPlan', () => {
  const live = (patch = {}) => ({ id: 'BROODIINNOX-001', live: true, baseMin: 32, baseMax: 36, ...patch });
  const mock = { id: 'brood-1', live: false, baseMin: 35, baseMax: 37 };

  it('sends nothing for non-live devices or unknown actions', () => {
    expect(liveCommandPlan({ type: 'SET_TARGETS', deviceId: 'brood-1', min: 31, max: 35 }, mock)).toEqual([]);
    expect(liveCommandPlan({ type: 'WATCH_TV' }, live())).toEqual([]);
    expect(liveCommandPlan(null, live())).toEqual([]);
  });

  it('emits max_temp before min_temp, only for changed values in firmware bounds', () => {
    const plan = liveCommandPlan({ type: 'SET_TARGETS', deviceId: 'BROODIINNOX-001', min: 31, max: 35 }, live());
    expect(plan).toEqual([
      { command: 'max_temp', value: '35' },
      { command: 'min_temp', value: '31' },
    ]);
    expect(liveCommandPlan({ type: 'SET_TARGETS', min: 32, max: 36 }, live())).toEqual([]);
    expect(liveCommandPlan({ type: 'SET_TARGETS', min: 5, max: 60 }, live())).toEqual([]);
  });

  it('maps sensor enable/disable onto DS1..DS4 and rejects other ids', () => {
    expect(liveCommandPlan({ type: 'SET_SENSOR', deviceId: 'BROODIINNOX-001', sensorId: 2, enabled: false }, live()))
      .toEqual([{ command: 'sensor', value: 'DS2:OFF' }]);
    expect(liveCommandPlan({ type: 'SET_SENSOR', sensorId: 9, enabled: true }, live())).toEqual([]);
  });

  it('maps lock/unlock onto device_active', () => {
    expect(liveCommandPlan({ type: 'LOCK_DEVICE', deviceId: 'BROODIINNOX-001', lock: true }, live()))
      .toEqual([{ command: 'device_active', value: 'LOCKED' }]);
    expect(liveCommandPlan({ type: 'LOCK_DEVICE', deviceId: 'BROODIINNOX-001', lock: false }, live()))
      .toEqual([{ command: 'device_active', value: 'ACTIVE' }]);
  });

  it('SYNC_TIME sends set_time now; RESTART sends the real reboot command', () => {
    expect(liveCommandPlan({ type: 'SYNC_TIME', deviceId: 'BROODIINNOX-001' }, live()))
      .toEqual([{ command: 'set_time', value: 'now' }]);
    expect(liveCommandPlan({ type: 'RESTART_DEVICE', deviceId: 'BROODIINNOX-001' }, live()))
      .toEqual([{ command: 'restart', value: 'RESTART' }]);
  });

  it('maps the master switch onto the firmware relay topic, and nothing for mock devices', () => {
    expect(liveCommandPlan({ type: 'SET_SYSTEM_POWER', deviceId: 'BROODIINNOX-001', on: false }, live()))
      .toEqual([{ command: 'relay', value: 'OFF' }]);
    expect(liveCommandPlan({ type: 'SET_SYSTEM_POWER', deviceId: 'BROODIINNOX-001', on: true }, live()))
      .toEqual([{ command: 'relay', value: 'AUTO' }]);
    expect(liveCommandPlan({ type: 'SET_SYSTEM_POWER', deviceId: 'brood-1', on: false }, mock)).toEqual([]);
  });
});

describe('system power: the unit decides whether the command landed', () => {
  const liveDevice = (patch = {}) => ({
    id: 'BROODIINNOX-001',
    live: true,
    name: 'Main Farm Unit',
    baseMin: 24,
    baseMax: 31,
    sensors: [],
    lastSeen: now(),
    subscription: { planId: 'p1', status: 'active', endDate: '2027-01-01T00:00:00.000Z' },
    manualLock: false,
    ...patch,
  });
  const T0 = Date.parse('2026-09-10T12:00:00.000Z');
  const at = (ms) => new Date(T0 + ms).toISOString();
  const dropped = vm({ manual: false, heaterOn: true }); // unit back in AUTO, heating
  const applied = vm({ manual: true, heaterOn: false }); // unit reports manual off

  it('confirms OFF only on manual control with the heater off, and ON on automatic', () => {
    expect(powerMatchesIntent('off', applied)).toBe(true);
    expect(powerMatchesIntent('off', vm({ manual: false, heaterOn: false }))).toBe(false);
    expect(powerMatchesIntent('off', vm({ manual: true, heaterOn: true }))).toBe(false);
    expect(powerMatchesIntent('on', vm({ manual: false, heaterOn: true }))).toBe(true);
    expect(powerMatchesIntent('on', applied)).toBe(false);
    expect(powerMatchesIntent(null, dropped)).toBe(true); // nothing was commanded
  });

  it('shows the command while it stands, and reads the unit back once it lands', () => {
    const dev = liveDevice({ powerIntent: 'off', powerIntentAt: at(0) });
    const landed = overlayLiveDevice(dev, applied, at(3000));
    expect(landed.systemOn).toBe(false);
    expect(landed.powerConfirmed).toBe(true);
    expect(landed.powerPending).toBe(false);
    expect(landed.powerUnconfirmed).toBe(false);

    // Same id, no command: the unit's own report decides.
    expect(overlayLiveDevice(liveDevice(), dropped, at(0)).systemOn).toBe(true);
  });

  it('never freezes a command: unconfirmed inside the window, drift after it', () => {
    const dev = liveDevice({ powerIntent: 'off', powerIntentAt: at(0) });
    const within = overlayLiveDevice(dev, dropped, at(5000));
    expect(within.systemOn).toBe(false); // the farmer's OFF is still shown
    expect(within.powerPending).toBe(true);
    expect(within.powerUnconfirmed).toBe(false);

    const after = overlayLiveDevice(dev, dropped, at(25000));
    expect(after.powerPending).toBe(false);
    expect(after.powerUnconfirmed).toBe(true);
    expect(powerIsStale(dev, at(25000))).toBe(true);
    expect(powerIsStale(dev, at(5000))).toBe(false);
    expect(powerIsStale(liveDevice(), at(0))).toBe(false); // nothing commanded
  });

  it('re-sends a dropped OFF, throttled to one attempt per interval and capped', () => {
    const dev = liveDevice({ powerIntent: 'off', powerIntentAt: at(0) });
    expect(powerReassertPlan(dev, dropped, at(25000))).toBeNull(); // inside the grace window
    expect(powerReassertPlan(dev, dropped, at(35000))).toEqual({ command: 'relay', value: 'OFF' });
    expect(powerReassertPlan(dev, applied, at(35000))).toBeNull(); // unit already agrees

    const sent = liveDevice({ powerIntent: 'off', powerIntentAt: at(0), powerRetries: 1, powerRetryAt: at(35000) });
    expect(powerReassertPlan(sent, dropped, at(45000))).toBeNull(); // too soon after the last attempt
    expect(powerReassertPlan(sent, dropped, at(70000))).toEqual({ command: 'relay', value: 'OFF' });

    const exhausted = liveDevice({
      powerIntent: 'off', powerIntentAt: at(0), powerRetries: POWER_MAX_REASSERTS, powerRetryAt: at(0),
    });
    expect(powerReassertPlan(exhausted, dropped, at(600000))).toBeNull();
  });

  it('re-sends ON as AUTO, and never talks to a locked, silent or mock device', () => {
    const on = liveDevice({ powerIntent: 'on', powerIntentAt: at(0) });
    expect(powerReassertPlan(on, applied, at(35000))).toEqual({ command: 'relay', value: 'AUTO' });

    const locked = liveDevice({ powerIntent: 'off', powerIntentAt: at(0), manualLock: true });
    expect(powerReassertPlan(locked, dropped, at(35000))).toBeNull();

    const silent = liveDevice({ powerIntent: 'off', powerIntentAt: at(0), lastSeen: at(-600000) });
    expect(powerReassertPlan(silent, dropped, at(35000))).toBeNull();

    const mockDevice = liveDevice({ live: false, powerIntent: 'off', powerIntentAt: at(0) });
    expect(powerReassertPlan(mockDevice, dropped, at(35000))).toBeNull();

    expect(powerReassertPlan(liveDevice({ powerIntentAt: at(0) }), dropped, at(35000))).toBeNull();
  });
});
