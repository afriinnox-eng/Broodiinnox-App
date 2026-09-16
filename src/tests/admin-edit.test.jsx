/**
 * Correcting a record after it exists.
 *
 * A farmer used to be write-once: registered with a name, a phone number and a
 * district, and from then on the console could only deactivate them or reset a
 * password. A system was the same — assigned at registration and never moved.
 * That is wrong for the ordinary course of business: people change phone
 * numbers, move, sell a unit, or buy a second one.
 *
 * What has to hold for EVERY such edit is not "the field changed":
 *
 *   1. ONE FARMER PER SIGN-IN IDENTIFIER. The phone number and the email address
 *      ARE the login — auth.js signs someone in by matching exactly them — so two
 *      farmers must never hold one. The second to type it would open the first
 *      one's account, or nobody's.
 *   2. AN EDIT CANNOT BREAK THE RECORDS THAT POINT AT IT. Devices, payments,
 *      tickets and notifications hold `farmerId`; a device's id IS its serial,
 *      which broodiinnox-api keys the hardware on. Neither is editable.
 *   3. "NOBODY" IS AN ANSWER, and it has to survive the live poll. A system taken
 *      off a farmer carries `farmerId: null`, and without a record of the
 *      console's decision the next poll of the API would put the old farmer
 *      straight back on — an Unassign that appears to do nothing.
 *   4. EVERY CHANGE IS AUDITED, by field, with what it was before.
 */
import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import App from '../App.jsx';
import { StoreProvider, useStore } from '../lib/store.jsx';
import { deviceDetailIssues, farmerDetailIssues } from '../lib/services.js';
import { overlayLiveDevice } from '../lib/live.js';
import { DEVICES as DEMO_DEVICES, FARMERS as DEMO_FARMERS, buildDemoSeed } from './fixtures/demoFleet.js';

const KEY = 'broodiinnox_app_v1';
const ADMIN_SESSION = { id: 'a1', name: 'Afriinnox', role: 'admin', adminRole: 'super', email: 'afriinnox@gmail.com' };
const NOW = new Date().toISOString();

let probe = { state: null, dispatch: null };

function Probe() {
  const { state, dispatch } = useStore();
  probe = { state, dispatch };
  return null;
}

/** The store, mounted on the demonstration fleet, with the console signed in. */
function mountFleet(session = ADMIN_SESSION) {
  localStorage.clear();
  localStorage.setItem(KEY, JSON.stringify({ ...buildDemoSeed(), session, lang: 'en', reminderSent: [] }));
  probe = { state: null, dispatch: null };
  render(<StoreProvider><Probe /></StoreProvider>);
  return probe;
}

/** The whole app at a route, on the demonstration fleet. */
function open(route, session = ADMIN_SESSION) {
  localStorage.clear();
  localStorage.setItem(KEY, JSON.stringify({ ...buildDemoSeed(), session, lang: 'en', reminderSent: [] }));
  probe = { state: null, dispatch: null };
  return render(
    <MemoryRouter initialEntries={[route]}>
      <StoreProvider><Probe /><App /></StoreProvider>
    </MemoryRouter>
  );
}

/** A live API row for a device, as broodiinnox-api reports it. */
const vmFor = (id, farmerId, patch = {}) => ({
  id, name: id, farmerId, online: true, locked: false, sensorError: false, mismatchError: false,
  minTemp: 35, maxTemp: 37, day: 3, totalDays: 30, heaterOn: false, manual: false,
  sensors: [{ id: 1, enabled: true, lastReading: 27.6, health: 'ok' }],
  lastSeenAt: NOW, ...patch,
});

/** The control a person would click: a button, or a sidebar link of that name. */
const button = (root, label) => {
  const wanted = new RegExp(label, 'i');
  const found = [...root.querySelectorAll('button')].find((b) => wanted.test(b.textContent))
    || [...root.querySelectorAll('a')].find((a) => wanted.test(a.textContent));
  if (!found) throw new Error(`nothing to click matching ${label}`);
  return found;
};

