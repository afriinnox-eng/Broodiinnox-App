/**
 * Invariant tests for the role-scoped console skin (commit 94feaf1).
 *
 * The change splits the shared shell into two skins: the farmer app keeps the
 * light-blue app shell (`farmer-app`), the Afriinnox Admin gets the dark
 * operations-console shell (`console`), plus a matching role identity line in
 * the sidebar and role-coloured accents on the login role tabs/sign-in button.
 *
 * These are invariants — properties that must hold for EVERY valid input, not
 * one happy-path screenshot:
 *
 *   1. SHELL IDENTITY — on every registered route of every role, the shell
 *      carries exactly the role's class (`console` xor `farmer-app`), never
 *      both, never the other role's, never neither.
 *   2. IDENTITY LINE — the sidebar brand sub-line always matches the signed-in
 *      role ("Operations Console" for admin, "Broodiinnox" for farmer), on
 *      every route.
 *   3. NO EMOJI IN RENDERED UI — nothing the user sees on any page of either
 *      role contains a pictographic/emoji glyph (the "AI look" the skin was
 *      built without). Asserted on rendered DOM text, not just source.
 *   4. ROUTE REGISTERED, NOT FALLEN BACK — for every top-level route the nav
 *      knows, exactly one nav item is active and it names that section. A
 *      catch-all fallback would instead highlight "Dashboard".
 *   5. THEME-INDEPENDENT — the split holds identically in light AND dark
 *      themes (the data-theme attribute is applied and the role classes do not
 *      drift).
 *   6. LOGIN ROLE ACCENT — on the login screen each mode renders one accent
 *      (farmer blue vs admin black) and only the selected role carries it, on
 *      the active tab border and on the Sign-in button; switching modes swaps
 *      exactly which side carries it.
 */
import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import App from '../App.jsx';
import { StoreProvider } from '../lib/store.jsx';
import { buildSeed } from '../lib/seed.js';
import { t } from '../i18n/strings.js';

const KEY = 'broodiinnox_app_v1';

/* same glyph classes the source-hygiene invariant flags, applied to DOM text */
const FLAGGED_RANGES = [
  [0x1f000, 0x1faff],
  [0x1f1e6, 0x1f1ff],
  [0x2600, 0x27bf],
  [0x2b00, 0x2bff],
  [0x2300, 0x23ff],
  [0xfe00, 0xfe0f],
];
function hasEmoji(text) {
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i);
    if (FLAGGED_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi)) return true;
    i += cp > 0xffff ? 2 : 1;
  }
  return false;
}

const SESSIONS = {
  admin: { id: 'a1', name: 'Innocent Ingabire', role: 'admin', adminRole: 'super', email: 'admin@afriinnox.com' },
  farmer: { id: 'f1', name: 'Jean Damascene', role: 'farmer', phone: '0788123456' },
};

/* every route App.jsx registers, per role; param routes are marked */
const ROUTES = {
  admin: [
    '/admin/dashboard', '/admin/farmers', '/admin/devices', '/admin/live', '/admin/map',
    '/admin/batches', '/admin/subscriptions', '/admin/payments', '/admin/reports',
    '/admin/alerts', '/admin/tickets', '/admin/messages', '/admin/admins', '/admin/audit',
    '/admin/maintenance', '/admin/inventory', '/admin/settings',
    { path: '/admin/farmers/f1', param: true },
    { path: '/admin/systems/BRD001', param: true },
  ],
  farmer: [
    '/farmer/dashboard', '/farmer/systems', '/farmer/batches', '/farmer/alerts',
    '/farmer/subscriptions', '/farmer/payments', '/farmer/support', '/farmer/notifications',
    '/farmer/tips', '/farmer/settings',
    { path: '/farmer/systems/BRD001', param: true },
  ],
};

/* the nav keys each shell registers (mirror of ADMIN_NAV / FARMER_NAV) */
const NAV_KEYS = {
  admin: ['dashboard', 'farmers', 'devices', 'live', 'map', 'batches', 'subscriptions', 'payments',
    'reports', 'alerts', 'tickets', 'messages', 'admins', 'audit', 'maintenance', 'inventory', 'settings'],
  farmer: ['dashboard', 'systems', 'batches', 'alerts', 'subscriptions', 'payments',
    'support', 'notifications', 'tips', 'settings'],
};

const SHELL = {
  admin: { cls: 'console', sub: 'Operations Console', other: 'farmer-app' },
  farmer: { cls: 'farmer-app', sub: 'Broodiinnox', other: 'console' },
};

function seedWith(session, theme = 'light') {
  return { ...buildSeed(), session, lang: 'en', theme, reminderSent: [] };
}

function renderApp(initialPath, session, theme = 'light') {
  localStorage.setItem(KEY, JSON.stringify(seedWith(session, theme)));
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <StoreProvider>
        <App />
      </StoreProvider>
    </MemoryRouter>
  );
}

function shellClassNames(container) {
  return [...container.querySelectorAll('.app-shell')].map((s) => s.className);
}

beforeEach(() => {
  localStorage.clear();
});

