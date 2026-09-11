/**
 * AUT / MAN — the control-mode selector, and why it is a control of its own.
 *
 * The switch used to BE the mode: ON sent `relay AUTO`, so a system switched
 * off and switched on again came back under thermostat control, and there was
 * no way at all to say "hold the heater on". These tests pin the two controls
 * apart, at the three levels that matter:
 *
 *   INVARIANT   no flip of the switch ever produces `relay AUTO` unless AUT is
 *               the selection, a legacy device counts as automatic, and a unit
 *               that never answers is never shown as being in the mode the
 *               operator asked for.
 *   BEHAVIOURAL the firmware vocabulary is exact (MAN ON => relay ON, MAN OFF
 *               => relay OFF, AUT => relay AUTO), and what the screens show is
 *               what the unit reports.
 *   FUNCTIONAL  the real component renders both controls, the switch is usable
 *               in MAN only, and selecting MAN survives an OFF/ON round trip —
 *               the exact regression the user reported.
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  POWER_MAX_REASSERTS, deviceMode, liveCommandPlan, modeMatchesIntent, overlayLiveDevice,
  powerMatchesIntent, powerReassertPlan, storeDeviceFromVm, vmMode,
} from '../lib/live.js';
import { apiDeviceToVm } from '../lib/iot.js';

const NOW = '2026-09-11T12:00:00.000Z';
const T0 = Date.parse(NOW);
const at = (ms) => new Date(T0 + ms).toISOString();

/** Verbatim shape of a device_state row from GET /api/devices. */
const row = (patch = {}) => ({
  device_id: 'BROODIINNOX-001', name: 'Damas', farmer_id: 'f1', online: true, last_seen_at: NOW,
  relay_state: true, manual_control: false, day: 3, total_days: 30,
  max_temp: 31, min_temp: 30, ave_temp: 28.5, temp1: 28.5,
  s1_enabled: true, s2_enabled: false, s3_enabled: false, s4_enabled: false,
  failsafe_mode: false, sensor_error: false, mismatch_error: false, device_locked: false,
  signal_quality: 26, error: null, stale: false, ...patch,
});
const vm = (patch = {}) => apiDeviceToVm(row(patch));

/** The store device that unit maps onto. */
const storeDev = (vmPatch = {}, patch = {}) => ({ ...storeDeviceFromVm(vm(vmPatch), NOW), ...patch });

/* ------------------------------------------------------------------ */
/* INVARIANT: a mode exists, and a legacy device is automatic          */
/* ------------------------------------------------------------------ */

describe('INVARIANT: the mode is a property of the device, not of the switch', () => {
  it('reads the mode out of the unit report and the heater out of relay_state', () => {
    expect(storeDev({ manual_control: false, relay_state: true })).toMatchObject({ mode: 'auto', systemOn: true });
    // A thermostat that is idling is still a system running by itself.
    expect(storeDev({ manual_control: false, relay_state: false }).systemOn).toBe(true);
    expect(storeDev({ manual_control: true, relay_state: true })).toMatchObject({ mode: 'manual', systemOn: true });
    expect(storeDev({ manual_control: true, relay_state: false })).toMatchObject({ mode: 'manual', systemOn: false });
  });

  it('treats a device stored before modes existed as automatic', () => {
    expect(deviceMode({ id: 'BRD001' })).toBe('auto');
    expect(deviceMode({ mode: 'auto' })).toBe('auto');
    expect(deviceMode({ mode: 'manual' })).toBe('manual');
    expect(deviceMode(null)).toBe('auto');
    expect(vmMode({})).toBe('auto');
    expect(vmMode({ manual: true })).toBe('manual');
  });

  it('a stale MAN from an old install cannot be read as MAN', () => {
    // Only the exact string means manual: junk in localStorage is automatic,
    // never a mode the operator did not choose.
    for (const junk of ['MANUAL', 'man', 'Manual', 1, true, {}, []]) {
      expect(deviceMode({ mode: junk })).toBe('auto');
    }
  });
});

/* ------------------------------------------------------------------ */
/* BEHAVIOURAL: the firmware vocabulary, exactly                        */
/* ------------------------------------------------------------------ */

