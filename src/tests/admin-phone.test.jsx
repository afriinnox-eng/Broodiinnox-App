/**
 * The console's own account, and the phone number it never had.
 *
 * The report was that the Admin's credentials do not work "on phone". Two things
 * were wrong, and only one of them was a display problem:
 *
 *   1. A console account could ONLY sign in with its email address. The Super
 *      Admin's record carried no phone number at all, `lookup()` in Login.jsx
 *      compares a typed number against `admin.phone` — so every number typed for
 *      the admin resolved to nobody — and nothing in the console could give the
 *      account a number: AdminUsers.jsx had no phone field, in the list or in
 *      the create form, and UPDATE_ADMIN existed only to flip a status.
 *   2. The sign-in screen offers "Email or phone number" with a NUMBER as its
 *      example, so a number is exactly what a person is invited to type — and
 *      the refusal said "Ask the Afriinnox admin to register you", which is
 *      useless advice for the Afriinnox admin.
 *
 * What has to hold now, for every account and every shape of its details:
 *
 *   1. ONE IDENTIFIER, ONE ACCOUNT — across farmers AND console accounts. They
 *      sign in on the same screen and Login.jsx resolves a farmer first, so an
 *      identifier held by both would silently be the farmer's.
 *   2. A NUMBER THE ACCOUNT HOLDS RESOLVES TO IT, in every shape phoneKey
 *      accepts (0788…, 0788 123 456, 0788-123-456, +250…), because that is what
 *      a person types on a phone keypad.
 *   3. AN EDIT CANNOT CHANGE AN ACCOUNT'S IDENTITY, and a number that is a way
 *      into the console never comes from anywhere but the person it belongs to.
 */
import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import App from '../App.jsx';
import { StoreProvider, useStore } from '../lib/store.jsx';
import { farmerDetailIssues } from '../lib/services.js';
import { FARMERS as DEMO_FARMERS, buildDemoSeed } from './fixtures/demoFleet.js';
import { t } from '../i18n/strings.js';

const KEY = 'broodiinnox_app_v1';
const ADMIN_SESSION = { id: 'a1', name: 'Afriinnox', role: 'admin', adminRole: 'super', email: 'afriinnox@gmail.com' };

/** The Super Admin's own mobile, and a shape of it a phone keypad produces. */
const ADMIN_PHONE = '0788999000';
const SHAPES = ['0788999000', '0788 999 000', '0788-999-000', '+250788999000', '250788999000'];

let probe = { state: null, dispatch: null };

function Probe() {
  const { state, dispatch } = useStore();
  probe = { state, dispatch };
  return null;
}

/** The console account as it stands AFTER the console has given it a number. */
function seedWithAdminPhone({ phone = ADMIN_PHONE } = {}) {
  const seed = buildDemoSeed();
  return { ...seed, admins: seed.admins.map((a) => (a.id === 'a1' ? { ...a, phone } : a)), session: null, lang: 'en', reminderSent: [] };
}

function open(route, session = ADMIN_SESSION, saved = null) {
  localStorage.clear();
  localStorage.setItem(KEY, JSON.stringify(saved || { ...buildDemoSeed(), session, lang: 'en', reminderSent: [] }));
  probe = { state: null, dispatch: null };
  return render(
    <MemoryRouter initialEntries={[route]}>
      <StoreProvider><Probe /><App /></StoreProvider>
    </MemoryRouter>
  );
}

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
/* 1. INVARIANT: one identifier, one account — across BOTH lists        */
/* ------------------------------------------------------------------ */

describe('INVARIANT: one identifier signs in one account, farmer or console', () => {
  const admin = { id: 'a1', name: 'Afriinnox', email: 'afriinnox@gmail.com', phone: ADMIN_PHONE };
  const pool = [...DEMO_FARMERS, admin];

  it('refuses a console account the number of an existing farmer, in any shape', () => {
    for (const shape of ['0788123456', '0788 123 456', '0788-123-456', '+250788123456']) {
      const issues = farmerDetailIssues({ patch: { name: 'Afriinnox', email: '', phone: shape }, farmers: pool, selfId: 'a1' });
      expect(issues.phone, shape).toMatch(/already signs in another account/);
    }
  });

  it('refuses a console account the email of an existing farmer, whatever its case', () => {
    const issues = farmerDetailIssues({ patch: { name: 'Afriinnox', email: 'JEAN@FARM.RW', phone: '' }, farmers: pool, selfId: 'a1' });
    expect(issues.email).toMatch(/already signs in another account/);
  });

  it('refuses a FARMER the number or address of a console account', () => {
    // the same rule the other way round, or the farmer would shadow the admin:
    // Login.jsx resolves a farmer first, so the admin could never sign in again
    const byPhone = farmerDetailIssues({ patch: { name: 'Jean', phone: ADMIN_PHONE, email: '' }, farmers: pool, selfId: 'f1' });
    expect(byPhone.phone).toMatch(/already signs in another account/);
    const byEmail = farmerDetailIssues({ patch: { name: 'Jean', phone: '', email: 'afriinnox@gmail.com' }, farmers: pool, selfId: 'f1' });
    expect(byEmail.email).toMatch(/already signs in another account/);
  });

  it('accepts an account its own unchanged identifiers, in whatever shape', () => {
    for (const shape of SHAPES) {
      expect(farmerDetailIssues({ patch: { name: 'Afriinnox', email: 'afriinnox@gmail.com', phone: shape }, farmers: pool, selfId: 'a1' }), shape).toEqual({});
    }
  });

  it('still refuses an account with no way in at all', () => {
    const issues = farmerDetailIssues({ patch: { name: 'Afriinnox', phone: '', email: '' }, farmers: pool, selfId: 'a1' });
    expect(issues.identifier).toMatch(/how they sign in/);
  });
});