describe('console skin invariants: every route of every role', () => {
  const cases = [];
  for (const role of ['admin', 'farmer']) {
    for (const entry of ROUTES[role]) {
      const path = typeof entry === 'string' ? entry : entry.path;
      const isParam = typeof entry === 'object';
      cases.push({ role, path, isParam });
    }
  }

  it.each(cases)('shell identity holds on $role $path', ({ role, path, isParam }) => {
    const { container } = renderApp(path, SESSIONS[role]);
    const spec = SHELL[role];

    // invariant 1: exactly the role's shell class, never both/neither/other
    const shells = shellClassNames(container);
    expect(shells.length).toBe(1);
    expect(shells[0]).toContain(spec.cls);
    expect(shells[0]).not.toContain(spec.other);

    // invariant 2: role identity line in the sidebar
    const sub = container.querySelector('.sidebar .brand-sub');
    expect(sub).not.toBeNull();
    expect(sub.textContent.trim()).toBe(spec.sub);

    // invariant 3: nothing rendered on this page carries an emoji glyph
    expect(hasEmoji(container.textContent)).toBe(false);

    // the page actually drew content
    const main = container.querySelector('.main');
    expect(main).not.toBeNull();
    expect(main.textContent.trim().length).toBeGreaterThan(0);

    // invariant 4: a nav-known top-level route highlights exactly its section
    // (not the dashboard fallback); deep links to records have no nav entry
    const section = path.split('/')[2];
    if (!isParam && NAV_KEYS[role].includes(section)) {
      const active = container.querySelectorAll('.nav-item.active');
      expect(active.length).toBe(1);
      expect(active[0].textContent.trim()).toBe(t(`nav.${section}`, 'en'));
    }
  });
});

describe('console skin invariants: theme independence', () => {
  it.each([
    ['admin', 'light', '/admin/dashboard'],
    ['admin', 'dark', '/admin/dashboard'],
    ['admin', 'dark', '/admin/live'],
    ['farmer', 'light', '/farmer/dashboard'],
    ['farmer', 'dark', '/farmer/dashboard'],
    ['farmer', 'dark', '/farmer/systems'],
  ])('%s shell (%s theme) at %s', (role, theme, path) => {
    const { container } = renderApp(path, SESSIONS[role], theme);
    const spec = SHELL[role];

    expect(document.documentElement.getAttribute('data-theme')).toBe(theme);
    const shells = shellClassNames(container);
    expect(shells.length).toBe(1);
    expect(shells[0]).toContain(spec.cls);
    expect(shells[0]).not.toContain(spec.other);
    expect(container.querySelector('.sidebar .brand-sub').textContent.trim()).toBe(spec.sub);
    expect(hasEmoji(container.textContent)).toBe(false);
  });
});

describe('login role accents (farmer blue vs admin black)', () => {
  /* cssstyle normalises inline colours; build expected values through jsdom
     itself so the assertions compare apples with apples */
  const norm = (prop, value) => {
    const probe = document.createElement('span');
    probe.style[prop] = value;
    return probe.style[prop];
  };

  function tabFor(label) {
    return screen.getByText(label, { exact: true }).closest('.tab');
  }

  it('exactly one role carries its accent, on the active tab and the sign-in button', () => {
    const expected = {
      farmerActive: norm('borderBottomColor', '#1c3a96'),
      adminActive: norm('borderBottomColor', '#0b0f1a'),
      inactive: norm('borderBottomColor', 'transparent'),
      farmerBtn: norm('background', 'var(--brand-blue)'),
      adminBtn: norm('background', '#0b0f1a'),
    };

    renderApp('/', null); // no session -> login
    let farmerTab = tabFor('Farmer');
    let adminTab = tabFor('Afriinnox Admin');
    const signIn = screen.getByRole('button', { name: /sign in/i });

    // default mode: farmer carries the blue accent, admin none
    expect(farmerTab.style.borderBottomColor).toBe(expected.farmerActive);
    expect(adminTab.style.borderBottomColor).toBe(expected.inactive);
    expect(signIn.style.background).toBe(expected.farmerBtn);

    // switch to admin: the accent moves entirely to the admin side
    fireEvent.click(adminTab);
    farmerTab = tabFor('Farmer');
    adminTab = tabFor('Afriinnox Admin');
    expect(adminTab.style.borderBottomColor).toBe(expected.adminActive);
    expect(farmerTab.style.borderBottomColor).toBe(expected.inactive);
    expect(signIn.style.background).toBe(expected.adminBtn);

    // switch back: farmer regains it, admin loses it
    fireEvent.click(farmerTab);
    farmerTab = tabFor('Farmer');
    adminTab = tabFor('Afriinnox Admin');
    expect(farmerTab.style.borderBottomColor).toBe(expected.farmerActive);
    expect(adminTab.style.borderBottomColor).toBe(expected.inactive);
    expect(signIn.style.background).toBe(expected.farmerBtn);
  });

  it('the two accents are genuinely different from each other', () => {
    const farmer = norm('color', '#1c3a96');
    const admin = norm('color', '#0b0f1a');
    const neutral = norm('color', 'var(--text-muted)');
    expect(farmer).not.toBe(admin);
    expect(admin).not.toBe(neutral);
  });
});
