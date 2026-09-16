/**
 * The accounts, now that the demo ones are gone.
 *
 * The login page used to offer two shortcuts - "Demo farmer" and "Demo admin" -
 * that signed in as the first registered account of each kind, with a line under
 * them saying any password worked. Four of the five console accounts were demo
 * staff on addresses of their own. None of that belongs in an app real farmers
 * use, so this file holds the properties that replace it:
 *
 *   1. ONE CONSOLE ACCOUNT, and it is the Afriinnox Super Admin. The demo staff
 *      addresses are not accounts any more - and must not quietly come back.
 *   2. NOTHING ON THE APP HOLDS A PASSWORD, and the login page publishes no real
 *      address as an example. The app is a public bundle: a password written here
 *      would be published to everyone who loads it, so the password lives only in
 *      the API as a hash.
 *   3. THE REGISTRATION STILL DECIDES EVERYTHING. The Super Admin reaches the
 *      console, every registered farmer still reaches theirs, and each address
 *      that used to sign in opens nothing at all.
 *   4. WHAT THE REMOVED ACCOUNTS OWNED STILL RESOLVES - the tickets that were
 *      assigned to demo staff must name the one real account rather than falling
 *      back to "unassigned" against an id no longer in the list.
 */
import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';
import { StoreProvider } from '../lib/store.jsx';
import { ADMINS } from '../lib/seed.js';
import { FARMERS, TICKETS, buildDemoSeed } from './fixtures/demoFleet.js';
import { t } from '../i18n/strings.js';

const KEY = 'broodiinnox_app_v1';
const SUPER_ADMIN = 'afriinnox@gmail.com';
const DEMO_STAFF = ['admin@afriinnox.com', 'ops@afriinnox.com', 'tech@afriinnox.com', 'finance@afriinnox.com', 'support@afriinnox.com'];

/** The session the app builds for a seeded admin record. */
const sessionFor = (admin) => ({ id: admin.id, name: admin.name, role: 'admin', adminRole: admin.role, email: admin.email });

/** Mount the app at a route, signed out unless a session is given. */
function open(route = '/', session = null) {
  localStorage.clear();
  localStorage.setItem(KEY, JSON.stringify({ ...buildDemoSeed(), session, lang: 'en', reminderSent: [] }));
  return render(
    <MemoryRouter initialEntries={[route]}>
      <StoreProvider><App /></StoreProvider>
    </MemoryRouter>
  );
}

/** Type an identifier and a password into the real form and submit it. */
function signIn(root, identifier) {
  fireEvent.change(root.querySelector('#login-id'), { target: { value: identifier } });
  fireEvent.change(root.querySelector('#login-password'), { target: { value: 'a-password' } });
  fireEvent.submit(root.querySelector('form'));
}

beforeEach(() => {
  localStorage.clear();
});

/* ------------------------------------------------------------------ */
/* 1. who exists                                                       */
/* ------------------------------------------------------------------ */