beforeEach(() => {
  localStorage.clear();
  probe = { state: null, dispatch: null };
});

/* ------------------------------------------------------------------ */
/* 1. INVARIANT: one farmer per sign-in identifier                     */
/* ------------------------------------------------------------------ */

describe('INVARIANT: one farmer per sign-in identifier', () => {
  const jean = DEMO_FARMERS[0];     // f1 — 0788123456 · jean@farm.rw
  const clarisse = DEMO_FARMERS[1]; // f2 — 0788222333 · clarisse@farm.rw
  const others = [clarisse];

  it('accepts every shape of the same number, because auth.js does', () => {
    // the five ways a Rwandan number gets written are ONE identifier (auth.js
    // phoneKey), so all of them must pass for the farmer who owns that number
    for (const phone of ['0788123456', '0788 123 456', '0788-123-456', '+250788123456', '250788123456']) {
      expect(farmerDetailIssues({ patch: { name: 'Jean', phone, email: '' }, farmers: others }), phone).toEqual({});
    }
  });

  it('refuses a number another farmer already signs in with, however it is typed', () => {
    for (const phone of ['0788222333', '0788 222 333', '0788-222-333', '+250788222333', '250788222333']) {
      const issues = farmerDetailIssues({ patch: { name: 'Jean', phone, email: '' }, farmers: others });
      expect(issues.phone, phone).toMatch(/already signs in another account/);
    }
  });

  it('treats an email address as one address whatever its case or padding', () => {
    for (const email of ['CLARISSE@FARM.RW', '  Clarisse@Farm.RW  ', 'clarisse@farm.rw']) {
      const issues = farmerDetailIssues({ patch: { name: 'Jean', phone: '', email }, farmers: others });
      expect(issues.email, email).toMatch(/already signs in another account/);
    }
    // and the address is not magic when it belongs to nobody
    expect(farmerDetailIssues({ patch: { name: 'Jean', phone: '', email: 'nobody@farm.rw' }, farmers: others })).toEqual({});
  });

  it('never collides with the farmer being edited', () => {
    // their own unchanged details must not read as "someone else has them"
    expect(farmerDetailIssues({ patch: { name: jean.name, phone: jean.phone, email: jean.email }, farmers: DEMO_FARMERS, selfId: jean.id })).toEqual({});
    // including when the number is typed in another of its shapes
    expect(farmerDetailIssues({ patch: { name: jean.name, phone: '+250788123456', email: '' }, farmers: DEMO_FARMERS, selfId: jean.id })).toEqual({});
  });

  it('requires a name that is not blank', () => {
    for (const name of ['', '   ', '\t']) {
      expect(farmerDetailIssues({ patch: { name, phone: jean.phone, email: '' } }).name).toMatch(/needs a name/);
    }
  });

  it('requires a phone number that is a Rwandan mobile, or none at all', () => {
    expect(farmerDetailIssues({ patch: { name: 'Jean', phone: '12345', email: '' } }).phone).toMatch(/Rwandan mobile/);
    expect(farmerDetailIssues({ patch: { name: 'Jean', phone: '0788123456', email: '' } }).phone).toBeUndefined();
    // no phone at all is fine while an email address carries the login
    expect(farmerDetailIssues({ patch: { name: 'Jean', phone: '', email: 'jean@farm.rw' } })).toEqual({});
  });

  it('refuses a value that is not an address', () => {
    for (const email of ['jean', 'jean@', '@farm.rw', 'jean@farm', 'a b@farm.rw']) {
      const issues = farmerDetailIssues({ patch: { name: 'Jean', phone: '', email } });
      expect(issues.email, email).toMatch(/not an email address/);
    }
  });

  it('will not let both identifiers be cleared away', () => {
    // whichever way it is typed, a farmer with neither could never sign in again
    expect(farmerDetailIssues({ patch: { name: 'Jean', phone: '', email: '' } }).identifier).toMatch(/how they sign in/);
    expect(farmerDetailIssues({ patch: { name: 'Jean', phone: '   ', email: '   ' } }).identifier).toMatch(/how they sign in/);
  });

  it('is a pure function: it changes neither the patch nor the farmer list', () => {
    const patch = { name: 'Jean', phone: '0788222333', email: 'x@y.rw' };
    const farmers = DEMO_FARMERS.map((f) => ({ ...f }));
    const before = JSON.stringify({ patch, farmers });
    farmerDetailIssues({ patch, farmers, selfId: 'f1' });
    expect(JSON.stringify({ patch, farmers })).toBe(before);
  });
});

