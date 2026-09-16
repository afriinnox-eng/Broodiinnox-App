/**
 * A phone opens a page on the page, not on the menu.
 *
 * The complaint this answers: "inside the phone, the app pages can't be seen as a
 * whole — it requires me to pull it." Two causes were measured on the live site
 * (_pages_phone_probe.mjs, every internal route of both roles, iPhone 13):
 *
 *   1. THE WALL — below 980px the sidebar was stacked above the page, so the whole
 *      menu sat between the top of the screen and the page. Content began at y=681
 *      on a 664px screen for a farmer (601px of menu) and y=977 for the console
 *      (897px of menu). Every page had to be pulled up before it could be read.
 *   2. THE STRETCH — the shell column was `1fr`, which is `minmax(auto, 1fr)`, so
 *      anything that could not shrink set the column, and with it the entire page,
 *      wider than the phone: 53-493px of every page lay off the right edge, where
 *      no amount of pulling up and down would ever find it.
 *
 * So the navigation is now a drawer over the page instead of a block above it, and
 * the column can no longer be widened by its contents. WHAT THIS FILE CAN AND
 * CANNOT PROVE:
 *
 *   - jsdom has no layout AND applies no media queries, so it cannot see where
 *     anything lands. The layout facts above are therefore proved by the browser
 *     probe on every route, and the two stylesheet rules those facts rest on are
 *     guarded here by reading the stylesheet (describe: THE PHONE RULES).
 *   - What jsdom can prove is the drawer's contract, which is what this file
 *     asserts route by route: a page arrives with the drawer shut, the button is
 *     wired to it, and every way of closing it really closes it.
 */
import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import App from '../App.jsx';
import { StoreProvider } from '../lib/store.jsx';
import { buildDemoSeed } from './fixtures/demoFleet.js';

const KEY = 'broodiinnox_app_v1';

/* the same session shapes the other shell tests use */
const SESSIONS = {
  admin: { id: 'a1', name: 'Afriinnox', role: 'admin', adminRole: 'super', email: 'afriinnox@gmail.com' },
  farmer: { id: 'f1', name: 'Jean Damascene', role: 'farmer', phone: '0788123456' },
};

/* every internal route of both roles - the same list console-skin.test.jsx
   sweeps, minus the parameterised ones, which add no new layout */
const ROUTES = {
  admin: [
    '/admin/dashboard', '/admin/farmers', '/admin/devices', '/admin/live', '/admin/map',
    '/admin/batches', '/admin/subscriptions', '/admin/payments', '/admin/reports',
    '/admin/alerts', '/admin/tickets', '/admin/messages', '/admin/admins', '/admin/audit',
    '/admin/maintenance', '/admin/inventory', '/admin/settings',
  ],
  farmer: [
    '/farmer/dashboard', '/farmer/systems', '/farmer/batches', '/farmer/alerts',
    '/farmer/subscriptions', '/farmer/payments', '/farmer/support', '/farmer/notifications',
    '/farmer/tips', '/farmer/settings',
  ],
};

/* the destinations each shell registers (mirror of ADMIN_NAV / FARMER_NAV) */
const NAV = {
  admin: ['dashboard', 'farmers', 'devices', 'live', 'map', 'batches', 'subscriptions', 'payments',
    'reports', 'alerts', 'tickets', 'messages', 'admins', 'audit', 'maintenance', 'inventory', 'settings'],
  farmer: ['dashboard', 'systems', 'batches', 'alerts', 'subscriptions', 'payments',
    'support', 'notifications', 'tips', 'settings'],
};

const CASES = [];
for (const role of ['admin', 'farmer']) {
  for (const path of ROUTES[role]) CASES.push({ role, path });
}

function open(path, role) {
  localStorage.clear();
  localStorage.setItem(KEY, JSON.stringify({
    ...buildDemoSeed(), session: SESSIONS[role], lang: 'en', theme: 'light', reminderSent: [],
  }));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <StoreProvider><App /></StoreProvider>
    </MemoryRouter>
  );
}

const isOpen = (drawer) => /\bopen\b/.test(drawer.className);

beforeEach(() => {
  localStorage.clear();
});