/* ------------------------------------------------------------------ */
/* 2. INVARIANT: the store                                              */
/* ------------------------------------------------------------------ */

describe('INVARIANT: a console account cannot be edited out of its own identity', () => {
  it('UPDATE_ADMIN cannot change the id or the creation date', async () => {
    localStorage.clear();
    localStorage.setItem(KEY, JSON.stringify({ ...buildDemoSeed(), session: ADMIN_SESSION, lang: 'en', reminderSent: [] }));
    probe = { state: null, dispatch: null };
    render(<StoreProvider><Probe /></StoreProvider>);
    const before = probe.state.admins.find((a) => a.id === 'a1');

    await act(async () => {
      probe.dispatch({ type: 'UPDATE_ADMIN', id: 'a1', patch: { id: 'a1-renamed', createdAt: '1999-01-01T00:00:00.000Z', phone: ADMIN_PHONE } });
    });

    const after = probe.state.admins.find((a) => a.id === 'a1');
    expect(after, 'the account is still found by its id').toBeTruthy();
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.phone).toBe(ADMIN_PHONE);
  });

  it('audits the fields that changed, and writes nothing for a no-op', async () => {
    localStorage.clear();
    localStorage.setItem(KEY, JSON.stringify({ ...buildDemoSeed(), session: ADMIN_SESSION, lang: 'en', reminderSent: [] }));
    probe = { state: null, dispatch: null };
    render(<StoreProvider><Probe /></StoreProvider>);
    const auditBefore = probe.state.audit.length;

    await act(async () => {
      probe.dispatch({ type: 'UPDATE_ADMIN', id: 'a1', patch: { phone: ADMIN_PHONE } });
    });
    expect(probe.state.audit.length).toBe(auditBefore + 1);
    expect(probe.state.audit[0]).toMatchObject({ action: 'admin.update', prev: { phone: null }, next: { phone: ADMIN_PHONE } });

    await act(async () => {
      probe.dispatch({ type: 'UPDATE_ADMIN', id: 'a1', patch: { phone: ADMIN_PHONE } });
    });
    expect(probe.state.audit.length).toBe(auditBefore + 1);
  });

  it('the accounts that may sign in are never rewritten by a live poll', async () => {
    // the poll overlays DEVICES. If it could touch `admins`, a poll would be a
    // way to change who can reach the console.
    localStorage.clear();
    localStorage.setItem(KEY, JSON.stringify({ ...buildDemoSeed(), session: ADMIN_SESSION, lang: 'en', reminderSent: [] }));
    probe = { state: null, dispatch: null };
    render(<StoreProvider><Probe /></StoreProvider>);
    const before = JSON.stringify(probe.state.admins);
    await act(async () => {
      probe.dispatch({
        type: 'LIVE_SYNC',
        devices: [{ id: 'BROODIINNOX-001', name: 'Damas', farmerId: 'f1', online: true, locked: false, sensors: [], lastSeenAt: new Date().toISOString() }],
      });
    });
    expect(JSON.stringify(probe.state.admins)).toBe(before);
    expect(probe.state.admins.map((a) => a.email)).toEqual(['afriinnox@gmail.com']);
  });
});

/* ------------------------------------------------------------------ */
/* 3. BEHAVIOURAL: the console gives the account a number               */
/* ------------------------------------------------------------------ */

