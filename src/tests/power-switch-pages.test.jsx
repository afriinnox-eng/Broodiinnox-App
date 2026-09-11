/**
 * The switch the farmer and the supervisor actually touch.
 *
 * These tests render the REAL pages (farmer My Systems, farmer system page,
 * admin Devices) against the payload the LIVE broodiinnox-api returns, and
 * assert that flipping a switch publishes the firmware command to the API.
 *
 * They exist because the switch once flipped in the app while nothing left the
 * browser: what the operator touched was a card with no unit behind it, and the
 * UI said nothing. A switch must either reach the unit or say why it cannot.
 */
import React from 'react';
import { HashRouter, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

/** Verbatim shape of GET /api/devices on the live API (device_state row). */
const LIVE_ROW = {
  device_id: 'BROODIINNOX-001',
  name: 'Damas',
  farmer_id: 'f1',
  location: 'Kigali',
  registered_at: '2026-09-04T15:50:24.145Z',
  online: true,
  last_seen_at: '2026-09-04T11:59:00.000Z',
  relay_state: true,
  manual_control: false,
  day: '3',
  total_days: '30',
  max_temp: '31',
  min_temp: '30',
  ave_temp: 28.5,
  temp1: 28.5,
  temp2: null,
  temp3: null,
  temp4: null,
  s1_enabled: true,
  s2_enabled: false,
  s3_enabled: false,
  s4_enabled: false,
  failsafe_mode: false,
  sensor_error: false,
  mismatch_error: false,
  device_locked: false,
  signal_quality: '26',
  error: null,
  stale: false,
};

const FARMER = { id: 'f1', name: 'Jean Damascene', role: 'farmer', phone: '0788123456' };
const ADMIN = { id: 'a1', name: 'Innocent Ingabire', role: 'admin', adminRole: 'super', email: 'admin@afriinnox.com' };

let StoreProvider;
let useStore;
let buildSeed;
let calls = [];

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) };
}

/** Requests the app made to the API, as {method, path, body}. */
const commands = () => calls.filter((c) => c.method === 'POST' && c.path.includes('/commands'));

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
    calls.push({ method, path: u, body: opts.body ? JSON.parse(opts.body) : null });
    if (method === 'GET' && u.endsWith('/api/devices')) return jsonResponse({ count: 1, devices: [LIVE_ROW] });
    if (method === 'POST' && u.includes('/commands')) return jsonResponse({ accepted: true });
    return jsonResponse({ ok: true });
  }));
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

/**
 * A session on top of the demo seed. The real unit is deliberately NOT in the
 * local store unless asked for: the browser that opens the app has usually
 * never registered it, which is exactly how a farmer ends up looking at a
 * farm of demo systems.
 */
function seedWithSession(session, { registeredLocally = false } = {}) {
  const seed = JSON.parse(JSON.stringify(buildSeed())); // deep copy: buildSeed() shares its device objects
  if (registeredLocally) {
    seed.devices.push({
      id: 'BROODIINNOX-001', serial: 'BROODIINNOX-001', name: 'Damas', farmerId: 'f1',
      location: { district: 'Kigali', sector: '—', lat: 0, lng: 0 },
      sensors: [{ id: 1, enabled: true, lastReading: 28.5, health: 'ok' }],
      heaterOn: true, live: true, systemOn: true, lastSeen: '2026-09-04T11:59:00.000Z',
      subscription: { planId: 'p30', status: 'active', startDate: '2026-09-04T00:00:00.000Z', endDate: '2027-09-04T00:00:00.000Z' },
    });
  }
  localStorage.setItem('broodiinnox_app_v1', JSON.stringify({ ...seed, session, reminderSent: [] }));
}

async function flushPoll() {
  await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
}

/** The switch and the mode selector rendered for one device id. */
const switchFor = (id) => document.querySelector(`[data-device-id="${id}"]`);
const modeFor = (id, mode) => document.querySelector(`[data-mode-device-id="${id}"][data-mode="${mode}"]`);
const statusOf = (id) => switchFor(id)?.closest('.power-switch-wrap')?.querySelector('.power-switch-status')?.textContent || '';

/** Choose AUT or MAN, as the user does. */
async function selectMode(id, mode) {
  await act(async () => { fireEvent.click(modeFor(id, mode)); });
}

/** Put the system in MAN, then flip the switch off, confirming the dialog. */
async function flipOff(id) {
  await selectMode(id, 'manual');
  await act(async () => { fireEvent.click(switchFor(id)); });
  await act(async () => { fireEvent.click(screen.getByText('Yes, switch off')); });
}

async function renderFarmerSystems() {
  const { default: FarmerSystems } = await import('../pages/farmer/Systems.jsx');
  render(
    <StoreProvider>
      <MemoryRouter initialEntries={['/farmer/systems']}>
        <Routes><Route path="/farmer/systems" element={<FarmerSystems />} /></Routes>
      </MemoryRouter>
    </StoreProvider>
  );
  await flushPoll();
}