describe('BEHAVIOURAL: each selection is exactly one relay payload', () => {
  const live = (patch = {}) => ({
    id: 'BROODIINNOX-001', live: true, mode: 'auto', baseMin: 30, baseMax: 31, sensors: [], ...patch,
  });
  const mock = { id: 'BRD001', live: false, mode: 'auto' };
  const plan = (action, device) => liveCommandPlan(action, device);

  it('AUT => relay AUTO, MAN ON => relay ON, MAN OFF => relay OFF', () => {
    expect(plan({ type: 'SET_SYSTEM_MODE', mode: 'auto' }, live())).toEqual([{ command: 'relay', value: 'AUTO' }]);
    expect(plan({ type: 'SET_SYSTEM_MODE', mode: 'manual', on: true }, live())).toEqual([{ command: 'relay', value: 'ON' }]);
    expect(plan({ type: 'SET_SYSTEM_MODE', mode: 'manual', on: false }, live())).toEqual([{ command: 'relay', value: 'OFF' }]);
    // An unknown heater state never becomes a forced heater ON.
    expect(plan({ type: 'SET_SYSTEM_MODE', mode: 'manual' }, live())).toEqual([{ command: 'relay', value: 'OFF' }]);
    expect(plan({ type: 'SET_SYSTEM_MODE', mode: 'nonsense' }, live())).toEqual([]);
  });

  it('the switch exists inside MAN and nowhere else', () => {
    expect(plan({ type: 'SET_SYSTEM_POWER', on: true }, live({ mode: 'manual' }))).toEqual([{ command: 'relay', value: 'ON' }]);
    expect(plan({ type: 'SET_SYSTEM_POWER', on: false }, live({ mode: 'manual' }))).toEqual([{ command: 'relay', value: 'OFF' }]);
    expect(plan({ type: 'SET_SYSTEM_POWER', on: true }, live())).toEqual([]);
    expect(plan({ type: 'SET_SYSTEM_POWER', on: false }, live())).toEqual([]);
    expect(plan({ type: 'SET_SYSTEM_POWER', on: false }, mock)).toEqual([]);
    expect(plan({ type: 'SET_SYSTEM_MODE', mode: 'manual', on: true }, mock)).toEqual([]);
  });

  it('INVARIANT: an OFF/ON round trip inside MAN never sends AUTO', () => {
    const dev = live({ mode: 'manual' });
    const seq = [false, true, false, true]
      .flatMap((on) => plan({ type: 'SET_SYSTEM_POWER', on }, dev));
    expect(seq.map((c) => c.value)).toEqual(['OFF', 'ON', 'OFF', 'ON']);
    expect(seq.some((c) => c.value === 'AUTO')).toBe(false);
  });

  it('confirmation is read off the hardware, not off the intent', () => {
    expect(modeMatchesIntent('manual', vm({ manual_control: true }))).toBe(true);
    expect(modeMatchesIntent('manual', vm({ manual_control: false }))).toBe(false);
    expect(modeMatchesIntent('auto', vm({ manual_control: false }))).toBe(true);
    expect(modeMatchesIntent(null, vm())).toBe(true); // nothing commanded

    expect(powerMatchesIntent('on', vm({ manual_control: true, relay_state: true }))).toBe(true);
    // The thermostat heating in AUT is not a system somebody is holding on.
    expect(powerMatchesIntent('on', vm({ manual_control: false, relay_state: true }))).toBe(false);
    expect(powerMatchesIntent('off', vm({ manual_control: true, relay_state: false }))).toBe(true);
    expect(powerMatchesIntent('off', vm({ manual_control: true, relay_state: true }))).toBe(false);
    expect(powerMatchesIntent('off', vm({ manual_control: false, relay_state: false }))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* BEHAVIOURAL: what the screens show while the unit catches up        */
/* ------------------------------------------------------------------ */

describe('BEHAVIOURAL: the selection is shown while it stands, the unit once it lands', () => {
  const manualOff = (patch = {}) => storeDev({ manual_control: false, relay_state: true }, {
    mode: 'manual', modeIntent: 'manual', modeIntentAt: at(0),
    powerIntent: 'off', powerIntentAt: at(0), ...patch,
  });

  it('shows MAN + OFF immediately, and keeps them while the unit has not applied them', () => {
    const out = overlayLiveDevice(manualOff(), vm({ manual_control: false, relay_state: true }), at(5000));
    expect(out.mode).toBe('manual');
    expect(out.modePending).toBe(true);
    expect(out.modeUnconfirmed).toBe(false);
    expect(out.systemOn).toBe(false);
    expect(out.powerPending).toBe(true);
  });

  it('reads the unit back the moment it applies them', () => {
    const out = overlayLiveDevice(manualOff(), vm({ manual_control: true, relay_state: false }), at(3000));
    expect(out.mode).toBe('manual');
    expect(out.modeConfirmed).toBe(true);
    expect(out.modePending).toBe(false);
    expect(out.systemOn).toBe(false);
    expect(out.powerConfirmed).toBe(true);
  });

  it('never claims a mode the unit refused to enter: the hardware wins after the grace window', () => {
    const out = overlayLiveDevice(manualOff(), vm({ manual_control: false, relay_state: true }), at(25000));
    expect(out.modeUnconfirmed).toBe(true);
    expect(out.mode).toBe('auto');
    expect(out.modePending).toBe(false);
    expect(out.powerIntent).toBeNull();
    expect(out.systemOn).toBe(true);
  });

  it('a manual heater command is meaningless in AUT, so it is never shown there', () => {
    const out = overlayLiveDevice(
      storeDev({ manual_control: false }, { mode: 'auto', modeIntent: 'auto', modeIntentAt: at(0), powerIntent: 'on', powerIntentAt: at(0) }),
      vm({ manual_control: false }),
      at(1000)
    );
    expect(out.mode).toBe('auto');
    expect(out.powerIntent).toBeNull();
    expect(out.systemOn).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* BEHAVIOURAL: a reboot cannot silently change the selected mode      */
/* ------------------------------------------------------------------ */

describe('BEHAVIOURAL: the selection survives a reboot, throttled and capped', () => {
  const dev = (patch = {}) => ({
    id: 'BROODIINNOX-001', live: true, name: 'Damas', baseMin: 30, baseMax: 31, sensors: [],
    lastSeen: at(0), manualLock: false,
    subscription: { planId: 'p1', status: 'active', endDate: '2027-01-01T00:00:00.000Z' },
    mode: 'manual', modeIntent: 'manual', modeIntentAt: at(0),
    powerIntent: 'off', powerIntentAt: at(0), ...patch,
  });
  const dropped = vm({ manual_control: false, relay_state: true }); // rebooted into AUT
  const heldOn = vm({ manual_control: true, relay_state: true });
  const heldOff = vm({ manual_control: true, relay_state: false });

  it('re-enters MAN with the chosen heater state', () => {
    expect(powerReassertPlan(dev(), dropped, at(5000))).toBeNull();  // inside the grace window
    expect(powerReassertPlan(dev(), dropped, at(35000))).toEqual({ command: 'relay', value: 'OFF' });
    expect(powerReassertPlan(dev({ powerIntent: 'on' }), dropped, at(35000))).toEqual({ command: 'relay', value: 'ON' });
    // Nothing to re-send while the unit agrees.
    expect(powerReassertPlan(dev(), heldOff, at(35000))).toBeNull();
  });

  it('holds the heater again inside MAN if the unit moved it', () => {
    expect(powerReassertPlan(dev(), heldOn, at(35000))).toEqual({ command: 'relay', value: 'OFF' });
    expect(powerReassertPlan(dev({ powerIntent: 'on' }), heldOff, at(35000))).toEqual({ command: 'relay', value: 'ON' });
  });

  it('hands the heater back to the thermostat when AUT was selected', () => {
    const auto = dev({ mode: 'auto', modeIntent: 'auto' });
    expect(powerReassertPlan(auto, heldOn, at(35000))).toEqual({ command: 'relay', value: 'AUTO' });
    expect(powerReassertPlan(auto, dropped, at(35000))).toBeNull();
  });

  it('is throttled to one attempt per interval, capped, and silent to a dead unit', () => {
    expect(powerReassertPlan(dev({ powerRetryAt: at(30000) }), dropped, at(45000))).toBeNull();
    expect(powerReassertPlan(dev({ powerRetryAt: at(30000) }), dropped, at(70000))).toEqual({ command: 'relay', value: 'OFF' });
    expect(powerReassertPlan(dev({ powerRetries: POWER_MAX_REASSERTS, powerRetryAt: at(30000) }), dropped, at(600000))).toBeNull();
    expect(powerReassertPlan(dev({ manualLock: true }), dropped, at(35000))).toBeNull();
    expect(powerReassertPlan(dev({ lastSeen: at(-600000) }), dropped, at(35000))).toBeNull();
    expect(powerReassertPlan(dev({ live: false }), dropped, at(35000))).toBeNull();
    expect(powerReassertPlan(null, dropped, at(35000))).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* FUNCTIONAL: the component and the store together                    */
/* ------------------------------------------------------------------ */

const KEY = 'broodiinnox_app_v1';
const FARMER = { id: 'f1', name: 'Jean Damascene', role: 'farmer', phone: '0788123456' };

describe('FUNCTIONAL: the selector and the switch on a real page', () => {
  let StoreProvider;
  let useStore;
  let buildSeed;
  let PowerSwitch;
  let probe = { state: null, dispatch: null };

  function Probe() {
    const { state, dispatch } = useStore();
    probe = { state, dispatch };
    return null;
  }

  function Fleet() {
    const { state } = useStore();
    return (
      <div>
        {state.devices.map((d) => <PowerSwitch key={d.id} device={d} lang="en" showHint />)}
      </div>
    );
  }

  const device = () => probe.state.devices.find((d) => d.id === 'BRD001');
  const switchEl = () => document.querySelector('[data-device-id="BRD001"]');
  const modeButton = (mode) => document.querySelector(`[data-mode-device-id="BRD001"][data-mode="${mode}"]`);
  const statusEl = () => switchEl().closest('.power-switch-wrap').querySelector('.power-switch-status');

  beforeEach(async () => {
    localStorage.clear();
    probe = { state: null, dispatch: null };
    // Simulation mode: no VITE_IOT_API_URL, so the seeded fleet is local state
    // and the store applies the selection without a unit in the loop.
    const store = await import('../lib/store.jsx');
    const seed = await import('../lib/seed.js');
    StoreProvider = store.StoreProvider;
    useStore = store.useStore;
    buildSeed = seed.buildSeed;
    PowerSwitch = (await import('../components/PowerSwitch.jsx')).PowerSwitch;
    localStorage.setItem(KEY, JSON.stringify({ ...buildSeed(), session: FARMER, reminderSent: [] }));
  });

  it('renders both controls, and reads AUT until MAN is chosen', async () => {
    render(<StoreProvider><Probe /><Fleet /></StoreProvider>);
    expect(modeButton('auto')).toBeTruthy();
    expect(modeButton('manual')).toBeTruthy();
    expect(modeButton('auto').getAttribute('aria-pressed')).toBe('true');
    expect(modeButton('manual').getAttribute('aria-pressed')).toBe('false');

    // AUT: the system switches the heater itself, so the switch is not usable.
    expect(switchEl().disabled).toBe(true);
    expect(switchEl().textContent).toContain('AUT');
    expect(statusEl().textContent).toMatch(/automatically/i);

    // ... and clicking it changes nothing at all.
    const audits = probe.state.audit.length;
    await act(async () => { fireEvent.click(switchEl()); });
    expect(device().systemOn).not.toBe(false);
    expect(probe.state.audit.length).toBe(audits);
  });

  it('INVARIANT: MAN survives an OFF/ON round trip (the reported bug)', async () => {
    render(<StoreProvider><Probe /><Fleet /></StoreProvider>);

    await act(async () => { fireEvent.click(modeButton('manual')); });
    expect(device().mode).toBe('manual');
    expect(device().systemOn).toBe(true); // BRD001 was heating: MAN takes it over as-is
    expect(probe.state.audit[0].action).toBe('system.mode');
    expect(probe.state.audit[0].details).toMatch(/MAN/);
    expect(switchEl().disabled).toBe(false);
    expect(switchEl().textContent).toContain('ON');

    await act(async () => { fireEvent.click(switchEl()); });
    await act(async () => { fireEvent.click(screen.getByText('Yes, switch off')); });
    expect(device().systemOn).toBe(false);
    expect(device().heaterOn).toBe(false);
    expect(device().mode).toBe('manual');
    expect(probe.state.audit[0].details).toMatch(/relay OFF/);

    await act(async () => { fireEvent.click(switchEl()); });
    expect(device().systemOn).toBe(true);
    expect(device().mode).toBe('manual'); // still MAN — this is the fix
    expect(device().heaterOn).toBe(true);
    expect(probe.state.audit[0].details).toMatch(/relay ON/);

    // Nothing in the whole session ever mentioned relay AUTO.
    expect(probe.state.audit.some((a) => /relay AUTO/.test(a.details))).toBe(false);
  });

  it('AUT hands the heater back to the thermostat and disables the switch again', async () => {
    render(<StoreProvider><Probe /><Fleet /></StoreProvider>);
    await act(async () => { fireEvent.click(modeButton('manual')); });
    await act(async () => { fireEvent.click(switchEl()); });
    await act(async () => { fireEvent.click(screen.getByText('Yes, switch off')); });
    expect(device().systemOn).toBe(false);

    await act(async () => { fireEvent.click(modeButton('auto')); });
    expect(device().mode).toBe('auto');
    expect(device().systemOn).toBe(true); // the thermostat owns the heater again
    expect(probe.state.audit[0].details).toMatch(/AUT/);
    expect(switchEl().disabled).toBe(true);

    await act(async () => { fireEvent.click(switchEl()); });
    expect(device().systemOn).toBe(true); // refused, not silently obeyed
  });

  it('MAN OFF holds in the simulation tick however cold it gets', async () => {
    // A freezing house: under AUT the tick would bring the heater on.
    const seed = JSON.parse(JSON.stringify(buildSeed()));
    seed.devices = seed.devices.map((d) => (d.id === 'BRD001'
      ? { ...d, sensors: d.sensors.map((s) => ({ ...s, lastReading: 24 })) }
      : d));
    localStorage.setItem(KEY, JSON.stringify({ ...seed, session: FARMER, reminderSent: [] }));

    render(<StoreProvider><Probe /><Fleet /></StoreProvider>);
    await act(async () => { probe.dispatch({ type: 'TICK' }); });
    expect(device().heaterOn).toBe(true); // the thermostat heats a cold house

    await act(async () => { fireEvent.click(modeButton('manual')); });
    await act(async () => { fireEvent.click(switchEl()); });
    await act(async () => { fireEvent.click(screen.getByText('Yes, switch off')); });
    expect(device().heaterOn).toBe(false);

    await act(async () => { probe.dispatch({ type: 'TICK' }); });
    expect(device().mode).toBe('manual');
    expect(device().systemOn).toBe(false);
    expect(device().heaterOn).toBe(false); // held off, thermostat or not
  });

  it('a locked system can neither change mode nor be switched', async () => {
    render(<StoreProvider><Probe /><Fleet /></StoreProvider>);
    await act(async () => { probe.dispatch({ type: 'LOCK_DEVICE', deviceId: 'BRD001', lock: true }); });
    expect(modeButton('manual').disabled).toBe(true);
    expect(modeButton('auto').disabled).toBe(true);
    expect(switchEl().disabled).toBe(true);
    await act(async () => { fireEvent.click(modeButton('manual')); });
    expect(deviceMode(device())).toBe('auto');
  });

  /*
   * The placement the user asked for: Mode at the RIGHT of the System (ON/OFF)
   * button, on EVERY system in the fleet — not on one card.
   */
  it('INVARIANT: Mode (AUT/MAN) sits beside the System switch on every system', () => {
    render(<StoreProvider><Probe /><Fleet /></StoreProvider>);
    const devices = probe.state.devices;
    expect(devices.length).toBeGreaterThan(1); // the property is not vacuous

    const follows = (a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

    for (const d of devices) {
      const sw = document.querySelector(`[data-device-id="${d.id}"]`);
      const auto = document.querySelector(`[data-mode-device-id="${d.id}"][data-mode="auto"]`);
      const man = document.querySelector(`[data-mode-device-id="${d.id}"][data-mode="manual"]`);
      expect(sw && auto && man, `${d.id} is missing one of its controls`).toBeTruthy();

      // one row holds both controls ...
      const row = sw.closest('.power-controls');
      expect(row, `${d.id} renders no control row`).toBeTruthy();
      expect(auto.closest('.power-controls')).toBe(row);
      expect(man.closest('.power-controls')).toBe(row);

      // ... the switch comes FIRST, so the Mode button is to its right ...
      expect(row.firstElementChild.contains(sw), `${d.id}: the switch is not the left-hand control`).toBe(true);
      expect(follows(sw, auto), `${d.id}: AUT is not to the right of the switch`).toBe(true);
      expect(follows(sw, man), `${d.id}: MAN is not to the right of the switch`).toBe(true);

      // ... and that row is inside the card, above the status text.
      expect(row.parentElement.classList.contains('power-switch-wrap')).toBe(true);
      const status = row.parentElement.querySelector('.power-switch-status');
      if (status) expect(follows(row, status), `${d.id}: the status text is not below the controls`).toBe(true);
    }
  });

  it('the row styling is a row: jsdom does no layout, so this is what keeps them side by side', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8');
    const rule = /\.power-controls\s*\{([^}]*)\}/.exec(css);
    expect(rule, '.power-controls has no styling').toBeTruthy();
    expect(rule[1]).toMatch(/display:\s*flex/);
    expect(rule[1]).not.toMatch(/flex-direction:\s*column/);
  });
});
