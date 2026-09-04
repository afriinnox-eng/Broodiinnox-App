/**
 * Integration tests for the global live overlay (src/lib/store.jsx):
 * with VITE_IOT_API_URL set, a device registered in the UI must end up
 * showing the REAL API values in the store — the exact regression the user
 * reported (registered BROODIINNOX-001 showed 24°C instead of the real
 * reading). Registration and control actions must also reach the API.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

const DEVICE_ROW = {
  device_id: 'BROODIINNOX-001',
  name: 'Main Farm Unit',
  online: true,
  device_locked: false,
  failsafe_mode: false,
  sensor_error: false,
  mismatch_error: false,
  ave_temp: 27.6,
  temp1: 27.6,
  temp2: null,
  temp3: null,
  temp4: null,
  s1_enabled: true,
  s2_enabled: false,
  s3_enabled: false,
  s4_enabled: false,
  relay_state: true,
  manual_control: false,
  day: '3',
  total_days: '30',
  max_temp: '36',
  min_temp: '32',
  signal_quality: '25',
  last_seen_at: '2026-09-04T11:59:00.000Z',
  error: null,
};

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

let StoreProvider;
let useStore;
let buildSeed;
let calls = []; // {method, path, body}

beforeEach(async () => {
  localStorage.clear();
  calls = [];
  vi.unstubAllEnvs();
  vi.stubEnv('VITE_IOT_API_URL', 'https://iot.local');
  vi.stubEnv('VITE_IOT_TIMEOUT_MS', '2000');
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ method, path: u, body });
    if (method === 'GET' && u.endsWith('/api/devices')) {
      return jsonResponse({ count: 1, devices: [DEVICE_ROW] });
    }
    if (method === 'POST' && u.includes('/commands')) return jsonResponse({ accepted: true });
    if (method === 'POST' && u.endsWith('/api/devices')) return jsonResponse({ device: DEVICE_ROW });
    return jsonResponse({ ok: true });
  }));
  // Dynamic import AFTER the env stub so liveConfig resolves enabled:true.
  const store = await import('../lib/store.jsx');
  const seed = await import('../lib/seed.js');
  StoreProvider = store.StoreProvider;
  useStore = store.useStore;
  buildSeed = seed.buildSeed;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function Probe() {
  const { state } = useStore();
  const d = state.devices.find((x) => x.id === 'BROODIINNOX-001');
  return (
    <div data-testid="probe">
      {JSON.stringify({
        count: state.devices.length,
        live: !!(d && d.live),
        name: d ? d.name : null,
        temp: d && d.sensors[0] ? d.sensors[0].lastReading : null,
        heater: d ? d.heaterOn : null,
        baseMin: d ? d.baseMin : null,
        baseMax: d ? d.baseMax : null,
      })}
    </div>
  );
}

async function flushPoll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5100);
  });
}

it('adds API-registered live devices to the store with real telemetry', async () => {
  localStorage.setItem('broodiinnox_app_v1', JSON.stringify({ ...buildSeed(), session: null, reminderSent: [] }));
  const out = render(
    <StoreProvider><Probe /></StoreProvider>
  );
  await flushPoll();
  const probe = JSON.parse(out.getByTestId('probe').textContent);
  expect(probe.count).toBeGreaterThan(0);
  expect(probe.live).toBe(true);
  expect(probe.temp).toBe(27.6);
  expect(probe.heater).toBe(true);
  expect(probe.baseMax).toBe(36);
});

it('overlays REAL values onto a device the user registered in the UI (same id)', async () => {
  // Simulate the reported bug: user registered BROODIINNOX-001 in the app,
  // which seeded a static 24°C mock. The real API reading is 27.6°C.
  const seed = JSON.parse(JSON.stringify(buildSeed()));
  seed.devices.push({
    id: 'BROODIINNOX-001', serial: 'BROODIINNOX-001', name: 'BROODIINNOX-001', farmerId: 'f1',
    firmware: 'v2.1.0', installedAt: '2026-09-04T10:00:00.000Z',
    location: { district: 'Kigali', sector: 'Nyarugenge', lat: 0, lng: 0 },
    baseMin: 35, baseMax: 37, safetyFloor: 20, batch: null,
    sensors: [1, 2, 3, 4].map((i) => ({ id: i, enabled: true, lastReading: 24, health: 'ok' })),
    heaterOn: false, lastSeen: '2026-09-04T10:00:00.000Z',
    subscription: { planId: null, status: 'inactive', startDate: null, endDate: null },
    manualStatus: null,
  });
  localStorage.setItem('broodiinnox_app_v1', JSON.stringify({ ...seed, session: null, reminderSent: [] }));

  const out = render(
    <StoreProvider><Probe /></StoreProvider>
  );
  await flushPoll();

  const probe = JSON.parse(out.getByTestId('probe').textContent);
  expect(probe.count).toBe(seed.devices.length); // one row, not a duplicate
  expect(probe.live).toBe(true);
  expect(probe.temp).toBe(27.6); // real value wins over the mock 24
  expect(probe.name).toBe('Main Farm Unit'); // API name replaces serial-only name
  expect(probe.heater).toBe(true);
  expect(probe.baseMin).toBe(32);
  expect(probe.baseMax).toBe(36);
});

it('registers a new device against the real API when live', async () => {
  let dispatch;
  function RegButton() {
    const { state, dispatch: d } = useStore();
    dispatch = d;
    return <div>{state.devices.length}</div>;
  }
  localStorage.setItem('broodiinnox_app_v1', JSON.stringify({ ...buildSeed(), session: null, reminderSent: [] }));
  render(
    <StoreProvider><RegButton /></StoreProvider>
  );
  await act(async () => {
    dispatch({ type: 'REGISTER_DEVICE', serial: 'BROODIINNOX-099', name: 'New Unit', farmerId: 'f2' });
    await Promise.resolve();
    await Promise.resolve();
  });
  const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/api/devices'));
  expect(post).toBeTruthy();
  expect(post.body.device_id).toBe('BROODIINNOX-099');
  expect(post.body.farmer_id).toBe('f2');
});

it('forwards target/sensor/lock actions on live devices as firmware commands', async () => {  let dispatch;
  function Ctl() {
    const { state, dispatch: d } = useStore();
    dispatch = d;
    const dev = state.devices.find((x) => x.id === 'BROODIINNOX-001');
    return <div>{dev && dev.live ? 'live' : 'pending'}</div>;
  }
  localStorage.setItem('broodiinnox_app_v1', JSON.stringify({ ...buildSeed(), session: null, reminderSent: [] }));
  const out = render(
    <StoreProvider><Ctl /></StoreProvider>
  );
  await flushPoll();
  expect(out.getByText('live')).toBeTruthy();

  await act(async () => {
    dispatch({ type: 'SET_TARGETS', deviceId: 'BROODIINNOX-001', min: 31, max: 35 });
    await Promise.resolve();
    await Promise.resolve();
  });
  const cmds = calls.filter((c) => c.method === 'POST' && c.path.includes('/commands'));
  expect(cmds.length).toBe(2);
  expect(cmds[0].body).toEqual({ command: 'max_temp', value: '35' }); // max lands first
  expect(cmds[1].body).toEqual({ command: 'min_temp', value: '31' });

  calls.length = 0;
  await act(async () => {
    dispatch({ type: 'SET_SENSOR', deviceId: 'BROODIINNOX-001', sensorId: 2, enabled: false });
    await Promise.resolve();
    await Promise.resolve();
  });
  const sensor = calls.find((c) => c.method === 'POST' && c.path.includes('/commands'));
  expect(sensor.body).toEqual({ command: 'sensor', value: 'DS2:OFF' });

  calls.length = 0;
  await act(async () => {
    dispatch({ type: 'LOCK_DEVICE', deviceId: 'BROODIINNOX-001', lock: true });
    await Promise.resolve();
    await Promise.resolve();
  });
  const lock = calls.find((c) => c.method === 'POST' && c.path.includes('/commands'));
  expect(lock.body).toEqual({ command: 'device_active', value: 'LOCKED' });
});

it('syncs a rename of a live device back to the API registration', async () => {
  let dispatch;
  function R() {
    const { state, dispatch: d } = useStore();
    dispatch = d;
    const dev = state.devices.find((x) => x.id === 'BROODIINNOX-001');
    return <div>{dev && dev.live ? dev.name : 'pending'}</div>;
  }
  const seed = JSON.parse(JSON.stringify(buildSeed()));
  seed.devices.push({
    id: 'BROODIINNOX-001', serial: 'BROODIINNOX-001', name: 'BROODIINNOX-001', farmerId: 'f2',
    location: { district: 'Kigali', sector: 'Gasabo', lat: 0, lng: 0 }, sensors: [],
    subscription: { planId: null, status: 'inactive', startDate: null, endDate: null },
  });
  localStorage.setItem('broodiinnox_app_v1', JSON.stringify({ ...seed, session: null, reminderSent: [] }));
  const out = render(
    <StoreProvider><R /></StoreProvider>
  );
  await flushPoll();

  await act(async () => {
    dispatch({ type: 'RENAME_DEVICE', deviceId: 'BROODIINNOX-001', name: 'Coop A' });
    await Promise.resolve();
    await Promise.resolve();
  });
  const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/api/devices'));
  expect(post).toBeTruthy();
  expect(post.body.device_id).toBe('BROODIINNOX-001');
  expect(post.body.name).toBe('Coop A');
  expect(post.body.farmer_id).toBe('f2'); // upsert must not wipe the farmer
  expect(out.getByText('Coop A')).toBeTruthy();
});

it('SYNC_TIME on a live device sends set_time now; RESTART sends the reboot command', async () => {
  let dispatch;
  function Ctl2() {
    const { state, dispatch: d } = useStore();
    dispatch = d;
    const dev = state.devices.find((x) => x.id === 'BROODIINNOX-001');
    return <div>{dev && dev.live ? 'live' : 'pending'}</div>;
  }
  localStorage.setItem('broodiinnox_app_v1', JSON.stringify({ ...buildSeed(), session: null, reminderSent: [] }));
  const out = render(
    <StoreProvider><Ctl2 /></StoreProvider>
  );
  await flushPoll();
  expect(out.getByText('live')).toBeTruthy();

  calls.length = 0;
  await act(async () => {
    dispatch({ type: 'SYNC_TIME', deviceId: 'BROODIINNOX-001' });
    await Promise.resolve();
    await Promise.resolve();
  });
  const sync = calls.find((c) => c.method === 'POST' && c.path.includes('/commands'));
  expect(sync).toBeTruthy();
  expect(sync.body).toEqual({ command: 'set_time', value: 'now' });

  calls.length = 0;
  await act(async () => {
    dispatch({ type: 'RESTART_DEVICE', deviceId: 'BROODIINNOX-001' });
    await Promise.resolve();
    await Promise.resolve();
  });
  const boot = calls.find((c) => c.method === 'POST' && c.path.includes('/commands'));
  expect(boot).toBeTruthy();
  expect(boot.body).toEqual({ command: 'restart', value: 'RESTART' });
});

it('does NOT forward actions on simulation devices to the API', async () => {
  let dispatch;
  function S() {
    const { state, dispatch: d } = useStore();
    dispatch = d;
    return <div>{state.devices.length}</div>;
  }
  localStorage.setItem('broodiinnox_app_v1', JSON.stringify({ ...buildSeed(), session: null, reminderSent: [] }));
  render(
    <StoreProvider><S /></StoreProvider>
  );
  await flushPoll();
  await act(async () => {
    dispatch({ type: 'SET_TARGETS', deviceId: 'BRD001', min: 34, max: 36 });
    await Promise.resolve();
    await Promise.resolve();
  });
  const cmds = calls.filter((c) => c.method === 'POST' && c.path.includes('/commands'));
  expect(cmds).toEqual([]); // mock devices stay mock
});

it('END_BATCH on a live device survives the next LIVE_SYNC poll', async () => {
  let dispatch;
  function P() {
    const { state, dispatch: d } = useStore();
    dispatch = d;
    const dev = state.devices.find((x) => x.id === 'BROODIINNOX-001');
    return <div>{dev ? `${dev.batch && dev.batch.status}${dev.batch && dev.batch.synth ? '-synth' : ''}` : 'pending'}</div>;
  }
  const seed = JSON.parse(JSON.stringify(buildSeed()));
  seed.devices.push({
    id: 'BROODIINNOX-001', serial: 'BROODIINNOX-001', name: 'BROODIINNOX-001', farmerId: 'f1',
    location: { district: 'Kigali', sector: 'Gasabo', lat: 0, lng: 0 }, sensors: [],
    subscription: { planId: null, status: 'inactive', startDate: null, endDate: null },
  });
  localStorage.setItem('broodiinnox_app_v1', JSON.stringify({ ...seed, session: null, reminderSent: [] }));
  const out = render(
    <StoreProvider><P /></StoreProvider>
  );
  await flushPoll(); // first poll creates the live row with a synthesized running batch
  expect(out.getByText('running-synth')).toBeTruthy();

  await act(async () => {
    dispatch({ type: 'END_BATCH', deviceId: 'BROODIINNOX-001' });
  });
  expect(out.getByText('ended-synth')).toBeTruthy();

  await flushPoll(); // another LIVE_SYNC must NOT resurrect the batch as running
  expect(out.getByText('ended-synth')).toBeTruthy();
});

it('START_BATCH on a live device survives the next LIVE_SYNC poll', async () => {
  let dispatch;
  function P2() {
    const { state, dispatch: d } = useStore();
    dispatch = d;
    const dev = state.devices.find((x) => x.id === 'BROODIINNOX-001');
    const b = dev && dev.batch;
    return <div>{b ? `${b.animal}:${b.status}:${b.count}` : 'none'}</div>;
  }
  const seed = JSON.parse(JSON.stringify(buildSeed()));
  seed.devices.push({
    id: 'BROODIINNOX-001', serial: 'BROODIINNOX-001', name: 'BROODIINNOX-001', farmerId: 'f1',
    location: { district: 'Kigali', sector: 'Gasabo', lat: 0, lng: 0 }, sensors: [],
    subscription: { planId: null, status: 'inactive', startDate: null, endDate: null },
  });
  localStorage.setItem('broodiinnox_app_v1', JSON.stringify({ ...seed, session: null, reminderSent: [] }));
  const out = render(
    <StoreProvider><P2 /></StoreProvider>
  );
  await flushPoll();

  await act(async () => {
    dispatch({
      type: 'START_BATCH', deviceId: 'BROODIINNOX-001', animal: 'duck',
      durationDays: 28, count: 400, startDate: '2026-09-01T06:00:00.000Z',
    });
  });
  expect(out.getByText('duck:running:400')).toBeTruthy();

  await flushPoll(); // LIVE_SYNC must not swap the chosen duck batch for a synth one
  expect(out.getByText('duck:running:400')).toBeTruthy();
  expect(out.queryByText('duck:running:0')).toBeNull(); // count not reset by synth
});
