/**
 * Remote control of a system: the AUT/MAN mode selector and the master switch.
 *
 * Two controls, because they answer two questions. AUT means the system runs
 * itself — the firmware's thermostat drives the heater from the temperature —
 * and the switch is not the operator's to make. MAN means the operator holds
 * the heater ON or OFF. The choices go to the firmware's `relay` topic exactly
 * as `mqtt_callback()` implements it:
 *
 *   AUT -> relay AUTO     MAN ON -> relay ON     MAN OFF -> relay OFF
 *
 * The tests below cover the three levels that matter:
 *
 *   - INVARIANT: in AUT flipping the switch can change nothing at all, a MAN
 *     system is never heated again by the simulation, a LOCKED system can
 *     neither change mode nor be switched, and one system's controls never
 *     touch another's.
 *   - BEHAVIOURAL: selecting MAN takes the heater over in the state it is
 *     already in, MAN OFF asks for confirmation and stops the heater, MAN ON
 *     holds it on, the mode survives an OFF/ON round trip, and every change is
 *     audited naming the operator who made it.
 *   - FUNCTIONAL: both roles' real pages (farmer My Systems + system page,
 *     admin device list + manage panel) render the selector and the switch.
 */
import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { HashRouter } from 'react-router-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import App from '../App.jsx';
import { StoreProvider, useStore } from '../lib/store.jsx';
import { deviceMode } from '../lib/live.js';
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
const switchAll = (container, id) => [...container.querySelectorAll(`[role="switch"][data-device-id="${id}"]`)];
const switchFor = (container, id) => switchAll(container, id)[0];
const modeAll = (container, id, mode) => [...container.querySelectorAll(`[data-mode-device-id="${id}"][data-mode="${mode}"]`)];
const statusOf = (container, id) => switchFor(container, id).closest('.power-switch-wrap')?.querySelector('.power-switch-status')?.textContent || '';

/** Choose AUT or MAN, as the operator does (the panel control is the last one). */
async function selectMode(container, id, mode) {
  const buttons = modeAll(container, id, mode);
  expect(buttons.length, `no ${mode} button rendered for ${id}`).toBeGreaterThan(0);
  await act(async () => { fireEvent.click(buttons[buttons.length - 1]); });
}

/** Flip the switch, confirming the OFF dialog when the action is "off". */
async function flip(container, id, confirmLabel) {
  const switches = switchAll(container, id);
  expect(switches.length, `no switch rendered for ${id}`).toBeGreaterThan(0);
  await act(async () => { fireEvent.click(switches[switches.length - 1]); });
  if (confirmLabel) {
    await act(async () => { fireEvent.click(screen.getByText(confirmLabel)); });
  }
}

beforeEach(() => {
  localStorage.clear();
  probe = { state: null, dispatch: null };
});

describe('every system carries both controls', () => {
  it('the farmer sees a mode selector and a switch per assigned system, starting in AUT', () => {
    const { container } = renderApp('#/farmer/systems', FARMER);
    expect(container.querySelectorAll('[role="switch"]').length).toBe(2); // f1 owns BRD001 and BRD002
    expect(modeAll(container, 'BRD001', 'auto').length).toBe(1);
    expect(modeAll(container, 'BRD001', 'manual').length).toBe(1);

    // AUT by default: the system switches the heater itself, so the switch is
    // not usable and shows the mode rather than a state somebody set.
    expect(modeAll(container, 'BRD001', 'auto')[0].getAttribute('aria-pressed')).toBe('true');
    expect(switchFor(container, 'BRD001').disabled).toBe(true);
    expect(switchFor(container, 'BRD001').textContent).toContain('AUT');
  });

  it('the supervisor sees one of each per system, and a locked one is disabled entirely', () => {
    const { container } = renderApp('#/admin/devices', ADMIN);
    expect(container.querySelectorAll('[role="switch"]').length).toBe(buildSeed().devices.length);

    // Locked = lapsed subscription: the firmware silently drops relay commands,
    // so both controls are refused up front instead of quietly doing nothing.
    expect(switchFor(container, 'BRD006').disabled).toBe(true);
    expect(modeAll(container, 'BRD006', 'manual')[0].disabled).toBe(true);
    expect(modeAll(container, 'BRD006', 'auto')[0].disabled).toBe(true);
    expect(modeAll(container, 'BRD001', 'manual')[0].disabled).toBe(false);
  });
});

describe('AUT: the system switches the heater by itself', () => {
  it('refuses a flip of the switch and records nothing', async () => {
    const { container } = renderApp('#/farmer/systems', FARMER);
    const before = probe.state.audit.length;
    const heating = device('BRD001').heaterOn;

    await act(async () => { fireEvent.click(switchFor(container, 'BRD001')); });
    expect(screen.queryByText(/Switch off Main Farm/i)).toBeNull(); // no dialog: nothing to confirm
    expect(deviceMode(device('BRD001'))).toBe('auto');
    expect(device('BRD001').heaterOn).toBe(heating);
    expect(probe.state.audit.length).toBe(before);
  });

  it('says on the system page that the heater follows the target range', () => {
    const { container } = renderApp('#/farmer/systems/BRD001', FARMER);
    expect(statusOf(container, 'BRD001')).toMatch(/automatically/i);
  });
});

