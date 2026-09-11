/**
 * Invariants of the system switch and the live link (commit bbe7152).
 *
 * These are property tests, not examples: each one is driven over the WHOLE
 * fleet the app builds (all eight seeded demo systems plus the live unit) and
 * over the pathological values a real API row can carry, and asserts a
 * property that must hold for every one of them.
 *
 *   INVARIANT 1  a device id from the API always yields a farmer id that is
 *                either null or a non-empty trimmed string — never '' / junk.
 *   INVARIANT 2  flipping a system that has no unit behind it NEVER publishes a
 *                command and NEVER writes a hardware-sounding audit line.
 *   INVARIANT 3  flipping the unit that exists publishes exactly one relay
 *                command per flip, and off/on is a round trip (state restored).
 *   INVARIANT 4  the live link's health flag always matches the last poll
 *                outcome, and the warnings are shown iff it is unhealthy — with
 *                the last good overlay kept across failures.
 */
import React from 'react';
import { HashRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const KEY = 'broodiinnox_app_v1';
const LIVE_ID = 'BROODIINNOX-001';
const FARMER = { id: 'f1', name: 'Jean Damascene', role: 'farmer', phone: '0788123456' };

/** Verbatim shape of GET /api/devices on the live API. */
const LIVE_ROW = {
  device_id: LIVE_ID, name: 'Damas', farmer_id: 'f1', location: 'Kigali',
  online: true, last_seen_at: '2026-09-04T11:59:00.000Z',
  relay_state: true, manual_control: false, day: '3', total_days: '30',
  max_temp: '31', min_temp: '30', ave_temp: 28.5,
  temp1: 28.5, temp2: null, temp3: null, temp4: null,
  s1_enabled: true, s2_enabled: false, s3_enabled: false, s4_enabled: false,
  failsafe_mode: false, sensor_error: false, mismatch_error: false,
  device_locked: false, signal_quality: '26', error: null, stale: false,
};

let calls = [];
let pollFails = false;
let probe = { state: null, dispatch: null };
let StoreProvider;
let buildSeed;
let apiDeviceToVm;
let storeDeviceFromVm;
let PowerSwitch;

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) };
}

/** Every control command the app published, in order. */
const commands = () => calls.filter((c) => c.method === 'POST' && c.path.includes('/commands')).map((c) => c.body);

/** Fired from the App shell and from the store: refresh the live link. */
async function poll() {
  await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
}

beforeEach(async () => {
  localStorage.clear();
  calls = [];
  pollFails = false;
  probe = { state: null, dispatch: null };
  vi.unstubAllEnvs();
  vi.stubEnv('VITE_IOT_API_URL', 'https://iot.local');
  vi.stubEnv('VITE_IOT_TIMEOUT_MS', '2000');
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    calls.push({ method, path: u, body: opts.body ? JSON.parse(opts.body) : null });
    if (method === 'GET' && u.endsWith('/api/devices')) {
      if (pollFails) throw new Error('Failed to fetch');
      return jsonResponse({ count: 1, devices: [LIVE_ROW] });
    }
    if (method === 'POST' && u.includes('/commands')) return jsonResponse({ accepted: true });
    return jsonResponse({ ok: true });
  }));
  const store = await import('../lib/store.jsx');
  const seed = await import('../lib/seed.js');
  const iot = await import('../lib/iot.js');
  const live = await import('../lib/live.js');
  StoreProvider = store.StoreProvider;
  buildSeed = seed.buildSeed;
  apiDeviceToVm = iot.apiDeviceToVm;
  storeDeviceFromVm = live.storeDeviceFromVm;
  PowerSwitch = (await import('../components/PowerSwitch.jsx')).PowerSwitch;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function seedWithSession(session) {
  localStorage.setItem(KEY, JSON.stringify({ ...JSON.parse(JSON.stringify(buildSeed())), session, reminderSent: [] }));
}

function Probe() {
  const { state, dispatch } = useStoreProbe();
  probe = { state, dispatch };
  return null;
}

let useStoreProbe;
beforeEach(async () => { useStoreProbe = (await import('../lib/store.jsx')).useStore; });

/** One switch per device in the store — the whole fleet, as a page shows it. */
function Fleet() {
  const { state } = useStoreProbe();
  return <div>{state.devices.map((d) => <PowerSwitch key={d.id} device={d} lang="en" showHint />)}</div>;
}

const switchFor = (id) => document.querySelector(`[data-device-id="${id}"]`);
const modeBtn = (id, mode) => document.querySelector(`[data-mode-device-id="${id}"][data-mode="${mode}"]`);
const modeOf = (id) => probe.state.devices.find((d) => d.id === id)?.mode;
const statusFor = (id) => switchFor(id)?.closest('.power-switch-wrap')?.querySelector('.power-switch-status')?.textContent || '';

/* ------------------------------------------------------------------ */
/* INVARIANT 1: an API device id always yields a usable farmer id      */
/* ------------------------------------------------------------------ */

