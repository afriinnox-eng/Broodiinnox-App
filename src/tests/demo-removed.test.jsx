/**
 * The demonstration fleet is out of the app.
 *
 * Six farmers and eight systems used to be seeded into every browser that
 * opened the platform, and none of them existed: no unit sat behind
 * BRD001..BRD008. They are gone from src/lib/seed.js, and what has to hold is
 * that they are gone for EVERY shape of state a browser can be holding — one
 * written by an older build, one with no version marker at all, and the current
 * one, which must be kept rather than thrown away on every load.
 *
 *   INVARIANT   the real starting state holds no demonstration system, no
 *               demonstration farmer and exactly one console account, and every
 *               vintage of saved state is rebuilt into it — while the price
 *               catalogue the console owns survives that rebuild.
 *   BEHAVIOURAL a browser that carries the fleet loses it, and the addresses
 *               that belonged to those farmers no longer open anything.
 *   FUNCTIONAL  the entry point renders on the real state, the Super Admin
 *               still reaches the console, and a real unit reported by
 *               broodiinnox-api still lands in the store and on the page — the
 *               thing that would break if the fleet had been removed by simply
 *               emptying the app.
 *
 * The fixture is the definition of "demonstration data" here on purpose: these
 * assertions go red if any of it comes back into the app's own seed.
 */
import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import App from '../App.jsx';
import { StoreProvider, useStore } from '../lib/store.jsx';
import { ADMINS, FARMERS, SEED_VERSION, buildSeed } from '../lib/seed.js';
import { DEVICES as DEMO_DEVICES, FARMERS as DEMO_FARMERS, buildDemoSeed } from './fixtures/demoFleet.js';
import { approvedPlans, publishedSheet } from '../lib/subscriptions.js';

const KEY = 'broodiinnox_app_v1';

/**
 * The one demonstration id that is deliberately still in the app: the live
 * database assigns the real unit BROODIINNOX-001 to this farmer (`farmer_id` in
 * broodiinnox-api's devices table), so the record is what lets the console name
 * that system's owner. Every other demonstration id must be gone.
 */
const REAL_OWNER = 'f1';

const SUPER_ADMIN = 'afriinnox@gmail.com';
const ADMIN_SESSION = { id: 'a1', name: 'Afriinnox', role: 'admin', adminRole: 'super', email: SUPER_ADMIN };

/** A real unit as broodiinnox-api reports it. */
const REAL_VM = {
  id: 'BROODIINNOX-001', name: 'Damas', farmerId: REAL_OWNER,
  online: true, locked: false, failsafe: false, sensorError: false, mismatchError: false,
  minTemp: 32, maxTemp: 36, day: 3, totalDays: 30, heaterOn: false, manual: false,
  sensors: [{ id: 1, enabled: true, lastReading: 27.6, health: 'ok' }],
  lastSeenAt: new Date().toISOString(),
};

const demoDeviceIds = DEMO_DEVICES.map((d) => d.id);
const demoFarmerIds = DEMO_FARMERS.map((f) => f.id);

let probe = { state: null, dispatch: null };

function Probe() {
  const { state, dispatch } = useStore();
  probe = { state, dispatch };
  return null;
}

/** Mount the store on whatever is in localStorage, and hand back its state. */
function mountWith(saved) {
  localStorage.clear();
  if (saved !== undefined) localStorage.setItem(KEY, JSON.stringify(saved));
  probe = { state: null, dispatch: null };
  render(<StoreProvider><Probe /></StoreProvider>);
  return probe;
}

/** The whole app at a route, on the app's own real starting state. */
function open(route = '/', session = null) {
  localStorage.clear();
  localStorage.setItem(KEY, JSON.stringify({ ...buildSeed(), session, lang: 'en', reminderSent: [] }));
  return render(
    <MemoryRouter initialEntries={[route]}>
      <StoreProvider><Probe /><App /></StoreProvider>
    </MemoryRouter>
  );
}

/** Nothing from the demonstration may be in a state, in any collection. */
function expectNoDemonstration(state) {
  const devices = state.devices.map((d) => d.id);
  const farmers = state.farmers.map((f) => f.id);
  for (const id of demoDeviceIds) {
    expect(devices, `${id} is a demonstration system`).not.toContain(id);
  }
  for (const id of demoFarmerIds) {
    if (id === REAL_OWNER) continue;
    expect(farmers, `${id} is a demonstration farmer`).not.toContain(id);
  }
  expect(state.admins.map((a) => a.email)).toEqual([SUPER_ADMIN]);
  // and none of the records that only ever belonged to them
  for (const [name, rows] of Object.entries({
    payments: state.payments, alerts: state.alerts, tickets: state.tickets,
    maintenance: state.maintenance, inventory: state.inventory,
    messages: state.messages, audit: state.audit, notifications: state.notifications,
  })) {
    expect(rows, `${name} still carries demonstration records`).toEqual([]);
  }
}