describe("BEHAVIOURAL: the console's own accounts page", () => {
  it('offers a phone for every account, and saves one', async () => {
    const { container } = open('/admin/admins');
    await waitFor(() => expect(container.textContent).toContain('afriinnox@gmail.com'));

    fireEvent.click(button(container, 'Edit'));
    const fields = [...container.querySelectorAll('.modal input')];
    expect(fields, 'name, email, phone').toHaveLength(3);
    fireEvent.change(fields[2], { target: { value: ADMIN_PHONE } });
    fireEvent.click(button(container, 'Save details'));

    expect(probe.state.admins.find((a) => a.id === 'a1').phone).toBe(ADMIN_PHONE);
    expect(probe.state.audit[0].action).toBe('admin.update');
    await waitFor(() => expect(container.textContent).toContain(ADMIN_PHONE));
    expect(container.querySelector('.modal')).toBeNull();
  });

  it('refuses a number that already signs in a farmer, and writes nothing', async () => {
    const { container } = open('/admin/admins');
    await waitFor(() => expect(container.textContent).toContain('afriinnox@gmail.com'));
    const before = probe.state.audit.length;

    fireEvent.click(button(container, 'Edit'));
    const fields = [...container.querySelectorAll('.modal input')];
    fireEvent.change(fields[2], { target: { value: '0788 123 456' } }); // a demonstration farmer's
    fireEvent.click(button(container, 'Save details'));

    expect(container.querySelector('[role="alert"]').textContent).toMatch(/already signs in another account/i);
    expect(probe.state.admins.find((a) => a.id === 'a1').phone).toBeUndefined();
    expect(probe.state.audit).toHaveLength(before);
    expect(container.querySelector('.modal')).not.toBeNull();
  });

  it('a new console account can be given a number as it is created', async () => {
    const { container } = open('/admin/admins');
    await waitFor(() => expect(container.textContent).toContain('afriinnox@gmail.com'));

    fireEvent.click(button(container, 'Create admin account'));
    const fields = [...container.querySelectorAll('.modal input')];
    expect(fields).toHaveLength(3); // name, email, phone
    fireEvent.change(fields[0], { target: { value: 'Grace Uwase' } });
    fireEvent.change(fields[1], { target: { value: 'grace@afriinnox.com' } });
    fireEvent.change(fields[2], { target: { value: '0788777000' } });
    // scoped to the dialog: the page's own "+ Create admin account" button also
    // matches /Create/i, and clicking that would only re-open this form
    const submit = [...container.querySelectorAll('.modal button')].find((b) => /^Create$/i.test(b.textContent.trim()));
    fireEvent.click(submit);

    const created = probe.state.admins.find((a) => a.email === 'grace@afriinnox.com');
    expect(created, 'the account was created').toBeTruthy();
    expect(created.phone).toBe('0788777000');
  });
});

/* ------------------------------------------------------------------ */
/* 4. FUNCTIONAL: signing in on a phone                                 */
/* ------------------------------------------------------------------ */

describe('FUNCTIONAL: the admin signs in with a number, on the assembled app', () => {
  it('every shape of the number reaches the console', async () => {
    for (const shape of SHAPES) {
      const { container, unmount } = open('/', null, seedWithAdminPhone());
      fireEvent.change(container.querySelector('#login-id'), { target: { value: shape } });
      fireEvent.change(container.querySelector('#login-password'), { target: { value: 'LioN29@' } });
      fireEvent.submit(container.querySelector('form'));
      await waitFor(() => expect(container.querySelector('.app-shell'), shape).not.toBeNull());
      expect(container.querySelector('.app-shell').className, shape).toContain('console');
      expect(probe.state.session, shape).toMatchObject({ role: 'admin', email: 'afriinnox@gmail.com' });
      unmount();
    }
  });

  it('and only that account: a number nobody holds is still refused', async () => {
    const { container } = open('/', null, seedWithAdminPhone());
    fireEvent.change(container.querySelector('#login-id'), { target: { value: '0788999111' } });
    fireEvent.change(container.querySelector('#login-password'), { target: { value: 'LioN29@' } });
    fireEvent.submit(container.querySelector('form'));
    expect(container.querySelector('.app-shell'), 'a number nobody registered opened a shell').toBeNull();
    expect(container.querySelector('[role="alert"]').textContent).toMatch(/not registered/i);
  });

  it('a number with no account yet is told what a console account signs in with', async () => {
    // the state before the console gives the account a number: the number is
    // nobody's, and the refusal has to be worth reading
    const { container } = open('/', null);
    fireEvent.change(container.querySelector('#login-id'), { target: { value: ADMIN_PHONE } });
    fireEvent.change(container.querySelector('#login-password'), { target: { value: 'LioN29@' } });
    fireEvent.submit(container.querySelector('form'));
    const alert = container.querySelector('[role="alert"]').textContent;
    expect(alert).toMatch(/not registered/i);
    expect(alert, 'the sentence says which kind of identifier a console account uses').toMatch(/console account signs in with its email/i);
  });

  it('and the email address still works, so nobody is locked out by any of this', async () => {
    const { container } = open('/', null);
    fireEvent.change(container.querySelector('#login-id'), { target: { value: 'afriinnox@gmail.com' } });
    fireEvent.change(container.querySelector('#login-password'), { target: { value: 'LioN29@' } });
    fireEvent.submit(container.querySelector('form'));
    await waitFor(() => expect(container.querySelector('.app-shell')).not.toBeNull());
    expect(container.querySelector('.app-shell').className).toContain('console');
  });

  it('the new sentence exists in all three languages', () => {
    for (const lang of ['en', 'fr', 'rw']) {
      expect(t('login.notRegisteredPhone', lang), lang).toMatch(/console account|compte console|konti ya Afriinnox/);
    }
    expect(t('login.notRegisteredPhone', 'en')).toContain('email address');
  });
});
