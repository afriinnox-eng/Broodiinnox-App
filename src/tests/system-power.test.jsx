/**
 * The system ON/OFF switch — the farmer's and the supervisor's remote power
 * switch, on every system.
 *
 * It drives the firmware relay the way `mqtt_callback()` implements it:
 * ON -> relay AUTO (thermostat control resumes), OFF -> relay OFF (heating
 * stopped, unit keeps reporting so it can be switched back on). The tests
 * below cover the three levels that matter:
 *
 *   - INVARIANT: a switched-off system is never heated by the simulation, it
 *     reports no target-band deviation (it holds no target band), a LOCKED
 *     system cannot be switched at all (the firmware ignores relay commands
 *     while locked), and flipping the switch never navigates.
 *   - BEHAVIOURAL: switching off asks for confirmation, stops the heater,
 *     flips the visible state and writes an audit entry naming the operator;
 *     switching back on does so immediately.
 *   - FUNCTIONAL: both roles' real pages (farmer My Systems + system page,
 *     admin device list + manage panel) render one working switch per system.
 */
import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { HashRouter } from 'react-router-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import App from '../App.jsx';
import { StoreProvider, useStore } from '../lib/store.jsx';
import { buildSeed } from '../lib/seed.js';
import { generateAlerts } from '../lib/services.js';

const KEY = 'broodiinnox_app_v1';

const FARMER = { id: 'f1', name: 'Jean Damascene', role: 'farmer', phone: '0788123456' };
const ADMIN = { id: 'a1', name: 'Innocent Ingabire', role: 'admin', adminRole: 'super', email: 'admin@afriinnox.com' };

let probe = { state: null, dispatch: null };

function Probe() {
  const { state, dispatch } = useStore();
  probe = { state, dispatch };
  return null;
}

function renderApp(hash, session, mutateSeed) {
  const seed = mutateSeed ? mutateSeed(buildSeed()) : buildSeed();
  localStorage.setItem(KEY, JSON.stringify({ ...seed, session, reminderSent: [] }));
  window.location.hash = hash;
  return render(
    <HashRouter>
      <StoreProvider>
        <App />
        <Probe />
      </StoreProvider>
    </HashRouter>
  );
}

const device = (id) => probe.state.devices.find((d) => d.id === id);
const switchFor = (container, id) => container.querySelector(`[role="switch"][data-device-id="${id}"]`);

/** Click a system's switch, confirming the OFF dialog when the action is "off". */
async function flip(container, id, confirmLabel) {
  const sw = switchFor(container, id);
  expect(sw, `no switch rendered for ${id}`).toBeTruthy();
  await act(async () => { fireEvent.click(sw); });
  if (confirmLabel) {
    await act(async () => { fireEvent.click(screen.getByText(confirmLabel)); });
  }
}

beforeEach(() => {
  localStorage.clear();
  probe = { state: null, dispatch: null };
});

describe('every system carries its own switch', () => {
  it('the farmer sees one switch per assigned system, ON by default', () => {
    const { container } = renderApp('#/farmer/systems', FARMER);
    const switches = container.querySelectorAll('[role="switch"]');
    expect(switches.length).toBe(2); // f1 owns BRD001 and BRD002
    expect(switchFor(container, 'BRD001').getAttribute('aria-checked')).toBe('true');
    expect(switchFor(container, 'BRD002').getAttribute('aria-checked')).toBe('true');
  });

  it('the supervisor sees one switch per system in the fleet, and a locked one is disabled', () => {
    const { container } = renderApp('#/admin/devices', ADMIN);
    const switches = container.querySelectorAll('[role="switch"]');
    expect(switches.length).toBe(buildSeed().devices.length);

    // Locked = lapsed subscription: the firmware silently drops relay commands,
    // so the control is refused up front instead of quietly doing nothing.
    expect(switchFor(container, 'BRD006').disabled).toBe(true); // expired subscription
    expect(switchFor(container, 'BRD008').disabled).toBe(true); // expired subscription
    expect(switchFor(container, 'BRD001').disabled).toBe(false);
    expect(switchFor(container, 'BRD001').getAttribute('aria-checked')).toBe('true');
  });
});