beforeEach(() => {
  localStorage.clear();
  probe = { state: null, dispatch: null };
});

/* ------------------------------------------------------------------ */
/* INVARIANT: what the app starts from                                 */
/* ------------------------------------------------------------------ */

describe('INVARIANT: the real starting state holds nothing invented', () => {
  it('carries no demonstration system, and no system at all', () => {
    const seed = buildSeed();
    expect(seed.devices, 'a seeded system has no hardware behind it').toEqual([]);
    for (const id of demoDeviceIds) {
      expect(seed.devices.map((d) => d.id), id).not.toContain(id);
    }
  });

  it('carries only the farmers a real system is assigned to', () => {
    expect(buildSeed().farmers.map((f) => f.id)).toEqual([REAL_OWNER]);
    expect(FARMERS.map((f) => f.id)).toEqual([REAL_OWNER]);
    // and the five that were invented for the demonstration are nowhere
    for (const gone of demoFarmerIds.filter((id) => id !== REAL_OWNER)) {
      expect(buildSeed().farmers.map((f) => f.id), gone).not.toContain(gone);
    }
  });

  it('holds exactly one console account, and it is the Super Admin', () => {
    expect(buildSeed().admins).toEqual(ADMINS);
    expect(ADMINS).toHaveLength(1);
    expect(ADMINS[0]).toMatchObject({ email: SUPER_ADMIN, role: 'super', status: 'active' });
  });

  it('keeps the price catalogue, which is Afriinnox\'s and not a demonstration', () => {
    const seed = buildSeed();
    expect(seed.plans).toEqual(approvedPlans());
    expect(seed.sheet).toEqual(publishedSheet());
  });

  it('is stamped with the version loadState rebuilds from', () => {
    expect(buildSeed().version).toBe(SEED_VERSION);
  });
});

/* ------------------------------------------------------------------ */
/* INVARIANT: every vintage of saved state is rebuilt                  */
/* ------------------------------------------------------------------ */

