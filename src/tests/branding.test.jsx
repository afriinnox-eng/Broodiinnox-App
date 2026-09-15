/**
 * Branding invariants: the app's brand mark is the real Afriinnox icon.
 *
 * The supplied artwork ("Afriinnox  Icon.jpg") is a 700x600 JPEG on a white
 * background; it is baked into src/assets/afriinnox-icon.png (cropped to the
 * artwork's bounding box, padded to a square, resized to 256px for retina) and
 * imported by the two brand tiles — the login home screen and the shell
 * sidebar. Both tiles used to render the letter "A", a placeholder.
 *
 * The properties asserted here:
 *
 *   1. THE SHIPPED ASSET IS REAL — the PNG exists, carries the PNG signature,
 *      is square (so the round-cornered tile never distorts the mark) and is
 *      large enough to stay sharp at the 38–54px it is displayed at.
 *   2. HOME SCREEN — the login screen renders the icon, and the placeholder
 *      letter is gone.
 *   3. EVERY SHELL — on the farmer home and the admin home (and other routes)
 *      the sidebar tile renders the icon and carries no letter, while the
 *      AFRIINNOX wordmark beside it is untouched.
 */
import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import App from '../App.jsx';
import { StoreProvider } from '../lib/store.jsx';
import { buildSeed } from '../lib/seed.js';
import brandIcon from '../assets/afriinnox-icon.png';

const KEY = 'broodiinnox_app_v1';

const SESSIONS = {
  admin: { id: 'a1', name: 'Innocent Ingabire', role: 'admin', adminRole: 'super', email: 'admin@afriinnox.com' },
  farmer: { id: 'f1', name: 'Jean Damascene', role: 'farmer', phone: '0788123456' },
};

function renderApp(initialPath, session) {
  localStorage.setItem(KEY, JSON.stringify({ ...buildSeed(), session, lang: 'en', theme: 'light', reminderSent: [] }));
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <StoreProvider>
        <App />
      </StoreProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('brand asset: the supplied Afriinnox icon ships with the app', () => {
  const file = path.resolve(process.cwd(), 'src', 'assets', 'afriinnox-icon.png');

  it('is a real, square, retina-sized PNG — not a broken path or a placeholder', () => {
    expect(fs.existsSync(file)).toBe(true);
    const buf = fs.readFileSync(file);
    expect([...buf.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // IHDR stores width and height big-endian at bytes 16..24
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    expect(width).toBe(height);
    expect(width).toBeGreaterThanOrEqual(128);
    expect(fs.statSync(file).size).toBeGreaterThan(1000);
  });

  it('resolves to a URL the components can render', () => {
    expect(typeof brandIcon).toBe('string');
    expect(brandIcon).toContain('afriinnox-icon');
  });
});

describe('the icon is the brand mark on the home screen', () => {
  const ICON = /afriinnox-icon/;

  it('replaces the letter placeholder on the login home screen', () => {
    const { container } = renderApp('/', null);
    const tile = container.querySelector('.login-brand');
    expect(tile).not.toBeNull();

    const img = tile.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toMatch(ICON);
    expect(img.getAttribute('alt')).toBe('Afriinnox');

    // the old behaviour: a bare "A" drawn as text inside the tile
    expect(tile.textContent.trim()).toBe('');
  });

  it('names Broodiinnox as the product and Afriinnox as the maker, beside the icon', () => {
    const { container } = renderApp('/', null);

    expect(screen.getByText('BROODIINNOX')).toBeInTheDocument();
    expect(screen.getByText('by AFRIINNOX Ltd')).toBeInTheDocument();

    // the wording this replaced is gone from the home screen
    expect(screen.queryByText('AFRIINNOX')).toBeNull();
    expect(screen.queryByText(/Broodiinnox Smart Brooding/)).toBeNull();

    // and it is the block that sits with the icon, not somewhere else on the page
    const head = container.querySelector('.login-brand').parentElement;
    expect(head.textContent).toContain('BROODIINNOX');
    expect(head.textContent).toContain('by AFRIINNOX Ltd');
  });

  it.each([
    ['farmer', '/farmer/dashboard'],
    ['farmer', '/farmer/systems'],
    ['admin', '/admin/dashboard'],
    ['admin', '/admin/live'],
  ])('carries the icon in the sidebar of the %s shell at %s', (role, route) => {
    const { container } = renderApp(route, SESSIONS[role]);

    const mark = container.querySelector('.sidebar .brand-mark');
    expect(mark).not.toBeNull();

    const img = mark.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toMatch(ICON);
    expect(mark.textContent.trim()).toBe('');

    // the wordmark and role line beside the tile are unchanged
    expect(container.querySelector('.sidebar .brand-name').textContent.trim()).toBe('AFRIINNOX');
    expect(container.querySelector('.sidebar .brand-sub').textContent.trim())
      .toBe(role === 'admin' ? 'Operations Console' : 'Broodiinnox');
  });
});