describe('farmer: switching a system off and back on', () => {
  it('OFF asks for confirmation first, then stops the heater and is audited', async () => {
    const { container } = renderApp('#/farmer/systems', FARMER);
    expect(device('BRD001').heaterOn).toBe(true);

    await act(async () => { fireEvent.click(switchFor(container, 'BRD001')); });
    expect(screen.getByText(/Switch off Main Farm/i)).toBeTruthy(); // confirmation dialog, brooder still running
    expect(device('BRD001').systemOn).not.toBe(false);
    expect(device('BRD001').heaterOn).toBe(true);

    await act(async () => { fireEvent.click(screen.getByText('Yes, switch off')); });
    expect(device('BRD001').systemOn).toBe(false);
    expect(device('BRD001').heaterOn).toBe(false);
    expect(switchFor(container, 'BRD001').getAttribute('aria-checked')).toBe('false');
    expect(switchFor(container, 'BRD001').textContent).toContain('OFF');

    const audit = probe.state.audit[0];
    expect(audit.action).toBe('system.off');
    expect(audit.details).toContain('relay OFF');
    expect(audit.user).toBe('Jean Damascene');
  });

  it('ON is immediate and puts the relay back under thermostat control', async () => {
    const { container } = renderApp('#/farmer/systems', FARMER);
    await flip(container, 'BRD001', 'Yes, switch off');
    expect(device('BRD001').systemOn).toBe(false);

    await act(async () => { fireEvent.click(switchFor(container, 'BRD001')); }); // no dialog
    expect(screen.queryByText(/Switch off Main Farm/i)).toBeNull();
    expect(device('BRD001').systemOn).toBe(true);
    expect(switchFor(container, 'BRD001').getAttribute('aria-checked')).toBe('true');
    expect(switchFor(container, 'BRD001').textContent).toContain('ON');

    const audit = probe.state.audit[0];
    expect(audit.action).toBe('system.on');
    expect(audit.details).toContain('relay AUTO');
  });

  it('flipping the switch inside a system card never opens that card', async () => {
    const { container } = renderApp('#/farmer/systems', FARMER);
    await flip(container, 'BRD001', 'Yes, switch off');
    expect(window.location.hash).toBe('#/farmer/systems'); // still the list, not /farmer/systems/BRD001
    expect(screen.getAllByText('My Systems').length).toBeGreaterThan(0);
  });
});

describe('supervisor: the same control from the admin console', () => {
  it('switches a system off from its manage panel and audits the admin who did it', async () => {
    const { container } = renderApp('#/admin/systems/BRD001', ADMIN);
    const switches = container.querySelectorAll('[role="switch"][data-device-id="BRD001"]');
    expect(switches.length).toBe(2); // the fleet row and the manage panel

    await act(async () => { fireEvent.click(switches[switches.length - 1]); });
    await act(async () => { fireEvent.click(screen.getByText('Yes, switch off')); });

    expect(device('BRD001').systemOn).toBe(false);
    expect(probe.state.audit[0].action).toBe('system.off');
    expect(probe.state.audit[0].user).toBe('Innocent Ingabire');
    expect(probe.state.audit[0].role).toBe('admin');
  });

  it('switches a system straight from the fleet table', async () => {
    const { container } = renderApp('#/admin/devices', ADMIN);
    await flip(container, 'BRD003', 'Yes, switch off');
    expect(device('BRD003').systemOn).toBe(false);
    expect(switchFor(container, 'BRD003').getAttribute('aria-checked')).toBe('false');
  });
});

describe('invariants of a switched-off system', () => {
  const cold = (patch = {}) => ({
    id: 'BRD002',
    baseMin: 33,
    baseMax: 35,
    batchDay: 5,
    systemOn: false,
    sensors: [{ id: 1, enabled: true, lastReading: 24 }],
    subscription: { status: 'active', endDate: '2027-01-01T00:00:00.000Z' },
    lastSeen: new Date().toISOString(),
    batch: null,
    ...patch,
  });

  it('reports a target-band deviation only while the system is running', () => {
    const now = new Date().toISOString();
    expect(generateAlerts(cold({ systemOn: true }), now).map((a) => a.key)).toContain('temp_low');
    expect(generateAlerts(cold({ systemOn: false }), now).map((a) => a.key)).not.toContain('temp_low');
  });

  it('is never heated again by the simulation tick, however cold it gets', async () => {
    const { container } = renderApp('#/farmer/systems', FARMER, (seed) => ({
      ...seed,
      devices: seed.devices.map((d) => (d.id === 'BRD002'
        ? { ...d, heaterOn: false, sensors: d.sensors.map((s) => ({ ...s, lastReading: 24 })) }
        : d)),
    }));

    // While the system is running, the failsafe heats a cold house ...
    await act(async () => { probe.dispatch({ type: 'TICK' }); });
    expect(device('BRD002').heaterOn).toBe(true);

    // ... but once the farmer switches it off, the tick must leave it off.
    await flip(container, 'BRD002', 'Yes, switch off');
    expect(device('BRD002').systemOn).toBe(false);
    expect(device('BRD002').heaterOn).toBe(false);
    await act(async () => { probe.dispatch({ type: 'TICK' }); });
    expect(device('BRD002').heaterOn).toBe(false);
  });

  it('never touches another system with the same action', async () => {
    const { container } = renderApp('#/farmer/systems', FARMER);
    await flip(container, 'BRD001', 'Yes, switch off');
    expect(device('BRD001').systemOn).toBe(false);
    expect(device('BRD002').systemOn).not.toBe(false); // untouched neighbour
    expect(device('BRD002').heaterOn).toBe(true);
  });
});