describe('INVARIANT: a browser carrying the fleet is rebuilt without it', () => {
  /* Every value a version marker can legitimately be found in — a state written
     before the marker existed, one written by the build that seeded the fleet,
     and one written by a build newer than this. */
  const VINTAGES = [undefined, null, 0, 1, '1', 'v1', SEED_VERSION - 1, SEED_VERSION + 1];

  it('drops the fleet for every one of them', () => {
    for (const version of VINTAGES) {
      const { state } = mountWith({ ...buildDemoSeed(), version, session: null, reminderSent: [] });
      expect(state.devices, `a state marked ${JSON.stringify(version)} kept the fleet`).toHaveLength(0);
      expectNoDemonstration(state);
    }
  });

  it('is idempotent: mounting again leaves the same, empty fleet', () => {
    const first = mountWith({ ...buildDemoSeed(), version: 1, session: null, reminderSent: [] }).state;
    const second = mountWith({ ...buildDemoSeed(), version: 1, session: null, reminderSent: [] }).state;
    expect(second.devices).toEqual(first.devices);
    expect(second.farmers.map((f) => f.id)).toEqual(first.farmers.map((f) => f.id));
    expect(second.admins.map((a) => a.email)).toEqual(first.admins.map((a) => a.email));
  });

  it('but keeps a state written by this version, so real records are not wiped on every load', () => {
    const mine = { ...buildSeed(), version: SEED_VERSION, session: null, reminderSent: [] };
    mine.devices = [{
      id: 'BROODIINNOX-001', serial: 'BROODIINNOX-001', name: 'Damas', farmerId: REAL_OWNER,
      farmSize: 1000, live: true, subscription: { planId: null }, sensors: [], batch: null,
    }];
    const { state } = mountWith(mine);
    expect(state.devices.map((d) => d.id)).toEqual(['BROODIINNOX-001']);
  });

  it('survives the rebuild with the catalogue the console owns, not the stale one it carried', () => {
    const stale = [
      { id: 't15d', name: '15-Day', days: 15 },
      { id: 't90d', name: '90-Day', days: 90 },
      { id: 'bogus', name: 'Never sold', days: 12 },
    ];
    const { state } = mountWith({ ...buildDemoSeed(), version: 1, plans: stale, sheet: undefined, session: null, reminderSent: [] });
    expect(state.plans).toEqual(approvedPlans());
    expect(state.plans).toHaveLength(5);
    expect(state.sheet).toEqual(publishedSheet());
    // still no fleet, which is the point of rebuilding at all
    expect(state.devices).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* BEHAVIOURAL                                                         */
/* ------------------------------------------------------------------ */

describe('BEHAVIOURAL: the fleet is gone from the app a person uses', () => {
  it('a browser that carries the fleet signs in to a console without it', async () => {
    localStorage.clear();
    localStorage.setItem(KEY, JSON.stringify({ ...buildDemoSeed(), version: 1, session: ADMIN_SESSION, lang: 'en', reminderSent: [] }));
    const { container } = render(
      <MemoryRouter initialEntries={['/admin/devices']}>
        <StoreProvider><Probe /><App /></StoreProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(container.querySelector('.app-shell')).not.toBeNull());
    for (const id of demoDeviceIds) {
      expect(container.textContent, `${id} is still on the page`).not.toContain(id);
    }
    expect(probe.state.devices).toHaveLength(0);
  });

  it('keeps a session for an account that still exists, and drops one that does not', () => {
    // the Super Admin is a real account: their own sign-in is not part of what
    // was removed, so rebuilding the state must not log them out
    const admin = mountWith({ ...buildDemoSeed(), version: 1, session: ADMIN_SESSION, reminderSent: [] }).state;
    expect(admin.session).toMatchObject({ id: 'a1', email: SUPER_ADMIN });

    // a demonstration farmer does not exist any more, so that session goes with them
    for (const gone of demoFarmerIds.filter((id) => id !== REAL_OWNER)) {
      const state = mountWith({ ...buildDemoSeed(), version: 1, session: { id: gone, name: 'Demo', role: 'farmer' }, reminderSent: [] }).state;
      expect(state.session, `${gone} was still signed in`).toBeNull();
      expect(state.farmers.map((f) => f.id), gone).not.toContain(gone);
    }

    // and the real owner, who does still exist, keeps theirs
    const owner = mountWith({ ...buildDemoSeed(), version: 1, session: { id: REAL_OWNER, name: 'Owner', role: 'farmer' }, reminderSent: [] }).state;
    expect(owner.session).toMatchObject({ id: REAL_OWNER });
  });

  it('and the demonstration farmers can no longer sign in', async () => {
    for (const address of ['clarisse@farm.rw', 'eric@farm.rw', 'aimee@farm.rw', 'patrick@farm.rw', 'diane@farm.rw']) {
      const { container, unmount } = open('/');
      fireEvent.change(container.querySelector('#login-id'), { target: { value: address } });
      fireEvent.change(container.querySelector('#login-password'), { target: { value: 'a-password' } });
      fireEvent.submit(container.querySelector('form'));
      expect(container.querySelector('.app-shell'), `${address} opened a shell`).toBeNull();
      expect(container.querySelector('[role="alert"]').textContent, address).toMatch(/not registered/i);
      unmount();
    }
  });

  it('the console lists the one real account and nothing else', async () => {
    const { container } = open('/admin/admins', ADMIN_SESSION);
    await waitFor(() => expect(container.querySelector('.app-shell')).not.toBeNull());
    expect(container.textContent).toContain(SUPER_ADMIN);
    expect(probe.state.admins).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* FUNCTIONAL                                                          */
/* ------------------------------------------------------------------ */

describe('FUNCTIONAL: the assembled app on the real state', () => {
  it('renders the entry point, and the Super Admin still reaches the console', async () => {
    const { container } = open('/');
    fireEvent.change(container.querySelector('#login-id'), { target: { value: SUPER_ADMIN } });
    fireEvent.change(container.querySelector('#login-password'), { target: { value: 'a-password' } });
    fireEvent.submit(container.querySelector('form'));
    await waitFor(() => expect(container.querySelector('.app-shell')).not.toBeNull());
    expect(container.querySelector('.app-shell').className).toContain('console');
  });

  it('and a real unit from the API still lands in the store and on the console page', async () => {
    const { container } = open('/admin/devices', ADMIN_SESSION);
    await waitFor(() => expect(container.querySelector('.app-shell')).not.toBeNull());
    expect(probe.state.devices).toHaveLength(0);

    await act(async () => {
      probe.dispatch({ type: 'LIVE_SYNC', devices: [REAL_VM] });
    });

    const device = probe.state.devices.find((d) => d.id === REAL_VM.id);
    expect(device, 'the real unit was not added to an empty store').toBeTruthy();
    expect(device.live).toBe(true);
    expect(device.farmerId).toBe(REAL_OWNER);
    // the owner of that system is on the record, which is why it was kept
    expect(probe.state.farmers.map((f) => f.id)).toContain(REAL_OWNER);
    expect(container.textContent).toContain(REAL_VM.id);
  });
});