describe('INVARIANT: a system always has a name and a district', () => {
  it('accepts usable details', () => {
    expect(deviceDetailIssues({ patch: { name: 'Main Farm', location: { district: 'Kigali' } } })).toEqual({});
  });

  it('refuses a blank name or district, and treats a placeholder as blank', () => {
    expect(deviceDetailIssues({ patch: { name: '', location: { district: 'Kigali' } } }).name).toMatch(/needs a name/);
    expect(deviceDetailIssues({ patch: { name: '   ', location: { district: 'Kigali' } } }).name).toMatch(/needs a name/);
    for (const district of ['', '   ', '—']) {
      expect(deviceDetailIssues({ patch: { name: 'Main Farm', location: { district } } }).district, JSON.stringify(district)).toMatch(/district is required/);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 2. INVARIANT: an edit cannot break what points at it                */
/* ------------------------------------------------------------------ */

describe('INVARIANT: an edit cannot break the records that point at it', () => {
  it('UPDATE_FARMER cannot change the id or the creation date', async () => {
    mountFleet();
    const before = probe.state.farmers.find((f) => f.id === 'f1');
    const others = probe.state.devices.filter((d) => d.farmerId === 'f1').map((d) => d.id);
    expect(others.length, 'the fixture has systems assigned to f1').toBeGreaterThan(0);

    await act(async () => {
      probe.dispatch({ type: 'UPDATE_FARMER', id: 'f1', patch: { id: 'f1-renamed', createdAt: '1999-01-01T00:00:00.000Z', district: 'Musanze' } });
    });

    const after = probe.state.farmers.find((f) => f.id === 'f1');
    expect(after, 'the farmer kept their id, so nothing else was orphaned').toBeTruthy();
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.district).toBe('Musanze');
    for (const id of others) {
      expect(probe.state.devices.find((d) => d.id === id).farmerId, `${id} lost its owner`).toBe('f1');
    }
  });

  it('audits exactly the fields that changed, and writes nothing for a no-op', async () => {
    mountFleet();
    const auditBefore = probe.state.audit.length;
    const jean = probe.state.farmers.find((f) => f.id === 'f1');

    await act(async () => {
      probe.dispatch({ type: 'UPDATE_FARMER', id: 'f1', patch: { district: 'Musanze' } });
    });
    const entry = probe.state.audit[0];
    expect(probe.state.audit.length).toBe(auditBefore + 1);
    expect(entry.action).toBe('farmer.update');
    expect(entry.prev).toEqual({ district: jean.district });
    expect(entry.next).toEqual({ district: 'Musanze' });
    expect(entry.details).toContain('district');

    // the same value again is not a change, so it is not an audit line either
    await act(async () => {
      probe.dispatch({ type: 'UPDATE_FARMER', id: 'f1', patch: { district: 'Musanze' } });
    });
    expect(probe.state.audit.length).toBe(auditBefore + 1);
  });

  it('UPDATE_DEVICE cannot change the serial, which is the hardware identity', async () => {
    mountFleet();
    await act(async () => {
      probe.dispatch({ type: 'UPDATE_DEVICE', deviceId: 'BRD001', patch: { serial: 'BRD999', id: 'BRD999', name: 'Renamed', location: { district: 'Huye' } } });
    });
    const device = probe.state.devices.find((d) => d.id === 'BRD001');
    expect(device, 'the device is still found by its serial, which the API keys on').toBeTruthy();
    expect(device.serial).toBe('BRD001');
    expect(device.name).toBe('Renamed');
    expect(device.location.district).toBe('Huye');
    // the rest of the location is merged, not thrown away
    expect(typeof device.location.lat).toBe('number');
    expect(probe.state.devices.find((d) => d.id === 'BRD999')).toBeUndefined();
  });

  it('an unassigned system is owned by nobody, in a shape the app can tell from "never said"', async () => {
    mountFleet();
    expect(probe.state.devices.find((d) => d.id === 'BRD001').farmerId).toBe('f1');

    await act(async () => {
      probe.dispatch({ type: 'ASSIGN_DEVICE', deviceId: 'BRD001', farmerId: null });
    });

    const device = probe.state.devices.find((d) => d.id === 'BRD001');
    expect(device.farmerId).toBeNull();
    expect(device.farmerId, 'null, never undefined — live.js reads the difference').not.toBeUndefined();
    expect(device.farmerSetLocally, 'the console said so, and that is remembered').toBe(true);
    expect(device.subscription, 'the unit keeps everything else it had').toEqual(DEMO_DEVICES.find((d) => d.id === 'BRD001').subscription);

    const entry = probe.state.audit[0];
    expect(entry.action).toBe('device.unassign');
    expect(entry.prev).toEqual({ farmerId: 'f1' });
    expect(entry.next).toEqual({ farmerId: null });
    expect(entry.details).toContain('Jean Damascene');
  });

  it('a move names both farmers, and every owner a system has ever had exists', async () => {
    mountFleet();
    await act(async () => {
      probe.dispatch({ type: 'ASSIGN_DEVICE', deviceId: 'BRD001', farmerId: 'f3' });
    });
    const entry = probe.state.audit[0];
    expect(entry.action).toBe('device.assign');
    expect(entry.details).toContain('Eric Niyonsaba');
    expect(entry.details).toContain('Jean Damascene'); // who it came from
    expect(probe.state.devices.find((d) => d.id === 'BRD001').farmerId).toBe('f3');

    // the invariant itself, over the whole fleet, after any number of moves
    await act(async () => {
      probe.dispatch({ type: 'ASSIGN_DEVICE', deviceId: 'BRD002', farmerId: null });
      probe.dispatch({ type: 'ASSIGN_DEVICE', deviceId: 'BRD003', farmerId: 'f4' });
      probe.dispatch({ type: 'ASSIGN_DEVICE', deviceId: 'BRD008', farmerId: 'f5' });
    });
    for (const d of probe.state.devices) {
      if (d.farmerId === null) continue;
      expect(probe.state.farmers.map((f) => f.id), `${d.id} points at a farmer who does not exist`).toContain(d.farmerId);
    }
  });

  it('moving a system does not touch what was already recorded about it', async () => {
    mountFleet();
    const payments = probe.state.payments.length;
    const tickets = probe.state.tickets.length;
    const alerts = probe.state.alerts.length;
    const reading = JSON.stringify(probe.state.devices.find((d) => d.id === 'BRD001').sensors);

    await act(async () => {
      probe.dispatch({ type: 'ASSIGN_DEVICE', deviceId: 'BRD001', farmerId: 'f4' });
    });

    expect(probe.state.payments).toHaveLength(payments);
    expect(probe.state.tickets).toHaveLength(tickets);
    expect(probe.state.alerts).toHaveLength(alerts);
    expect(JSON.stringify(probe.state.devices.find((d) => d.id === 'BRD001').sensors), 'telemetry is not an edit').toBe(reading);
  });
});

/* ------------------------------------------------------------------ */
/* 3. INVARIANT: the live poll cannot undo the console                 */
/* ------------------------------------------------------------------ */

describe('INVARIANT: the live poll cannot undo what the console decided', () => {
  it('keeps an unassigned system unassigned, even though the API still names the farmer', async () => {
    mountFleet();
    await act(async () => {
      probe.dispatch({ type: 'ASSIGN_DEVICE', deviceId: 'BRD001', farmerId: null });
    });
    const mine = probe.state.devices.find((d) => d.id === 'BRD001');
    // the API's registration row still holds f1 — this is the exact poll that
    // used to put the farmer back on the device
    const polled = overlayLiveDevice(mine, vmFor('BRD001', 'f1'), NOW);
    expect(polled.farmerId).toBeNull();
  });

  it('keeps a moved system on the farmer the console chose', async () => {
    mountFleet();
    await act(async () => {
      probe.dispatch({ type: 'ASSIGN_DEVICE', deviceId: 'BRD001', farmerId: 'f3' });
    });
    const mine = probe.state.devices.find((d) => d.id === 'BRD001');
    expect(overlayLiveDevice(mine, vmFor('BRD001', 'f1'), NOW).farmerId).toBe('f3');
  });

  it('but a device the console never assigned still learns its owner from the API', () => {
    // the flag is about what the console decided, not about overriding the API
    const plain = { ...DEMO_DEVICES[0], farmerId: null };
    delete plain.farmerSetLocally;
    expect(overlayLiveDevice(plain, vmFor('BRD001', 'f2'), NOW).farmerId).toBe('f2');
  });

  it('and a rename or a location the console set is not reverted either', () => {
    const mine = { ...DEMO_DEVICES[0], name: 'Coop A', location: { district: 'Musanze', sector: 'Busogo', lat: 1, lng: 2 } };
    const polled = overlayLiveDevice(mine, vmFor('BRD001', 'f1'), NOW);
    expect(polled.name).toBe('Coop A');
    expect(polled.location.district).toBe('Musanze');
  });
});

/* ------------------------------------------------------------------ */
/* 4. BEHAVIOURAL: the console a person actually clicks                */
/* ------------------------------------------------------------------ */

describe('BEHAVIOURAL: the console edits a farmer', () => {
  it('changes the name, the phone and the location, and the page reads them back', async () => {
    const { container } = open('/admin/farmers/f1');
    await waitFor(() => expect(container.textContent).toContain('Jean Damascene'));

    fireEvent.click(button(container, 'Edit details'));
    const fields = [...container.querySelectorAll('.modal input')];
    expect(fields, 'name, phone, email, district, sector').toHaveLength(5);
    fireEvent.change(fields[0], { target: { value: 'Jean D. Habimana' } });
    fireEvent.change(fields[1], { target: { value: '0788999000' } });
    fireEvent.change(fields[3], { target: { value: 'Musanze' } });
    fireEvent.change(fields[4], { target: { value: 'Busogo' } });
    fireEvent.click(button(container, 'Save details'));

    const farmer = probe.state.farmers.find((f) => f.id === 'f1');
    expect(farmer.name).toBe('Jean D. Habimana');
    expect(farmer.phone).toBe('0788999000');
    expect(farmer.district).toBe('Musanze');
    expect(farmer.sector).toBe('Busogo');
    expect(probe.state.audit[0].action).toBe('farmer.update');
    expect(container.textContent).toContain('Musanze, Busogo');
    expect(container.querySelector('.modal'), 'the form closes on a saved edit').toBeNull();
  });

  it('refuses a phone number that already signs in another farmer, and writes nothing', async () => {
    const { container } = open('/admin/farmers/f1');
    await waitFor(() => expect(container.textContent).toContain('Jean Damascene'));
    const auditBefore = probe.state.audit.length;

    fireEvent.click(button(container, 'Edit details'));
    const fields = [...container.querySelectorAll('.modal input')];
    // Clarisse's number, typed in one of the other shapes auth.js accepts
    fireEvent.change(fields[1], { target: { value: '+250 788 222 333' } });
    fireEvent.click(button(container, 'Save details'));

    const alert = container.querySelector('[role="alert"]');
    expect(alert, 'the console says why instead of silently doing nothing').not.toBeNull();
    expect(alert.textContent).toMatch(/already signs in another account/i);
    expect(probe.state.farmers.find((f) => f.id === 'f1').phone, 'nothing was written').toBe('0788123456');
    expect(probe.state.audit).toHaveLength(auditBefore);
    expect(container.querySelector('.modal'), 'the form stays open so it can be corrected').not.toBeNull();
  });

  it('refuses to wipe out the last way this farmer can sign in', async () => {
    const { container } = open('/admin/farmers/f1');
    await waitFor(() => expect(container.textContent).toContain('Jean Damascene'));

    fireEvent.click(button(container, 'Edit details'));
    const fields = [...container.querySelectorAll('.modal input')];
    fireEvent.change(fields[1], { target: { value: '' } }); // phone
    fireEvent.change(fields[2], { target: { value: '' } }); // email
    fireEvent.click(button(container, 'Save details'));

    expect(container.querySelector('[role="alert"]').textContent).toMatch(/how they sign in/i);
    const farmer = probe.state.farmers.find((f) => f.id === 'f1');
    expect(farmer.phone).toBe('0788123456');
    expect(farmer.email).toBe('jean@farm.rw');
  });
});

describe('BEHAVIOURAL: the console takes a system off a farmer', () => {
  it('confirms first, then the system is owned by nobody and the card shows the gap', async () => {
    const { container } = open('/admin/farmers/f1');
    await waitFor(() => expect(container.textContent).toContain('Systems (2)'));
    expect(container.textContent).toContain('BRD001');

    fireEvent.click(button(container, 'Remove from farmer'));
    expect(container.textContent, 'the confirmation names what is being removed').toContain('Remove BRD001 from Jean Damascene?');
    // and nothing has happened yet
    expect(probe.state.devices.find((d) => d.id === 'BRD001').farmerId).toBe('f1');

    fireEvent.click(button(container, 'Remove it'));

    expect(probe.state.devices.find((d) => d.id === 'BRD001').farmerId).toBeNull();
    expect(probe.state.audit[0].action).toBe('device.unassign');
    await waitFor(() => expect(container.textContent).toContain('Systems (1)'));
    expect(container.textContent).not.toContain('BRD001');
    // the other system is untouched, and so is the unit itself
    expect(probe.state.devices.find((d) => d.id === 'BRD002').farmerId).toBe('f1');
    expect(probe.state.devices).toHaveLength(DEMO_DEVICES.length);
  });

  it('can keep it instead, which changes nothing', async () => {
    const { container } = open('/admin/farmers/f1');
    await waitFor(() => expect(container.textContent).toContain('Systems (2)'));
    fireEvent.click(button(container, 'Remove from farmer'));
    fireEvent.click(button(container, 'Keep it'));
    expect(probe.state.devices.find((d) => d.id === 'BRD001').farmerId).toBe('f1');
    expect(container.textContent).toContain('Systems (2)');
  });

  it('gives it straight to another farmer from the same card', async () => {
    const { container } = open('/admin/farmers/f1');
    await waitFor(() => expect(container.textContent).toContain('Systems (2)'));

    const owner = container.querySelector('#owner-BRD001');
    expect(owner, 'every system on the card has an owner control').not.toBeNull();
    // every farmer is on offer, plus "nobody"
    expect([...owner.options].map((o) => o.value)).toEqual(['', ...probe.state.farmers.map((f) => f.id)]);
    fireEvent.change(owner, { target: { value: 'f3' } });

    expect(probe.state.devices.find((d) => d.id === 'BRD001').farmerId).toBe('f3');
    expect(probe.state.audit[0].details).toContain('Eric Niyonsaba');
    expect(container.textContent).toContain('Systems (1)'); // it left this farmer's card
  });
});

describe('BEHAVIOURAL: the console edits a system', () => {
  it('changes who owns it, from the system\'s own page', async () => {
    const { container } = open('/admin/systems/BRD001');
    await waitFor(() => expect(container.querySelector('[aria-label="Owner of BRD001"]')).not.toBeNull());

    fireEvent.change(container.querySelector('[aria-label="Owner of BRD001"]'), { target: { value: 'f4' } });
    expect(probe.state.devices.find((d) => d.id === 'BRD001').farmerId).toBe('f4');

    // and back to nobody
    fireEvent.change(container.querySelector('[aria-label="Owner of BRD001"]'), { target: { value: '' } });
    expect(probe.state.devices.find((d) => d.id === 'BRD001').farmerId).toBeNull();
    await waitFor(() => expect(container.textContent).toMatch(/No farmer sees this system/i));
  });

  it('changes the name and the location, and refuses an empty name or district', async () => {
    const { container } = open('/admin/systems/BRD001');
    await waitFor(() => expect(container.textContent).toContain('BRD001'));

    fireEvent.click(button(container, 'Edit name and location'));
    const fields = [...container.querySelectorAll('.modal input')];
    expect(fields, 'name, district, sector').toHaveLength(3);
    fireEvent.change(fields[0], { target: { value: '   ' } });
    fireEvent.click(button(container, 'Save details'));
    expect(container.querySelector('[role="alert"]').textContent).toMatch(/needs a name/i);
    expect(probe.state.devices.find((d) => d.id === 'BRD001').name).toBe('Main Farm');

    fireEvent.change(fields[0], { target: { value: 'Coop A' } });
    fireEvent.change(fields[1], { target: { value: 'Musanze' } });
    fireEvent.change(fields[2], { target: { value: 'Busogo' } });
    fireEvent.click(button(container, 'Save details'));

    const device = probe.state.devices.find((d) => d.id === 'BRD001');
    expect(device.name).toBe('Coop A');
    expect(device.location).toMatchObject({ district: 'Musanze', sector: 'Busogo' });
    expect(device.serial).toBe('BRD001');
    expect(probe.state.audit[0].action).toBe('device.update');
  });
});

/* ------------------------------------------------------------------ */
/* 5. FUNCTIONAL: the assembled app                                    */
/* ------------------------------------------------------------------ */

describe('FUNCTIONAL: the assembled console on the real entry point', () => {
  it('signs the Super Admin in, then edits a farmer and unassigns a system through the UI', async () => {
    const { container } = open('/', null);

    // step one: the real sign-in form
    fireEvent.change(container.querySelector('#login-id'), { target: { value: 'afriinnox@gmail.com' } });
    fireEvent.change(container.querySelector('#login-password'), { target: { value: 'a-password' } });
    fireEvent.submit(container.querySelector('form'));
    await waitFor(() => expect(container.querySelector('.app-shell')).not.toBeNull());
    expect(container.querySelector('.app-shell').className).toContain('console');
    expect(probe.state.session).toMatchObject({ role: 'admin' });

    // now the console's own farmer page, on the same mounted app
    fireEvent.click(button(container, 'Farmers'));
    await waitFor(() => expect(container.textContent).toContain('Jean Damascene'));
    fireEvent.click(container.querySelector('tbody tr'));
    await waitFor(() => expect(container.textContent).toContain('Systems ('));

    fireEvent.click(button(container, 'Edit details'));
    const fields = [...container.querySelectorAll('.modal input')];
    fireEvent.change(fields[3], { target: { value: 'Rubavu' } });
    fireEvent.click(button(container, 'Save details'));
    await waitFor(() => expect(container.textContent).toMatch(/Rubavu/));
    expect(probe.state.farmers.find((f) => f.id === 'f1').district).toBe('Rubavu');

    fireEvent.click(button(container, 'Remove from farmer'));
    fireEvent.click(button(container, 'Remove it'));
    await waitFor(() => expect(container.textContent).toMatch(/Systems \(1\)/));
    expect(probe.state.devices.filter((d) => d.farmerId === null)).toHaveLength(1);
  });
});