describe('INVARIANT: one console account, and no demo staff', () => {
  it('is exactly the Afriinnox Super Admin', () => {
    expect(ADMINS).toHaveLength(1);
    expect(ADMINS[0]).toMatchObject({ email: SUPER_ADMIN, role: 'super', status: 'active' });
  });

  it('holds none of the five addresses the demo console used', () => {
    const addresses = ADMINS.map((a) => String(a.email).toLowerCase());
    for (const gone of DEMO_STAFF) {
      expect(addresses, `${gone} must not be an account`).not.toContain(gone);
    }
  });

  it('stores no password for any account, farmer or admin', () => {
    for (const account of [...ADMINS, ...FARMERS]) {
      const secret = Object.keys(account).filter((k) => /pass(word)?/i.test(k));
      expect(secret, `${account.email || account.id} carries a secret field`).toEqual([]);
      for (const value of Object.values(account)) {
        expect(typeof value === 'string' && /^(scrypt|\$2[aby]\$)/.test(value), `${account.email || account.id} carries a hash`).toBe(false);
      }
    }
  });

  it('publishes no real address as the example on the login page', () => {
    // a placeholder naming an account tells anyone who loads the page which account
    // to aim at, so it demonstrates the shape instead
    for (const lang of ['en', 'fr', 'rw']) {
      expect(t('login.identifierPh', lang), lang).not.toContain('@');
      expect(t('login.identifierPh', lang), lang).toMatch(/\d/);
    }
  });

  it('carries no key, phrase or password from the demo shortcuts', () => {
    for (const lang of ['en', 'fr', 'rw']) {
      for (const key of ['login.demoFarmer', 'login.demoAdmin', 'login.demoHint', 'login.or']) {
        // t() falls back to the key itself when it is missing, so this proves absence
        expect(t(key, lang), `${key}/${lang}`).toBe(key);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* 2. who gets in                                                      */
/* ------------------------------------------------------------------ */

describe('BEHAVIOURAL: the registration still decides who gets in', () => {
  it('the Super Admin signs in through the form and lands in the console', async () => {
    const { container } = open('/');
    signIn(container, SUPER_ADMIN);
    await waitFor(() => expect(container.querySelector('.app-shell')).not.toBeNull());
    expect(container.querySelector('.app-shell').className).toContain('console');
    expect(container.querySelector('.app-shell').className).not.toContain('farmer-app');
  });

  it('and in any case or with space around it', async () => {
    for (const typed of ['AFRIINNOX@GMAIL.COM', ' afriinnox@gmail.com ']) {
      const { container, unmount } = open('/');
      signIn(container, typed);
      await waitFor(() => expect(container.querySelector('.app-shell'), typed).not.toBeNull());
      expect(container.querySelector('.app-shell').className, typed).toContain('console');
      unmount();
    }
  });

  it('every address that used to sign in opens nothing now', () => {
    for (const gone of DEMO_STAFF) {
      const { container, unmount } = open('/');
      signIn(container, gone);
      expect(container.querySelector('.app-shell'), `${gone} opened a shell`).toBeNull();
      expect(container.querySelector('[role="alert"]').textContent, gone).toMatch(/not registered/i);
      unmount();
    }
  });

  it('every registered farmer still reaches the farmer shell, by email or by phone', async () => {
    for (const farmer of FARMERS) {
      for (const identifier of [farmer.email, farmer.phone]) {
        const { container, unmount } = open('/');
        signIn(container, identifier);
        await waitFor(() => expect(container.querySelector('.app-shell'), identifier).not.toBeNull());
        const classes = container.querySelector('.app-shell').className;
        expect(classes, identifier).toContain('farmer-app');
        expect(classes, identifier).not.toContain('console');
        unmount();
      }
    }
  });

  it('offers no shortcut that signs anyone in without the form', () => {
    const { container } = open('/');
    const labels = [...container.querySelectorAll('button')].map((b) => b.textContent.trim());
    expect(labels.filter((l) => /demo/i.test(l))).toEqual([]);
    expect(container.textContent).not.toMatch(/demo|any password/i);
    expect(container.querySelector('#login-id'), 'the form is the only way in').not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 3. the console the single account lands in                          */
/* ------------------------------------------------------------------ */

describe('FUNCTIONAL: the console holds up with the demo accounts removed', () => {
  it('the tickets demo staff used to own still resolve to the real account', async () => {
    const admin = ADMINS.find((a) => a.role === 'super');
    const { container } = open('/admin/tickets', sessionFor(admin));

    await waitFor(() => expect(container.querySelector('.app-shell')).not.toBeNull());

    // the queue opens on its "Open" tab, so ask for every ticket first (the tabs
    // are divs, not buttons - see Tabs in components/ui.jsx)
    const all = [...container.querySelectorAll('.tab')].find((tab) => tab.textContent.trim() === 'All');
    expect(all, 'the queue offers an All view').toBeDefined();
    fireEvent.click(all);

    const lines = [...container.querySelectorAll('.muted.small')]
      .map((el) => el.textContent)
      .filter((text) => /assigned:/.test(text));
    expect(lines.length, 'every seeded ticket is on the page').toBe(TICKETS.length);

    // a reference to an account that no longer exists renders as "unassigned", so
    // only the tickets the seed genuinely leaves unassigned may say it
    const dangling = lines.filter((text) => /unassigned/.test(text)).length;
    expect(dangling, 'no ticket dangles against a removed account').toBe(TICKETS.filter((tk) => !tk.assignee).length);
    expect(lines.some((text) => new RegExp(admin.name, 'i').test(text)), 'the rest name the Super Admin').toBe(true);
  });

  it('the console lists the one account, and none of the demo staff', async () => {
    const admin = ADMINS.find((a) => a.role === 'super');
    const { container } = open('/admin/admins', sessionFor(admin));

    await waitFor(() => expect(container.querySelector('.app-shell')).not.toBeNull());
    expect(container.textContent).toContain(SUPER_ADMIN);
    for (const name of ['Grace Uwase', 'Sandrine Niyonkuru', 'Olivier Byiringiro']) {
      expect(container.textContent, `${name} is gone`).not.toContain(name);
    }
  });

  it('and the sidebar names the account that signed in', async () => {
    const admin = ADMINS.find((a) => a.role === 'super');
    const { container } = open('/admin/dashboard', sessionFor(admin));
    await waitFor(() => expect(container.querySelector('.app-shell')).not.toBeNull());
    expect(container.textContent).toContain(admin.name);
    expect(container.querySelector('.app-shell').className).toContain('console');
  });
});