describe('farmer: MAN hands the heater to the operator', () => {
  it('selecting MAN takes the heater over in the state it is already in, and audits it', async () => {
    const { container } = renderApp('#/farmer/systems', FARMER);
    expect(device('BRD001').heaterOn).toBe(true); // it was heating under the thermostat

    await selectMode(container, 'BRD001', 'manual');
    expect(device('BRD001').mode).toBe('manual');
    expect(device('BRD001').systemOn).toBe(true); // held ON, not silently switched off
    expect(device('BRD001').heaterOn).toBe(true);
    expect(modeAll(container, 'BRD001', 'manual')[0].getAttribute('aria-pressed')).toBe('true');
    expect(switchFor(container, 'BRD001').disabled).toBe(false);
    expect(switchFor(container, 'BRD001').textContent).toContain('ON');

    const audit = probe.state.audit[0];
    expect(audit.action).toBe('system.mode');
    expect(audit.details).toContain('MAN');
    expect(audit.user).toBe('Jean Damascene');
    expect(audit.role).toBe('farmer');
  });

  it('OFF asks for confirmation first, then holds the heater off and is audited as relay OFF', async () => {
    const { container } = renderApp('#/farmer/systems', FARMER);
    await selectMode(container, 'BRD001', 'manual');

    await act(async () => { fireEvent.click(switchFor(container, 'BRD001')); });
    expect(screen.getByText(/Switch off Main Farm/i)).toBeTruthy(); // confirmation dialog, still running
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

  it('ON is immediate, holds the heater ON, and leaves the mode alone', async () => {
    const { container } = renderApp('#/farmer/systems', FARMER);
    await selectMode(container, 'BRD001', 'manual');
    await flip(container, 'BRD001', 'Yes, switch off');
    expect(device('BRD001').systemOn).toBe(false);

    await act(async () => { fireEvent.click(switchFor(container, 'BRD001')); }); // no dialog
    expect(screen.queryByText(/Switch off Main Farm/i)).toBeNull();
    expect(device('BRD001').systemOn).toBe(true);
    expect(device('BRD001').heaterOn).toBe(true);
    expect(deviceMode(device('BRD001'))).toBe('manual'); // still MAN
    expect(switchFor(container, 'BRD001').getAttribute('aria-checked')).toBe('true');
    expect(switchFor(container, 'BRD001').textContent).toContain('ON');

    const audit = probe.state.audit[0];
    expect(audit.action).toBe('system.on');
    expect(audit.details).toContain('relay ON');
    expect(audit.details).not.toContain('AUTO');
  });

  it('switching AUT back on hands the heater to the thermostat and locks the switch again', async () => {
    const { container } = renderApp('#/farmer/systems', FARMER);
    await selectMode(container, 'BRD001', 'manual');
    await flip(container, 'BRD001', 'Yes, switch off');
    expect(device('BRD001').systemOn).toBe(false);

    await selectMode(container, 'BRD001', 'auto');
    expect(device('BRD001').mode).toBe('auto');
    expect(device('BRD001').systemOn).toBe(true);
    expect(switchFor(container, 'BRD001').disabled).toBe(true);
    expect(probe.state.audit[0].details).toContain('AUT');
  });

  it('flipping the switch inside a system card never opens that card', async () => {
    const { container } = renderApp('#/farmer/systems', FARMER);
    await selectMode(container, 'BRD001', 'manual');
    await flip(container, 'BRD001', 'Yes, switch off');
    expect(window.location.hash).toBe('#/farmer/systems'); // still the list, not /farmer/systems/BRD001
    expect(screen.getAllByText('My Systems').length).toBeGreaterThan(0);
  });
});

describe('supervisor: the same controls from the admin console', () => {
  it('puts a system in MAN and switches it off from its manage panel, auditing the admin', async () => {
    const { container } = renderApp('#/admin/systems/BRD001', ADMIN);
    expect(switchAll(container, 'BRD001').length).toBe(2); // the fleet row and the manage panel

    await selectMode(container, 'BRD001', 'manual');
    await flip(container, 'BRD001', 'Yes, switch off');

    expect(device('BRD001').mode).toBe('manual');
    expect(device('BRD001').systemOn).toBe(false);
    expect(probe.state.audit[0].action).toBe('system.off');
    expect(probe.state.audit[0].user).toBe('Innocent Ingabire');
    expect(probe.state.audit[0].role).toBe('admin');
  });

  it('does the same straight from the fleet table', async () => {
    const { container } = renderApp('#/admin/devices', ADMIN);
    await selectMode(container, 'BRD003', 'manual');
    await flip(container, 'BRD003', 'Yes, switch off');
    expect(device('BRD003').mode).toBe('manual');
    expect(device('BRD003').systemOn).toBe(false);
    expect(switchFor(container, 'BRD003').getAttribute('aria-checked')).toBe('false');
  });
});

describe('invariants of a manual system', () => {
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

  it('reports a target-band deviation only while the system is holding the band', () => {
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

    // While the system runs itself, the thermostat heats the cold house ...
    await act(async () => { probe.dispatch({ type: 'TICK' }); });
    expect(device('BRD002').heaterOn).toBe(true);

    // ... but once the operator holds it OFF in MAN, the tick must leave it off.
    await selectMode(container, 'BRD002', 'manual');
    await flip(container, 'BRD002', 'Yes, switch off');
    expect(device('BRD002').mode).toBe('manual');
    expect(device('BRD002').systemOn).toBe(false);
    expect(device('BRD002').heaterOn).toBe(false);

    await act(async () => { probe.dispatch({ type: 'TICK' }); });
    expect(device('BRD002').heaterOn).toBe(false);
  });

  it('never touches another system with the same action', async () => {
    const { container } = renderApp('#/farmer/systems', FARMER);
    await selectMode(container, 'BRD001', 'manual');
    await flip(container, 'BRD001', 'Yes, switch off');
    expect(device('BRD001').systemOn).toBe(false);
    expect(deviceMode(device('BRD002'))).toBe('auto'); // untouched neighbour
    expect(device('BRD002').systemOn).not.toBe(false);
    expect(device('BRD002').heaterOn).toBe(true);
  });
});