describe('the system switch on the pages the user actually opens', () => {
  // These drive the live poll through real timers, so their runtime tracks
  // machine load (2s alone, over 5s with the whole suite running).
  it('farmer → My systems: the real unit\'s switch publishes relay ON then OFF to the API', async () => {
    seedWithSession(FARMER);
    await renderFarmerSystems();

    const sw = switchFor('BROODIINNOX-001');
    expect(sw, 'the real unit is missing from the farmer\'s systems').toBeTruthy();

    // The unit reports AUT: the system switches the heater itself, so the
    // switch is disabled until the operator takes it over.
    expect(modeFor('BROODIINNOX-001', 'auto').getAttribute('aria-pressed')).toBe('true');
    expect(sw.disabled).toBe(true);
    expect(sw.textContent).toContain('AUT');

    // MAN takes the heater over in the state the unit reports (heater on =
    // relay_state true), so the FIRST command is relay ON — never relay AUTO.
    await selectMode('BROODIINNOX-001', 'manual');
    expect(commands().map((c) => c.body)).toEqual([{ command: 'relay', value: 'ON' }]);
    expect(switchFor('BROODIINNOX-001').disabled).toBe(false);

    const afterMode = commands().length;
    await act(async () => { fireEvent.click(switchFor('BROODIINNOX-001')); });
    await act(async () => { fireEvent.click(screen.getByText('Yes, switch off')); });
    expect(commands().slice(afterMode).map((c) => c.body)).toEqual([{ command: 'relay', value: 'OFF' }]);
    expect(switchFor('BROODIINNOX-001').getAttribute('aria-checked')).toBe('false');
    expect(commands().some((c) => c.body.value === 'AUTO')).toBe(false);
  }, 20000);

  it('farmer → My systems: the real unit is shown even with no local registration', async () => {
    // The API registration carries the owner; the browser does not have to
    // have registered the unit itself for the farmer to see and control it.
    seedWithSession(FARMER, { registeredLocally: false });
    await renderFarmerSystems();

    expect(switchFor('BROODIINNOX-001')).toBeTruthy();
    await flipOff('BROODIINNOX-001');
    expect(commands().map((c) => c.body)).toEqual([
      { command: 'relay', value: 'ON' },   // MAN takes the heater over as it is
      { command: 'relay', value: 'OFF' },  // then the operator switches it off
    ]);
  }, 20000);

  it('farmer → system detail: flipping the switch publishes relay ON then OFF to the API', async () => {
    const { default: SystemDetail } = await import('../pages/farmer/SystemDetail.jsx');
    seedWithSession(FARMER);
    render(
      <StoreProvider>
        <MemoryRouter initialEntries={['/farmer/systems/BROODIINNOX-001']}>
          <Routes><Route path="/farmer/systems/:id" element={<SystemDetail />} /></Routes>
        </MemoryRouter>
      </StoreProvider>
    );
    await flushPoll();

    expect(switchFor('BROODIINNOX-001')).toBeTruthy();
    await flipOff('BROODIINNOX-001');
    expect(commands().map((c) => c.body)).toEqual([
      { command: 'relay', value: 'ON' },
      { command: 'relay', value: 'OFF' },
    ]);
  });

  it('admin → Devices: flipping the row switch publishes relay ON then OFF to the API', async () => {
    const { default: AdminDevices } = await import('../pages/admin/Devices.jsx');
    seedWithSession(ADMIN);
    render(
      <StoreProvider>
        <MemoryRouter initialEntries={['/admin/devices']}>
          <Routes><Route path="/admin/devices" element={<AdminDevices />} /></Routes>
        </MemoryRouter>
      </StoreProvider>
    );
    await flushPoll();

    expect(switchFor('BROODIINNOX-001')).toBeTruthy();
    await flipOff('BROODIINNOX-001');
    expect(commands().map((c) => c.body)).toEqual([
      { command: 'relay', value: 'ON' },
      { command: 'relay', value: 'OFF' },
    ]);
  });
});

describe('a switch with no unit behind it says so', () => {
  it('a demo system is labelled, and flipping it never claims a command landed', async () => {
    seedWithSession(FARMER);
    await renderFarmerSystems();

    const demo = switchFor('BRD001'); // seeded demo system — no hardware
    expect(demo).toBeTruthy();
    expect(statusOf('BRD001')).toMatch(/Demo system/i);

    await act(async () => { fireEvent.click(modeFor('BRD001', 'manual')); });
    await flipOff('BRD001');
    expect(commands()).toEqual([]); // nothing was published anywhere
    expect(switchFor('BRD001').closest('.power-switch-wrap').textContent).toMatch(/Demo system/i);
  });

  it('the switch itself reports that the control server is unreachable', async () => {
    // The unit is known from an earlier session, but the server never answers.
    seedWithSession(FARMER, { registeredLocally: true });
    globalThis.fetch.mockImplementation(async () => { throw new Error('Failed to fetch'); });
    await renderFarmerSystems();

    expect(statusOf('BROODIINNOX-001')).toMatch(/Control server unreachable/i);
    expect(commands()).toEqual([]);
  });
});

describe('the app never hides a dead control link', () => {
  it('shows an app-wide warning when the control server is unreachable', async () => {
    const { default: App } = await import('../App.jsx');
    seedWithSession(FARMER, { registeredLocally: true });
    globalThis.fetch.mockImplementation(async () => { throw new Error('Failed to fetch'); });
    window.location.hash = '#/farmer/systems';

    render(
      <HashRouter>
        <StoreProvider><App /></StoreProvider>
      </HashRouter>
    );
    await flushPoll();

    const banner = document.querySelector('.live-banner');
    expect(banner, 'no control-server banner').toBeTruthy();
    expect(banner.textContent).toMatch(/control server/i);
  });

  it('shows no such warning while the server is answering', async () => {
    const { default: App } = await import('../App.jsx');
    seedWithSession(FARMER, { registeredLocally: true });
    window.location.hash = '#/farmer/systems';

    render(
      <HashRouter>
        <StoreProvider><App /></StoreProvider>
      </HashRouter>
    );
    await flushPoll();

    expect(document.querySelector('.live-banner')).toBeNull();
  });
});
