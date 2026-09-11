/**
 * Invariant tests for src/lib/iot.js — the dashboard <-> broodiinnox-api
 * integration layer. Properties that hold for EVERY valid input:
 * config gating, URL building, headers, error taxonomy, timeout, adapters
 * (row -> dashboard model), atomic command vocabulary, idempotent lock
 * reconciliation.
 */
import { describe, expect, it } from 'vitest';
import {
  API_ENABLE_KEYS, API_SENSOR_KEYS,
  apiDeviceToVm, createIotApi, IotApiError, lockCommand,
  reconcileLockPlan, resolveIotConfig, sensorToggleCommand, targetsToCommands,
} from '../lib/iot.js';

/* ============================= config ============================= */

describe('resolveIotConfig', () => {
  it('is disabled unless an absolute http(s) base URL is set', () => {
    expect(resolveIotConfig({}).enabled).toBe(false);
    expect(resolveIotConfig({ VITE_IOT_API_URL: 'localhost:3001' }).enabled).toBe(false);
    expect(resolveIotConfig({ VITE_IOT_API_URL: 'ftp://x' }).enabled).toBe(false);
    expect(resolveIotConfig({ VITE_IOT_API_URL: 'https://api.example.com' }).enabled).toBe(true);
    expect(resolveIotConfig({ VITE_IOT_API_URL: 'http://127.0.0.1:3001' }).enabled).toBe(true);
  });

  it('tolerates trailing slashes and falls back to VITE_API_URL', () => {
    const a = resolveIotConfig({ VITE_IOT_API_URL: 'https://api.example.com////' });
    expect(a.baseUrl).toBe('https://api.example.com');
    const b = resolveIotConfig({ VITE_API_URL: 'http://localhost:3001/' });
    expect(b.enabled).toBe(true);
    expect(b.baseUrl).toBe('http://localhost:3001');
  });

  it('carries the api key and clamps timeout defaults', () => {
    expect(resolveIotConfig({ VITE_IOT_API_URL: 'http://x', VITE_IOT_API_KEY: 'k1' }).apiKey).toBe('k1');
    expect(resolveIotConfig({ VITE_IOT_API_URL: 'http://x' }).timeoutMs).toBe(8000);
    expect(resolveIotConfig({ VITE_IOT_API_URL: 'http://x', VITE_IOT_TIMEOUT_MS: 'not-a-number' }).timeoutMs).toBe(8000);
    expect(resolveIotConfig({ VITE_IOT_API_URL: 'http://x', VITE_IOT_TIMEOUT_MS: '250' }).timeoutMs).toBe(250);
  });
});

/* ============================= client ============================= */

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function captureFetch(calls) {
  return async (url, opts) => {
    calls.push({ url: String(url), opts });
    return jsonResponse(200, { ok: true, echo: JSON.parse(opts.body || 'null') });
  };
}

