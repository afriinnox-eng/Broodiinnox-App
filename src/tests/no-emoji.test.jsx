/**
 * Brand-integrity invariants for the emoji -> SVG icon cleanup (commit 3a2f35c).
 *
 * The deployed app used to render 200+ pictographic emoji glyphs (the "AI
 * generated" look) scattered through the sidebar, dashboards, cards, badges
 * and buttons. They were replaced with the hand-drawn stroke icon set in
 * src/components/icons.jsx. These tests pin down the invariants that change
 * must satisfy, for EVERY source file / EVERY icon / EVERY rendered slot:
 *
 *   1. Source hygiene  — no emoji/pictographic glyphs anywhere in the shipped
 *      source (index.html, public/, src/). Typography (dashes, bullets,
 *      degrees, accented letters) and the data-only arrows ("before -> after",
 *      "34 C -> 35 C" audit notation) are deliberately allowed and asserted
 *      NOT to be flagged by the predicate.
 *
 *   2. Icon set integrity — every glyph in the set renders a real, non-empty,
 *      stroke-based SVG on the 24x24 grid. A broken glyph would otherwise
 *      render silently.
 *
 *   3. Rendered slot integrity — every icon-bearing slot in the rendered app
 *      (nav items, stat tiles, empty states, icon buttons, contact rows)
 *      actually contains an SVG with drawing content, and every <svg> in the
 *      DOM is well-formed. Because <Icon> renders null for an unknown name,
 *      a typo'd or missing icon reference shows up here as a missing svg.
 */
import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App.jsx';
import { StoreProvider } from '../lib/store.jsx';
import { buildSeed } from '../lib/seed.js';
import Icon, { ICON_NAMES } from '../components/icons.jsx';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, sep, resolve } from 'node:path';

// vitest runs from the project root; keep it stable regardless of import rewriting
const ROOT = resolve(process.cwd());
const KEY = 'broodiinnox_app_v1';

/* ------------------------------------------------------------------ */
/* 1. Source hygiene                                                   */
/* ------------------------------------------------------------------ */

const FLAGGED_RANGES = [
  [0x1f000, 0x1faff], // pictographs: animals, food, symbols, "squared" glyphs (the old chicken/fire/chart look)
  [0x1f1e6, 0x1f1ff], // regional-indicator letters (flags)
  [0x2600, 0x27bf],   // misc symbols & dingbats: check marks, crosses, warning, stars, weather
  [0x2b00, 0x2bff],   // heavy arrows / geometric emoji
  [0x2300, 0x23ff],   // technical & clock emoji (hourglass, watch)
  [0xfe00, 0xfe0f],   // variation selectors that force emoji presentation
];

function isFlagged(cp) {
  return FLAGGED_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
}

function collectFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', '.git'].includes(entry.name)) walk(p);
      } else if (/\.(jsx?|tsx?|css|svg|html)$/.test(entry.name)) {
        out.push(p);
      }
    }
  };
  walk(join(ROOT, 'src'));
  if (statSync(join(ROOT, 'public')).isDirectory()) walk(join(ROOT, 'public'));
  out.push(join(ROOT, 'index.html'));
  // do not let the test suite inspect itself
  return out.filter((p) => !p.includes(sep + 'tests' + sep));
}