describe('INVARIANT: every internal page arrives with the navigation shut', () => {
  it.each(CASES)('$role $path', ({ role, path }) => {
    const { container } = open(path, role);
    const shell = container.querySelector('.app-shell');
    expect(shell, 'no shell opened').not.toBeNull();

    // 1. the drawer is addressable and shut, and nothing covers the page
    const drawer = container.querySelector('#app-nav');
    expect(drawer, 'the navigation is not addressable').not.toBeNull();
    expect(isOpen(drawer), 'the menu is open over the page it just opened').toBe(false);
    expect(container.querySelector('.nav-scrim'), 'something covers the page on arrival').toBeNull();
    expect(shell.className, 'the shell thinks the menu is open').not.toMatch(/nav-open/);

    // 2. the page's content is outside the navigation, so taking the navigation
    //    out of the flow leaves the content first on the screen
    const main = container.querySelector('.main');
    expect(main, 'no page rendered').not.toBeNull();
    expect(drawer.contains(main), 'the page is inside the navigation').toBe(false);

    // 3. the button reports what it controls, and reports shut
    const toggle = container.querySelector('.nav-toggle');
    expect(toggle, 'no way to open the navigation').not.toBeNull();
    expect(toggle.getAttribute('aria-controls')).toBe('app-nav');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    // 4. nothing went missing on the way: every destination of this role is in
    //    the drawer, exactly once
    const hrefs = [...drawer.querySelectorAll('a.nav-item')].map((a) => a.getAttribute('href'));
    const base = role === 'admin' ? '/admin' : '/farmer';
    expect(hrefs.length, 'the drawer lost or duplicated a destination').toBe(NAV[role].length);
    for (const key of NAV[role]) expect(hrefs, `${key} is missing from the drawer`).toContain(`${base}/${key}`);
  });
});