describe('createIotApi client', () => {
  it('rejects creation when no base URL is configured', () => {
    expect(() => createIotApi({ baseUrl: '' })).toThrow(IotApiError);
    expect(() => createIotApi({ baseUrl: 'relative/path' })).toThrow(IotApiError);
  });

  it('builds correct absolute URLs and sends GET without a body', async () => {
    const calls = [];
    const api = createIotApi({ baseUrl: 'http://iot.local:3001', fetchImpl: captureFetch(calls) });
    await api.listDevices();
    await api.health();
    expect(calls.map((c) => c.url)).toEqual([
      'http://iot.local:3001/api/devices',
      'http://iot.local:3001/api/health',
    ]);
    expect(calls.every((c) => c.opts.method === 'GET' || c.opts.method === undefined)).toBe(true);
  });

  it('posts commands as JSON with the API key header', async () => {
    const calls = [];
    const api = createIotApi({ baseUrl: 'http://iot.local', apiKey: 'secret-42', fetchImpl: captureFetch(calls) });
    const res = await api.sendCommand('BROODIINNOX-002', 'max_temp', 36);
    const call = calls[0];
    expect(call.url).toBe('http://iot.local/api/devices/BROODIINNOX-002/commands');
    expect(call.opts.method).toBe('POST');
    expect(call.opts.headers['x-api-key']).toBe('secret-42');
    expect(call.opts.headers['content-type']).toBe('application/json');
    expect(res.echo).toEqual({ command: 'max_temp', value: 36 });
  });

  it('omits the api key header when none is configured', async () => {
    const calls = [];
    const api = createIotApi({ baseUrl: 'http://iot.local', fetchImpl: captureFetch(calls) });
    await api.listDevices();
    expect(calls[0].opts.headers['x-api-key']).toBeUndefined();
  });

  it('encodes device ids inside paths and serializes query params', async () => {
    const calls = [];
    const api = createIotApi({ baseUrl: 'http://iot.local', fetchImpl: captureFetch(calls) });
    await api.getDevice('BRD 1/X');
    await api.readings('BRD1', { limit: 5, from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' });
    expect(calls[0].url).toBe('http://iot.local/api/devices/BRD%201%2FX');
    expect(calls[1].url).toContain('/api/devices/BRD1/readings?');
    expect(calls[1].url).toContain('limit=5');
    expect(calls[1].url).toContain('from=2026-01-01T00%3A00%3A00Z');
    expect(calls[1].url).toContain('to=2026-02-01T00%3A00%3A00Z');
  });

  it('rejects non-2xx with the server error message and status', async () => {
    const fetchImpl = async () => jsonResponse(400, { error: 'relay expects ON/OFF/AUTO' });
    const api = createIotApi({ baseUrl: 'http://iot.local', fetchImpl });
    await expect(api.sendCommand('BROODIINNOX-002', 'relay', 'MAYBE')).rejects.toMatchObject({
      name: 'IotApiError',
      status: 400,
      message: 'relay expects ON/OFF/AUTO',
    });
  });

  it('maps network failures and aborts into typed errors', async () => {
    const down = createIotApi({
      baseUrl: 'http://iot.local',
      timeoutMs: 25,
      fetchImpl: async () => { throw new TypeError('fetch failed'); },
    });
    await expect(down.health()).rejects.toMatchObject({ code: 'network' });

    const never = createIotApi({
      baseUrl: 'http://iot.local',
      timeoutMs: 20,
      fetchImpl: (_url, { signal }) => new Promise((_res, rej) => {
        signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
      }),
    });
    await expect(never.health()).rejects.toMatchObject({ code: 'timeout' });
  });

  it('refuses paths that do not start with "/"', async () => {
    const api = createIotApi({ baseUrl: 'http://iot.local', fetchImpl: captureFetch([]) });
    await expect(api.request('api/devices')).rejects.toMatchObject({ code: 'invalid-path' });
  });
});

/* ============================= adapters ============================= */

const REAL_API_ROW = {
  device_id: 'BROODIINNOX-002',
  name: 'Main Farm',
  online: true,
  stale: false,
  device_locked: false,
  relay_state: true,
  manual_control: false,
  failsafe_mode: false,
  sensor_error: false,
  mismatch_error: false,
  signal_quality: 18,
  ave_temp: 33.4,
  max_temp: 35,
  min_temp: 32,
  day: 12,
  total_days: 30,
  temp1: 33.1, temp2: 33.6, temp3: 34.2,
  s1_enabled: true, s2_enabled: true, s3_enabled: true, s4_enabled: null,
  last_seen_at: '2026-08-05T14:30:00.000Z',
};

describe('apiDeviceToVm', () => {
  it('maps a real API row into the dashboard device model', () => {
    const vm = apiDeviceToVm(REAL_API_ROW);
    expect(vm.id).toBe('BROODIINNOX-002');
    expect(vm.name).toBe('Main Farm');
    expect(vm.online).toBe(true);
    expect(vm.locked).toBe(false);
    expect(vm.relayOn).toBe(true);
    expect(vm.heaterOn).toBe(true);
    expect(vm.manual).toBe(false);
    expect(vm.maxTemp).toBe(35);
    expect(vm.minTemp).toBe(32);
    expect(vm.day).toBe(12);
    expect(vm.totalDays).toBe(30);
    expect(vm.signalQuality).toBe(18);
    expect(vm.lastSeenAt).toBe('2026-08-05T14:30:00.000Z');
    expect(vm.temps).toEqual([33.1, 33.6, 34.2, null]);
    // s4_enabled is null and sensor 4 has no reading -> treated as disabled
    expect(vm.sensors.map((s) => s.enabled)).toEqual([true, true, true, false]);
    expect(vm.sensors[3].lastReading).toBeNull();
  });

  it('accepts the { device: row } envelope the API returns', () => {
    const vm = apiDeviceToVm({ device: REAL_API_ROW });
    expect(vm.id).toBe('BROODIINNOX-002');
    expect(apiDeviceToVm(null)).toBeNull();
  });

  it('produces a fixed, known output shape (no junk keys leak through)', () => {
    const vm = apiDeviceToVm({ ...REAL_API_ROW, device_id: 'X', some_future_field: 'junk' });
    const keys = Object.keys(vm).sort();
    expect(keys).toEqual([
      'aveTemp', 'day', 'failsafe', 'farmerId', 'heaterOn', 'id', 'lastSeenAt',
      'locked', 'manual', 'maxTemp', 'mismatchError', 'minTemp', 'name', 'online',
      'relayOn', 'sensorError', 'sensors', 'signalQuality', 'stale', 'temps',
      'totalDays',
    ].sort());
  });

  it('carries the owning farmer, so a farmer sees the real unit', () => {
    expect(apiDeviceToVm({ ...REAL_API_ROW, farmer_id: 'f1' }).farmerId).toBe('f1');
    expect(apiDeviceToVm({ ...REAL_API_ROW, farmer_id: '  ' }).farmerId).toBeNull();
    expect(apiDeviceToVm({ ...REAL_API_ROW, farmer_id: undefined }).farmerId).toBeNull();
  });

  it('sanitizes temperatures: impossible values become null, never poison control', () => {
    const row = { ...REAL_API_ROW, temp1: 300, temp2: -999, temp3: '36.5', temp4: 'garbage', ave_temp: -999 };
    const vm = apiDeviceToVm(row);
    expect(vm.temps).toEqual([null, null, 36.5, null]);
    expect(vm.aveTemp).toBeNull(); // firmware -999 NaN sentinel never surfaces
    // an absent reading must not be reported as enabled+healthy
    expect(vm.sensors[3].health).toBe('err');
  });

  it('infers sensor enablement from a live reading when the enable flag is null', () => {
    const row = { ...REAL_API_ROW, temp4: 34.0, s4_enabled: null };
    expect(apiDeviceToVm(row).sensors[3].enabled).toBe(true);
    const cold = { ...REAL_API_ROW, s4_enabled: null }; // temp4 null
    expect(apiDeviceToVm(cold).sensors[3].enabled).toBe(false);
  });

  it('clamps day and total_days and treats unknown lock as unlocked', () => {
    const row = { ...REAL_API_ROW, day: -3, total_days: 999, device_locked: null };
    const vm = apiDeviceToVm(row);
    expect(vm.day).toBe(0);
    expect(vm.totalDays).toBe(365);
    expect(vm.locked).toBe(false);
  });

  it('round-trips: a row mapped twice is identical (pure)', () => {
    const a = apiDeviceToVm(REAL_API_ROW);
    expect(apiDeviceToVm(REAL_API_ROW)).toEqual(a);
    expect(API_SENSOR_KEYS.length).toBe(4);
    expect(API_ENABLE_KEYS.length).toBe(4);
  });
});

/* ========================= command vocabulary ========================= */

describe('targetsToCommands', () => {
  it('turns a valid band into min_temp + max_temp commands', () => {
    const { commands, errors } = targetsToCommands({ min: 32, max: 36 });
    expect(errors).toEqual([]);
    expect(commands).toEqual([
      { command: 'min_temp', value: 32 },
      { command: 'max_temp', value: 36 },
    ]);
  });

  it('rejects inverted or out-of-range bands atomically', () => {
    expect(targetsToCommands({ min: 36, max: 32 }).commands).toEqual([]);
    expect(targetsToCommands({ min: 9, max: 36 }).errors.length).toBeGreaterThan(0);
    expect(targetsToCommands({ min: 32, max: 51 }).errors.length).toBeGreaterThan(0);
    expect(targetsToCommands({ min: 'abc', max: 36 }).commands).toEqual([]);
    // atomic: never a partial command set
    const bad = targetsToCommands({ min: 40, max: 39 });
    expect(bad.commands).toEqual([]);
    expect(bad.errors.length).toBeGreaterThan(0);
  });

  it('truncates float inputs to whole degrees like the firmware', () => {
    const { commands } = targetsToCommands({ min: 31.9, max: 35.1 });
    expect(commands).toEqual([
      { command: 'min_temp', value: 31 },
      { command: 'max_temp', value: 35 },
    ]);
  });
});

describe('sensorToggleCommand', () => {
  it('maps sensors 1-4 to firmware DSx:ON/OFF strings', () => {
    expect(sensorToggleCommand(1, true)).toEqual({ command: 'sensor', value: 'DS1:ON' });
    expect(sensorToggleCommand(4, false)).toEqual({ command: 'sensor', value: 'DS4:OFF' });
    for (const bad of [0, 5, -1, 'x', null, undefined]) {
      expect(sensorToggleCommand(bad, true)).toBeNull();
    }
  });
});

/* ======================= lock reconciliation ======================= */

describe('lockCommand / reconcileLockPlan', () => {
  it('locks only when the unit is not already locked (idempotent)', () => {
    expect(lockCommand(false, true)).toEqual({ command: 'device_active', value: 'LOCKED' });
    expect(lockCommand(null, true)).toEqual({ command: 'device_active', value: 'LOCKED' });
    expect(lockCommand(true, true)).toBeNull();
  });

  it('unlocks only a proven-locked unit and never spams unknown units', () => {
    expect(lockCommand(true, false)).toEqual({ command: 'device_active', value: 'ACTIVE' });
    expect(lockCommand(false, false)).toBeNull();
    expect(lockCommand(null, false)).toBeNull();
  });

  it('reconciliation plans are complete, deterministic and describe each unit', () => {
    const plan = reconcileLockPlan([
      { deviceId: 'A', currentLocked: false, wantLocked: true },
      { deviceId: 'B', currentLocked: true, wantLocked: false },
      { deviceId: 'C', currentLocked: true, wantLocked: true },
      { deviceId: 'D', currentLocked: null, wantLocked: false },
    ]);
    expect(plan).toEqual([
      { deviceId: 'A', command: { command: 'device_active', value: 'LOCKED' }, reason: 'subscription inactive -> lock unit' },
      { deviceId: 'B', command: { command: 'device_active', value: 'ACTIVE' }, reason: 'subscription active -> unlock unit' },
      { deviceId: 'C', command: null, reason: 'already in desired state' },
      { deviceId: 'D', command: null, reason: 'already in desired state' },
    ]);
    expect(reconcileLockPlan([])).toEqual([]);
  });
});