describe('INVARIANT: the owner carried from the API is null or a non-empty string', () => {
  // Every kind of value a JSON row can actually carry for farmer_id.
  const VALUES = [undefined, null, '', '   ', '\t\n', 42, 0, {}, [], ['f1'], true, 'f1', '  f1  ', 'f1\n'];

  it('apiDeviceToVm never produces "" / undefined / junk for farmerId', () => {
    for (const v of VALUES) {
      const vm = apiDeviceToVm({ ...LIVE_ROW, farmer_id: v });
      expect(vm, `row rejected for farmer_id=${JSON.stringify(v)}`).toBeTruthy();
      const { farmerId } = vm;
      expect(farmerId === null || (typeof farmerId === 'string' && farmerId === farmerId.trim() && farmerId.length > 0))
        .toBe(true);
    }
  });

  it('storeDeviceFromVm passes that same invariant through, and keeps a real farmer', () => {
    for (const v of VALUES) {
      const vm = apiDeviceToVm({ ...LIVE_ROW, farmer_id: v });
      const device = storeDeviceFromVm(vm, '2026-09-04T12:00:00.000Z');
      expect(device.farmerId === null || (typeof device.farmerId === 'string' && device.farmerId.length > 0)).toBe(true);
    }
    expect(storeDeviceFromVm(apiDeviceToVm({ ...LIVE_ROW, farmer_id: '  f1  ' }), '2026-09-04T12:00:00.000Z').farmerId).toBe('f1');
  });
});

/* ------------------------------------------------------------------ */
/* INVARIANT 2 + 3: what a flip does, for every system in the fleet    */
/* ------------------------------------------------------------------ */

describe('INVARIANT: a flip either reaches the unit or sends nothing at all', () => {
  it('over the WHOLE fleet: no-unit systems publish nothing and never claim hardware', async () => {
    seedWithSession(FARMER);
    render(<StoreProvider><Probe /><Fleet /></StoreProvider>);
    await poll();

    const devices = probe.state.devices;
    expect(devices.length).toBe(buildSeed().devices.length + 1); // demo fleet + the live unit

    const withUnit = devices.filter((d) => d.live === true);
    const withoutUnit = devices.filter((d) => d.live !== true);
    expect(withUnit.map((d) => d.id)).toEqual([LIVE_ID]);
    expect(withoutUnit.length).toBeGreaterThan(1); // the property is not vacuous

    // Every no-unit system publishes nothing and claims no hardware — neither
    // the mode selector nor the switch that only works inside MAN.
    for (const d of withoutUnit) {
      await act(async () => { probe.dispatch({ type: 'SET_SYSTEM_MODE', deviceId: d.id, mode: 'manual', on: true }); });
      for (const on of [false, true]) {
        await act(async () => { probe.dispatch({ type: 'SET_SYSTEM_POWER', deviceId: d.id, on }); });
      }
      await act(async () => { probe.dispatch({ type: 'SET_SYSTEM_MODE', deviceId: d.id, mode: 'auto' }); });
      const audit = probe.state.audit.filter((a) => ['system.mode', 'system.on', 'system.off'].includes(a.action) && a.details.startsWith(d.id));
      expect(audit.length).toBe(4);
      for (const a of audit) {
        expect(a.details, `${d.id} audit claimed hardware`).not.toMatch(/relay/);
        expect(a.details).toMatch(/demo/i);
      }
      // ... and the screen says so, rather than showing bare controls.
      expect(statusFor(d.id)).toMatch(/Demo system/i);
    }
    expect(commands()).toEqual([]);

    // The system that DOES have a unit publishes exactly one command per
    // selection, and the two controls never stand in for each other.
    const send = async (action) => {
      const before = commands().length;
      await act(async () => { probe.dispatch(action); });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      return commands().slice(before);
    };

    expect(await send({ type: 'SET_SYSTEM_MODE', deviceId: LIVE_ID, mode: 'manual', on: true }))
      .toEqual([{ command: 'relay', value: 'ON' }]);
    expect(await send({ type: 'SET_SYSTEM_POWER', deviceId: LIVE_ID, on: false }))
      .toEqual([{ command: 'relay', value: 'OFF' }]);
    expect(await send({ type: 'SET_SYSTEM_POWER', deviceId: LIVE_ID, on: true }))
      .toEqual([{ command: 'relay', value: 'ON' }]);
    expect(await send({ type: 'SET_SYSTEM_MODE', deviceId: LIVE_ID, mode: 'auto' }))
      .toEqual([{ command: 'relay', value: 'AUTO' }]);
    // ... and its audit lines are the hardware ones
    const liveAudit = probe.state.audit.filter((a) => a.details.startsWith(LIVE_ID));
    expect(liveAudit.some((a) => /relay (ON|OFF)/.test(a.details))).toBe(true);
    expect(liveAudit.some((a) => /relay AUTO/.test(a.details))).toBe(true);
  });

  it('MAN is a round trip: the mode survives every flip and no flip sends AUTO', async () => {
    seedWithSession(FARMER);
    render(<StoreProvider><Probe /><Fleet /></StoreProvider>);
    await poll();

    const initialHeater = probe.state.devices.find((d) => d.id === LIVE_ID).heaterOn;

    // The operator takes the heater over in the state the unit already reports.
    await act(async () => { probe.dispatch({ type: 'SET_SYSTEM_MODE', deviceId: LIVE_ID, mode: 'manual', on: initialHeater }); });
    await act(async () => { await Promise.resolve(); });
    expect(modeOf(LIVE_ID)).toBe('manual');

    for (let cycle = 1; cycle <= 3; cycle++) {
      await act(async () => { probe.dispatch({ type: 'SET_SYSTEM_POWER', deviceId: LIVE_ID, on: false }); });
      await act(async () => { await Promise.resolve(); });
      expect(probe.state.devices.find((d) => d.id === LIVE_ID).systemOn).toBe(false);
      expect(modeOf(LIVE_ID)).toBe('manual'); // the whole point: OFF does not exit MAN

      await act(async () => { probe.dispatch({ type: 'SET_SYSTEM_POWER', deviceId: LIVE_ID, on: true }); });
      await act(async () => { await Promise.resolve(); });
      expect(probe.state.devices.find((d) => d.id === LIVE_ID).systemOn).toBe(true);
      expect(modeOf(LIVE_ID)).toBe('manual'); // and neither does ON

      const sent = commands();
      expect(sent.filter((c) => c.value === 'OFF').length).toBe(cycle);
      expect(sent.filter((c) => c.value === 'ON').length).toBe(1 + cycle);
      expect(sent.some((c) => c.value === 'AUTO')).toBe(false);
      // no other device was touched by those choices
      expect(new Set(calls.filter((c) => c.method === 'POST' && c.path.includes('/commands')).map((c) => c.path)).size).toBe(1);
    }
  });

  it('the UI controls on a system with no unit cannot claim success to the operator', async () => {
    seedWithSession(FARMER);
    render(<StoreProvider><Probe /><Fleet /></StoreProvider>);
    await poll();

    const demoId = probe.state.devices.find((d) => d.live !== true).id;
    await act(async () => { fireEvent.click(modeBtn(demoId, 'manual')); });
    expect(probe.state.toast.msg).toMatch(/demo system/i);

    await act(async () => { fireEvent.click(switchFor(demoId)); });
    await act(async () => { fireEvent.click(screen.getByText('Yes, switch off')); });

    expect(commands()).toEqual([]);
    expect(probe.state.toast.msg).toMatch(/demo system/i);
    expect(probe.state.toast.msg).not.toMatch(/heating stopped/i);
  });
});