describe('INVARIANT: choosing a page from the menu puts the menu away', () => {
  it.each(CASES)('$role $path closes it, even when it is already the page you are on', ({ role, path }) => {
    const { container } = open(path, role);
    const drawer = () => container.querySelector('#app-nav');
    const toggle = container.querySelector('.nav-toggle');

    fireEvent.click(toggle);
    expect(isOpen(drawer()), 'the menu did not open').toBe(true);
    expect(container.querySelector('.nav-scrim'), 'the page is not covered while the menu is open').not.toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    // the link for THIS page - tapping it changes no pathname, which is exactly
    // the case a route-change-only close would leave the menu sitting over
    const link = [...drawer().querySelectorAll('a.nav-item')].find((a) => a.getAttribute('href') === path);
    expect(link, `no link to ${path} in the drawer`).not.toBeNull();
    fireEvent.click(link);

    expect(isOpen(drawer()), 'the menu stayed open over the page it opened').toBe(false);
    expect(container.querySelector('.nav-scrim')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it.each(['admin', 'farmer'])('%s: it closes on another page too, and that page becomes current', (role) => {
    const base = role === 'admin' ? '/admin' : '/farmer';
    const { container } = open(`${base}/dashboard`, role);
    const drawer = () => container.querySelector('#app-nav');

    fireEvent.click(container.querySelector('.nav-toggle'));
    const other = `${base}/${role === 'admin' ? 'reports' : 'tips'}`;
    const link = [...drawer().querySelectorAll('a.nav-item')].find((a) => a.getAttribute('href') === other);
    expect(link, `no link to ${other}`).not.toBeNull();
    fireEvent.click(link);

    expect(isOpen(drawer()), 'the menu stayed open after navigating').toBe(false);
    const active = drawer().querySelector('a.nav-item.active');
    expect(active, 'the page that was chosen is not the current one').not.toBeNull();
    expect(active.getAttribute('href')).toBe(other);
  });
});

describe('BEHAVIOURAL: the other ways out of the drawer', () => {
  it.each(['admin', 'farmer'])('%s: Escape, the scrim and the drawer\'s own button each shut it', (role) => {
    const base = role === 'admin' ? '/admin' : '/farmer';
    const { container } = open(`${base}/dashboard`, role);
    const drawer = () => container.querySelector('#app-nav');
    const scrim = () => container.querySelector('.nav-scrim');
    const toggle = container.querySelector('.nav-toggle');

    // Escape
    fireEvent.click(toggle);
    expect(isOpen(drawer())).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(isOpen(drawer()), 'Escape left the menu over the page').toBe(false);
    expect(scrim()).toBeNull();

    // anywhere off the drawer
    fireEvent.click(toggle);
    expect(scrim(), 'no way to tap off the drawer').not.toBeNull();
    fireEvent.click(scrim());
    expect(isOpen(drawer())).toBe(false);
    expect(scrim()).toBeNull();

    // the button inside it
    fireEvent.click(toggle);
    const close = drawer().querySelector('.nav-close');
    expect(close, 'the drawer carries no way out of itself').not.toBeNull();
    fireEvent.click(close);
    expect(isOpen(drawer())).toBe(false);
    expect(scrim()).toBeNull();

    // and Escape with nothing open opens nothing and throws nothing
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(isOpen(drawer())).toBe(false);
    expect(scrim()).toBeNull();
  });

  it('the button reports the open state it is really in', () => {
    const { container } = open('/admin/dashboard', 'admin');
    const toggle = container.querySelector('.nav-toggle');
    const drawer = () => container.querySelector('#app-nav');
    const expanded = () => toggle.getAttribute('aria-expanded');

    expect(expanded()).toBe('false');
    fireEvent.click(toggle);
    expect(isOpen(drawer())).toBe(true);
    expect(expanded()).toBe('true');
    fireEvent.click(container.querySelector('.nav-scrim'));
    expect(expanded()).toBe('false');
  });
});

/* ------------------------------------------------------------------ */
/* THE PHONE RULES                                                     */
/* ------------------------------------------------------------------ */

const CSS = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'global.css'), 'utf8');

/** The declarations inside one at-rule, found by matching its braces. */
function blockFor(header) {
  const at = CSS.indexOf(header);
  if (at === -1) return '';
  const from = CSS.indexOf('{', at);
  if (from === -1) return '';
  let depth = 0;
  for (let i = from; i < CSS.length; i += 1) {
    if (CSS[i] === '{') depth += 1;
    else if (CSS[i] === '}') {
      depth -= 1;
      if (depth === 0) return CSS.slice(from + 1, i);
    }
  }
  return '';
}

const PHONE = blockFor('@media (max-width: 980px)');
const NARROW = blockFor('@media (max-width: 640px)');

describe('THE PHONE RULES: what the browser probe measures on every route', () => {
  it('takes the navigation out of the flow instead of stacking it above the page', () => {
    expect(PHONE, 'there is no phone breakpoint at all').not.toBe('');
    // position: static is the wall: the whole menu above the page
    expect(PHONE, 'the sidebar is still in the flow above the page').toMatch(/\.sidebar\s*\{[^}]*position:\s*fixed/);
    // and it starts off the screen, with the way in being the button
    expect(PHONE, 'the drawer is not off the screen when shut').toMatch(/\.sidebar\s*\{[^}]*transform:\s*translateX\(-100%\)/);
    expect(PHONE, 'the drawer has no open state').toMatch(/\.sidebar\.open\s*\{[^}]*transform:\s*none/);
    expect(PHONE, 'the button that opens it is never shown').toMatch(/\.nav-toggle\s*\{[^}]*display:\s*grid/);
    // a drawer off the screen but still focusable is a drawer a keyboard falls into
    expect(PHONE, 'the shut drawer is still in the tab order').toMatch(/\.sidebar\s*\{[^}]*visibility:\s*hidden/);
    expect(PHONE, 'the open drawer is not made visible again').toMatch(/\.sidebar\.open\s*\{[^}]*visibility:\s*visible/);
  });

  it('never lets the shell column be widened by its own content', () => {
    // `1fr` is `minmax(auto, 1fr)`, and that auto minimum is what put 53-493px of
    // every page off the right edge of a 390px phone. A bare 1fr column here is
    // the regression, at either width.
    expect(CSS, 'the desktop shell column is a bare 1fr').toMatch(/\.app-shell\s*\{[^}]*grid-template-columns:\s*240px minmax\(0,\s*1fr\)/);
    expect(PHONE, 'the phone shell column is a bare 1fr').toMatch(/\.app-shell\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(PHONE, 'a bare 1fr column survives in the phone shell').not.toMatch(/\.app-shell\s*\{[^}]*grid-template-columns:\s*1fr\s*;/);
    // the grid the content itself is laid out on must not stretch either
    expect(PHONE, 'the content grid can still stretch the page').toMatch(/\.grid\.cols-3[^{]*\{[^}]*minmax\(0,\s*1fr\)/);
    expect(NARROW, 'the stacked phone grid can still stretch the page').toMatch(/\.grid\.cols-2[^{]*\{[^}]*minmax\(0,\s*1fr\)/);
    // the column itself must be allowed to shrink below its content
    expect(CSS, 'the column cannot shrink below its content').toMatch(/\.shell-column\s*\{[^}]*min-width:\s*0/);
  });

  it('keeps the phone topbar to one row and gives the search its own', () => {
    expect(NARROW, 'the topbar cannot wrap, so the row is cut off').toMatch(/\.topbar\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(NARROW, 'the search is not given a full row of its own').toMatch(/\.topbar-search-slot\s*\{[^}]*flex:\s*1 1 100%/);
    expect(NARROW, 'the search keeps the topbar width').toMatch(/\.topbar-search-slot\s*\{[^}]*max-width:\s*none/);
    // a long page name must shorten rather than push the row off the screen
    expect(NARROW, 'the page name cannot shorten').toMatch(/\.topbar-title\s*\{[^}]*text-overflow:\s*ellipsis/);
  });

  it('leaves no inline width on the search box that a breakpoint could not override', () => {
    // the lesson the home screen already learned: an inline style beats a media
    // query, so the width has to live in the stylesheet
    const { container } = open('/admin/dashboard', 'admin');
    const slot = container.querySelector('.topbar-search-slot');
    expect(slot, 'the admin search is not in a stylable box').not.toBeNull();
    expect(slot.getAttribute('style') || '', 'an inline width cannot be overridden by a breakpoint').not.toMatch(/width|flex/i);
    expect(container.querySelector('.topbar-title'), 'the page name has no class to hang the ellipsis on').not.toBeNull();

    // and the farmer shell carries no search box at all, which is why the farmer
    // breakpoint never has to make room for one
    const farmer = open('/farmer/dashboard', 'farmer');
    expect(farmer.container.querySelector('.topbar-search-slot')).toBeNull();
  });
});