function flaggedHits() {
  const hits = [];
  for (const file of collectFiles()) {
    const text = readFileSync(file, 'utf8');
    let line = 1;
    for (let i = 0; i < text.length; ) {
      const cp = text.codePointAt(i);
      if (isFlagged(cp)) {
        hits.push(`${file}:${line} U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
      }
      if (cp === 0x0a) line += 1;
      i += cp > 0xffff ? 2 : 1;
    }
  }
  return hits;
}

describe('source hygiene: no emoji / pictographic glyphs', () => {
  it('flags the glyph classes that made the old UI look AI-generated', () => {
    // the predicate must fire on the 202 glyphs that were removed (sample of the removed set)
    const removed = [0x1f525, 0x1f4ca, 0x1f423, 0x1f33e, 0x1f468, 0x2699, 0x1f514, 0x1f4b3,
      0x2728, 0x2705, 0x1f534, 0x1f7e0, 0x1f7e2, 0x1f535, 0x1f512, 0x1f6e0, 0x23f3,
      0x1f4f2, 0x1f550, 0x1f4a1, 0x1f321, 0x1f4de, 0x1f3ab, 0x1f44b, 0x2713, 0x2714, 0x2b07, 0xfe0f];
    for (const cp of removed) expect(isFlagged(cp), `U+${cp.toString(16)} must be flagged`).toBe(true);
  });

  it('does not flag legitimate typography and data-only arrows', () => {
    // these DO legitimately appear in the source today and must stay allowed
    const allowed = ['\u2013', '\u2014', '\u2026', '\u2022', '\u00b7', '\u00b0', '\u00e9',
      '\u2192', '\u2190', '\u2264', '\u2212', '\u00d7', '\u2019'];
    for (const ch of allowed) {
      expect(isFlagged(ch.codePointAt(0)), `${JSON.stringify(ch)} must NOT be flagged`).toBe(false);
    }
  });

  it('contains none of those glyphs in any shipped source file', () => {
    const hits = flaggedHits();
    expect(hits, `emoji-like glyphs found:\n${hits.join('\n')}`).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Icon set integrity                                               */
/* ------------------------------------------------------------------ */

describe('icon set integrity: every glyph renders a real stroke SVG', () => {
  it.each(ICON_NAMES)('Icon "%s" renders a non-empty 24x24 stroke svg', (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    const inner = svg.innerHTML.trim();
    expect(inner.length, `${name} drew nothing`).toBeGreaterThan(0);
    expect(svg.querySelector('path, polyline, rect, circle, line, polygon')).not.toBeNull();
  });

  it('every icon name referenced at a literal prop site resolves to a real glyph', () => {
    // <Icon name="x">, <Stat icon="x"> / <EmptyState icon="x">, and the `icon = 'box'`
    // default parameter are unambiguous literal references we can scan exhaustively.
    const patterns = [
      /<Icon\s+name=["']([A-Za-z]+)["']/g,
      /<(?:Stat|EmptyState)\s+icon=["']([A-Za-z]+)["']/g,
      /\bicon\s*=\s*['"]([A-Za-z]+)['"]/g, // default props e.g. EmptyState({ icon = 'box' })
    ];
    const refs = new Set();
    for (const file of collectFiles()) {
      const text = readFileSync(file, 'utf8');
      for (const re of patterns) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text))) refs.add(m[1]);
      }
    }
    expect(refs.size).toBeGreaterThan(10); // the scan actually found the UI's icon names
    const missing = [...refs].filter((n) => !ICON_NAMES.includes(n));
    expect(missing, `icon names with no glyph in the set: ${missing.join(', ')}`).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Rendered slot integrity (whole app, both roles)                  */
/* ------------------------------------------------------------------ */

function seedWithSession(session) {
  return { ...buildSeed(), session, lang: 'en', theme: 'light', reminderSent: [] };
}

function renderApp(initialEntries = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <StoreProvider>
        <App />
      </StoreProvider>
    </MemoryRouter>
  );
}

/** Every icon-bearing slot must have an Icon svg; every Icon svg must be well-formed
 *  and drawn. Chart svgs (LineChart/legend dots) do not follow the icon contract and
 *  are only required to have drawn something. */
function assertIconSlots(container) {
  // slots that always carry exactly one <Icon> when present
  for (const sel of ['.nav-item', '.stat-icon', '.empty-icon', '.icon-btn']) {
    container.querySelectorAll(sel).forEach((el) => {
      const count = el.querySelectorAll('svg[aria-hidden="true"]').length;
      expect(count, `${sel} "${el.textContent.trim().slice(0, 40)}" must render its icon`).toBeGreaterThan(0);
    });
  }
  // every Icon-produced svg anywhere in the view is a real 24x24 stroke glyph with content
  const icons = container.querySelectorAll('svg[aria-hidden="true"]');
  expect(icons.length).toBeGreaterThan(0);
  icons.forEach((svg) => {
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.innerHTML.trim().length).toBeGreaterThan(0);
  });
  // non-icon svgs (charts, legend dots) are not icons but must still be drawn
  container.querySelectorAll('svg:not([aria-hidden])').forEach((svg) => {
    expect(svg.innerHTML.trim().length, 'non-icon svg drew nothing').toBeGreaterThan(0);
  });
}

beforeEach(() => {
  localStorage.clear();
});

describe('rendered slot integrity: no silent missing icons in the live UI', () => {
  it('farmer app: dashboard, then support page', async () => {
    const { container } = renderApp();
    // login page itself renders brand feature icons (cpu/flame/wifi/card) — assert them
    expect(container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(4);
    assertIconSlots(container);

    fireEvent.click(screen.getByRole('button', { name: /demo farmer/i }));
    await screen.findByText(/Dashboard, Jean/i);
    assertIconSlots(container);

    // navigate to Support, then to the "How to reach us" tab where contact rows render
    fireEvent.click(screen.getByText('Support', { selector: '.nav-item' }));
    fireEvent.click(await screen.findByText('How to reach us'));
    await screen.findByText('KN 112 St, Kigali, Rwanda');
    assertIconSlots(container);
  });

  it('admin app: dashboard with stat tiles, then the live network page', async () => {
    const { container } = renderApp();
    fireEvent.click(screen.getByText(/Afriinnox Admin/));
    fireEvent.click(screen.getByRole('button', { name: /demo admin/i }));
    await waitFor(() => expect(screen.getByText(/Revenue today/i)).toBeInTheDocument());
    assertIconSlots(container);

    // admin Live Monitoring: pulse chip + per-system heater icons
    fireEvent.click(screen.getByText('Live Monitoring', { selector: '.nav-item' }));
    await screen.findByText('LIVE');
    assertIconSlots(container);
  });

  it('icons referenced by deep links render (cold start on a system page)', async () => {
    localStorage.setItem(KEY, JSON.stringify(seedWithSession({ id: 'f1', name: 'Jean Damascene', role: 'farmer', phone: '0788123456' })));
    const { container } = renderApp(['/farmer/systems/BRD001']);
    await screen.findByText(/Broodiinnox — Main Farm/i);
    assertIconSlots(container);
    // heater control buttons carry flame/refresh/clock icons
    expect(container.querySelectorAll('.btn svg[aria-hidden="true"]').length).toBeGreaterThanOrEqual(3);
  });
});