/* ------------------------------------------------------------------ */
/* INVARIANT 4: link health is always the truth of the last poll       */
/* ------------------------------------------------------------------ */

describe('INVARIANT: the live link never reports a health it does not have', () => {
  it('alternating polls: flag, error and warnings all follow the last outcome', async () => {
    const { default: App } = await import('../App.jsx');
    seedWithSession(FARMER);
    window.location.hash = '#/farmer/systems';
    render(<HashRouter><StoreProvider><App /><Probe /></StoreProvider></HashRouter>);
    await poll();

    expect(probe.state.devices.some((d) => d.id === LIVE_ID)).toBe(true); // the unit is known
    const known = probe.state.devices.length;

    for (let round = 1; round <= 3; round++) {
      pollFails = true;
      await poll();
      expect(probe.state.liveHealth.ok).toBe(false);
      expect(typeof probe.state.liveHealth.error).toBe('string');
      expect(probe.state.liveHealth.error.length).toBeGreaterThan(0);
      expect(document.querySelector('.live-banner')).toBeTruthy();
      expect(statusFor(LIVE_ID)).toMatch(/Control server unreachable/i);
      expect(probe.state.devices.length).toBe(known); // last good overlay kept

      pollFails = false;
      await poll();
      expect(probe.state.liveHealth.ok).toBe(true);
      expect(probe.state.liveHealth.error).toBeNull();
      expect(document.querySelector('.live-banner')).toBeNull();
      expect(statusFor(LIVE_ID)).not.toMatch(/Control server unreachable/i);
      expect(probe.state.devices.length).toBe(known);
    }
  });

  it('a healthy link never shows the warning, and never once a poll succeeded', async () => {
    const { default: App } = await import('../App.jsx');
    seedWithSession(FARMER);
    window.location.hash = '#/farmer/systems';
    render(<HashRouter><StoreProvider><App /><Probe /></StoreProvider></HashRouter>);
    await poll();

    for (let i = 0; i < 3; i++) {
      await poll();
      expect(probe.state.liveHealth.ok).toBe(true);
      expect(document.querySelector('.live-banner')).toBeNull();
      expect(statusFor(LIVE_ID) || '').not.toMatch(/unreachable/i);
    }
  });
});
