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
 *   4. HOME SCREEN HEADER — the mark closed into a plate: a ribbon of it runs along
 *      all four edges (largest and solid at the middle of each edge, smaller and
 *      fainter toward the corners). The plate sits below the icon and the product
 *      name and circles everything else, with the Afriinnox contact channels the
 *      price sheet publishes.
 *   5. THE BROWSER TAB — public/favicon.svg embeds the same supplied artwork, so
 *      the tab no longer carries the old network/activity glyph, with the 256px
 *      asset published beside it as the raster fallback and apple-touch-icon.
 */
import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import App from '../App.jsx';
import { StoreProvider } from '../lib/store.jsx';
import { buildDemoSeed } from './fixtures/demoFleet.js';
import { LANGS, t } from '../i18n/strings.js';
import brandIcon from '../assets/afriinnox-icon.png';

const KEY = 'broodiinnox_app_v1';

const SESSIONS = {
  admin: { id: 'a1', name: 'Innocent Ingabire', role: 'admin', adminRole: 'super', email: 'admin@afriinnox.com' },
  farmer: { id: 'f1', name: 'Jean Damascene', role: 'farmer', phone: '0788123456' },
};

function renderApp(initialPath, session) {
  localStorage.setItem(KEY, JSON.stringify({ ...buildDemoSeed(), session, lang: 'en', theme: 'light', reminderSent: [] }));
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

    // the wordmark beside the tile now names the product and the maker, as on the
    // home screen - the same words, in both shells
    expect(container.querySelector('.sidebar .brand-name').textContent.trim()).toBe('BROODIINNOX');
    expect(container.querySelector('.sidebar .brand-sub').textContent.trim()).toBe('by AFRIINNOX Ltd');
  });
});

describe('the home screen header: the mark closed into a plate around the words', () => {
  it('frames the header with a ribbon of the mark along all four edges', () => {
    const { container } = renderApp('/', null);
    const plate = container.querySelector('.login-plate');
    expect(plate).not.toBeNull();

    for (const edge of ['top', 'bottom', 'left', 'right']) {
      const rail = plate.querySelector(`.login-plate-rail.${edge}`);
      expect(rail, `a rail runs along the ${edge} edge`).not.toBeNull();
      const marks = [...rail.querySelectorAll('.login-plate-mark')];
      expect(marks.length, `the ${edge} edge carries a line of marks`).toBeGreaterThanOrEqual(3);
      for (const mark of marks) {
        const img = mark.querySelector('img');
        expect(img).not.toBeNull();
        expect(img.getAttribute('src')).toMatch(/afriinnox-icon/); // the real mark, not a stand-in
        expect(img.getAttribute('alt')).toBe('');                  // it repeats, so it is decoration
      }
    }

    // the frame peaks at the middle of each edge and falls away to the corners
    const top = [...plate.querySelectorAll('.login-plate-rail.top .login-plate-mark')]
      .map((m) => parseFloat(m.style.width));
    expect(Math.max(...top)).toBe(top[(top.length - 1) / 2]);
    expect(Math.min(...top)).toBe(top[0]);

    // the frame circles only what follows the mark and the product name: that block
    // stays above the plate, outside the frame
    const brandRow = container.querySelector('.login-brand').parentElement;
    expect(plate.contains(brandRow)).toBe(false);
    expect(plate.querySelector('.login-brand')).toBeNull();
    expect(plate.textContent).not.toContain('BROODIINNOX');
    expect(plate.textContent).not.toContain('by AFRIINNOX Ltd');
    // ...and the plate follows it in the document, so it reads as starting below it
    expect(brandRow.compareDocumentPosition(plate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // everything else the screen says is inside the frame
    expect(plate.querySelector('h1')).not.toBeNull();
    expect(plate.querySelector('p')).not.toBeNull();
    ['Monitor & control anywhere, anytime!', 'Every batch on record, for years', 'Professional brooding tips']
      .forEach((tx) => expect(plate.textContent, tx).toContain(tx));
    expect(plate.querySelectorAll('button').length).toBeGreaterThanOrEqual(3); // the language strip
  });

  it('leaves out how many sensors a system needs, and keeps the other promises', () => {
    renderApp('/', null);
    expect(screen.queryByText(/sensor/i)).toBeNull();
    ['Monitor & control anywhere, anytime!', 'Every batch on record, for years', 'Professional brooding tips']
      .forEach((tx) => expect(screen.getByText(tx)).toBeInTheDocument());
  });

  it('puts the Afriinnox contact channels the price sheet publishes in reach', () => {
    renderApp('/', null);

    const mail = screen.getByText('info@afriinnox.com').closest('a');
    expect(mail).not.toBeNull();
    expect(mail.getAttribute('href')).toBe('mailto:info@afriinnox.com');

    const tel = screen.getByText('+250 795 814 403').closest('a');
    expect(tel).not.toBeNull();
    expect(tel.getAttribute('href')).toBe('tel:+250795814403'); // dialable: no spaces in the number
  });
});

describe('the browser tab carries the brand mark, not the old activity glyph', () => {
  const svgPath = path.resolve(process.cwd(), 'public', 'favicon.svg');
  const pngPath = path.resolve(process.cwd(), 'public', 'afriinnox-icon.png');

  function readFavicon() {
    const svg = fs.readFileSync(svgPath, 'utf8');
    const match = svg.match(/href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/);
    return { svg, embedded: match ? Buffer.from(match[1], 'base64') : null };
  }

  it('embeds the supplied Afriinnox artwork in the tab icon', () => {
    const { svg, embedded } = readFavicon();
    expect(embedded, 'favicon.svg must embed the icon as a data URI').not.toBeNull();
    expect([...embedded.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const width = embedded.readUInt32BE(16);
    const height = embedded.readUInt32BE(20);
    expect(width).toBe(height);
    expect(width).toBeGreaterThanOrEqual(48); // still sharp when the tab scales it to 16px
    expect(svg).toContain('#1c3a96');         // set in the brand blue tile
  });

  it('no longer draws the old network / activity glyph', () => {
    const { svg } = readFavicon();
    expect(svg).not.toContain('#7fb069');             // the green activity dot
    expect(svg).not.toMatch(/<rect[^>]*x="27\.5"/); // the middle growth bar of the old mark
  });

  it('publishes the raster fallback and points the document at both', () => {
    expect(fs.existsSync(pngPath)).toBe(true);
    const shipped = fs.readFileSync(path.resolve(process.cwd(), 'src', 'assets', 'afriinnox-icon.png'));
    expect(fs.readFileSync(pngPath).equals(shipped)).toBe(true);

    const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
    expect(html).toMatch(/<link rel="icon" type="image\/svg\+xml" href="\.\/favicon\.svg" \/>/);
    expect(html).toMatch(/<link rel="apple-touch-icon" href="\.\/afriinnox-icon\.png" \/>/);
  });
});

/* ------------------------------------------------------------------ */
/* INVARIANTS                                                          */
/*                                                                     */
/* The behavioural tests above assert one rendered outcome each. These  */
/* assert what must hold for EVERY mark, EVERY edge and EVERY element   */
/* — a frame symmetric at any mark count, a ribbon that can never land  */
/* on a word, a tile whose raster is always inside it, every declared   */
/* icon resolving, every rendered contact channel being one that works. */
/* A private brand mark has no "happy path": it is correct for all of   */
/* them or it is wrong.                                                 */
/* ------------------------------------------------------------------ */

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const SVG_DOC = () =>
  new DOMParser().parseFromString(
    fs.readFileSync(path.resolve(process.cwd(), 'public', 'favicon.svg'), 'utf8'),
    'image/svg+xml'
  );

/** Every edge of the plate, with the marks the component drew on it and the geometry
 *  it derived from edgeMarks() — so the assertions can be made per edge and per index. */
function plateEdges(container) {
  const plate = container.querySelector('.login-plate');
  if (!plate) return null;
  return Object.fromEntries(['top', 'bottom', 'left', 'right'].map((edge) => {
    const rail = plate.querySelector(`.login-plate-rail.${edge}`);
    return [edge, {
      rail,
      marks: rail ? [...rail.querySelectorAll('.login-plate-mark')].map((el) => ({
        width: parseFloat(el.style.width),
        height: parseFloat(el.style.height),
        radius: parseFloat(el.style.borderRadius),
        opacity: Number(el.style.opacity),
        img: el.querySelector('img'),
      })) : [],
    }];
  }));
}

describe('INVARIANT: every mark the plate draws is a legible, decorative rounded square', () => {
  it('holds at every edge and every index, not only at the corners', () => {
    const { container } = renderApp('/', null);
    const edges = plateEdges(container);
    expect(edges).not.toBeNull();

    for (const [edge, { rail, marks }] of Object.entries(edges)) {
      expect(rail, `the ${edge} edge has a rail`).not.toBeNull();
      expect(marks.length, `the ${edge} edge carries a line of marks`).toBeGreaterThanOrEqual(3);
      expect(marks.length % 2, `the ${edge} edge is symmetric: it needs a centre`).toBe(1);

      for (const [i, m] of marks.entries()) {
        expect(m.height, `${edge}[${i}] is square`).toBe(m.width);
        expect(m.width, `${edge}[${i}] is legible`).toBeGreaterThanOrEqual(14);
        expect(m.width, `${edge}[${i}] is a mark, not a hero image`).toBeLessThanOrEqual(34);
        expect(m.radius, `${edge}[${i}] is rounded`).toBeGreaterThanOrEqual(m.width * 0.2);
        expect(m.radius, `${edge}[${i}] is a rounded square, never a circle`).toBeLessThan(m.width * 0.5);
        expect(m.opacity, `${edge}[${i}] is visible`).toBeGreaterThan(0);
        expect(m.opacity, `${edge}[${i}] is not washed out`).toBeLessThanOrEqual(1);
        expect(m.img).not.toBeNull();
        expect(m.img.getAttribute('src')).toMatch(/afriinnox-icon/); // the shipped artwork, per mark
        expect(m.img.getAttribute('alt')).toBe('');                  // it repeats, so it is decoration
      }
    }
  });

  it('peaks at the middle of every edge and falls away monotonically to both corners', () => {
    const { container } = renderApp('/', null);
    const edges = plateEdges(container);

    for (const [edge, { marks }] of Object.entries(edges)) {
      const centre = (marks.length - 1) / 2;
      const last = marks.length - 1;

      for (let i = 0; i <= last; i += 1) {
        expect(marks[i].width, `${edge} width mirrors at ${i}`).toBe(marks[last - i].width);
        expect(marks[i].opacity, `${edge} opacity mirrors at ${i}`).toBe(marks[last - i].opacity);
      }
      // walking outward from the middle of the edge: never bigger, never brighter
      for (let step = 1; step <= centre; step += 1) {
        const inner = marks[centre - step + 1];
        const outer = marks[centre - step];
        expect(outer.width, `${edge} width step ${step}`).toBeLessThanOrEqual(inner.width);
        expect(outer.opacity, `${edge} opacity step ${step}`).toBeLessThan(inner.opacity);
      }
    }
  });

  it('draws opposite edges as the same ribbon, so the square reads as one frame', () => {
    const { container } = renderApp('/', null);
    const edges = plateEdges(container);

    for (const [a, b] of [['top', 'bottom'], ['left', 'right']]) {
      expect(edges[a].marks.map((m) => m.width), `${a} and ${b}`).toEqual(edges[b].marks.map((m) => m.width));
      expect(edges[a].marks.map((m) => m.opacity), `${a} and ${b}`).toEqual(edges[b].marks.map((m) => m.opacity));
    }
  });

  it('keeps every rail inert and silent, however many marks it draws', () => {
    const { container } = renderApp('/', null);
    const edges = plateEdges(container);

    for (const [edge, { rail }] of Object.entries(edges)) {
      expect(rail.getAttribute('aria-hidden'), `the ${edge} rail is hidden`).toBe('true');
      expect(rail.textContent, `the ${edge} rail carries no words`).toBe('');
    }

    // the words the frame surrounds are still exactly the product and the maker
    const brandRow = container.querySelector('.login-brand').parentElement;
    // the row also carries the phone shortcut to the form, which is a button - so
    // the words are asserted on what is left once the buttons are taken out
    const words = [...brandRow.childNodes]
      .filter((node) => node.nodeName !== 'BUTTON')
      .map((node) => node.textContent).join('');
    expect(words).toBe('BROODIINNOXby AFRIINNOX Ltd');
  });
});

describe('the home screen on a phone', () => {
  const css = () => fs.readFileSync(path.resolve(process.cwd(), 'src', 'styles', 'global.css'), 'utf8');
  /** The declarations of one rule, by its exact selector — media overrides stripped. */
  function rule(selector) {
    const base = css().replace(/@media[^{]*\{[\s\S]*?\n\}/g, '');
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(base);
    return m ? m[1] : '';
  }
  /** Every max-width media block, with the width it fires at. */
  function breakpoints() {
    return [...css().matchAll(/@media\s*\(max-width:\s*(\d+)px\)\s*\{([\s\S]*?)\n\}/g)]
      .map((m) => ({ width: Number(m[1]), body: m[2] }));
  }

  it('keeps the layout in the stylesheet, where a phone can override it', () => {
    const { container } = renderApp('/', null);
    const shell = container.querySelector('.login-shell');

    expect(shell, 'the shell carries the layout class').not.toBeNull();
    expect(container.querySelector('.login-brand-pane')).not.toBeNull();
    expect(container.querySelector('.login-form-pane')).not.toBeNull();

    // the regression: an inline grid cannot be reflowed by a media query, which is
    // exactly what left the sign-in form off the side of a phone screen
    expect(shell.getAttribute('style') || '').not.toMatch(/grid/i);
    expect(shell.style.gridTemplateColumns).toBe('');
    expect(rule('.login-shell'), 'and the layout is styled from the stylesheet').not.toBe('');
    expect(rule('.login-brand-pane'), 'as is the brand pane').not.toBe('');
    expect(rule('.login-form-pane'), 'and the form pane').not.toBe('');
  });

  it('stacks to one column below the phone breakpoint', () => {
    expect(rule('.login-shell'), 'the desktop default is two columns').toMatch(/grid-template-columns:\s*1fr\s+1fr/);

    const shell = breakpoints().find((b) => /\.login-shell\s*\{/.test(b.body));
    expect(shell, 'a breakpoint reflows the shell').toBeDefined();
    expect(shell.body, 'and makes it one column').toMatch(/\.login-shell\s*\{[^}]*grid-template-columns:\s*1fr/);
    expect(shell.body, 'with phone padding on the brand pane').toMatch(/\.login-brand-pane\s*\{[^}]*padding:/);
    expect(shell.body, 'and on the form pane').toMatch(/\.login-form-pane\s*\{[^}]*padding:/);
  });

  it('stacks the tiles on a narrow phone, so no label is squeezed', () => {
    const tiles = breakpoints().find((b) => /\.login-promises\s*\{[^}]*grid-template-columns:\s*1fr/.test(b.body));
    expect(tiles, 'a breakpoint stacks the promise tiles').toBeDefined();
    expect(tiles.width, 'and it is a phone-width breakpoint').toBeLessThanOrEqual(700);
  });

  it('never shrinks the frame padding at any breakpoint', () => {
    // the ribbon sits in that padding: shrink it and the marks land on the words
    const blocks = breakpoints();
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const b of blocks) {
      expect(b.body, `the ${b.width}px breakpoint must leave the frame padding alone`)
        .not.toMatch(/\.login-plate\s*\{[^}]*padding:/);
    }
  });

  it('lets the phone report its own width, or no breakpoint can fire', () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
    expect(html).toMatch(/<meta name="viewport" content="width=device-width, initial-scale=1\.0" \/>/);
  });
});

describe('the composition inside the frame sits on one three-column rhythm', () => {
  /** The declarations of one rule, by its exact selector. */
  function rule(selector) {
    // media blocks can carry an override of the same selector, so strip them first:
    // reading an override as the rule would let a phone-only change masquerade as the
    // base declaration, which is exactly how a breakpoint can look like it applies
    const base = fs.readFileSync(path.resolve(process.cwd(), 'src', 'styles', 'global.css'), 'utf8')
      .replace(/@media[^{]*\{[\s\S]*?\n\}/g, '');
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(base);
    return m ? m[1] : '';
  }

  it('lays the promise tiles and the language strip on the same three equal columns', () => {
    const { container } = renderApp('/', null);
    const plate = container.querySelector('.login-plate');

    for (const sel of ['.login-promises', '.login-langs']) {
      const body = rule(sel);
      expect(body, `${sel} declares its layout`).not.toBe('');
      expect(body, `${sel} is three equal columns`).toMatch(/grid-template-columns:\s*repeat\(3,\s*1fr\)/);
    }
    expect(plate.querySelectorAll('.login-promise')).toHaveLength(3);
    expect(plate.querySelectorAll('.login-lang')).toHaveLength(3);
  });

  it('gives every tile its own icon and a label of a length', () => {
    const { container } = renderApp('/', null);
    const plate = container.querySelector('.login-plate');
    const tiles = [...plate.querySelectorAll('.login-promise')];
    expect(tiles).toHaveLength(3);

    const labels = [];
    for (const tile of tiles) {
      expect(tile.querySelector('.login-promise-icon svg[aria-hidden="true"]'), 'every tile carries its icon').not.toBeNull();
      const label = tile.querySelector('.login-promise-label');
      expect(label).not.toBeNull();
      const text = label.textContent.trim();
      labels.push(text);
      // short enough to hold two lines in its third of the row, and no more
      expect(text.length, `"${text}" must fit two lines`).toBeLessThanOrEqual(40);
    }

    // three different glyphs, one per value — not the same mark three times
    const glyphs = tiles.map((t) => t.querySelector('.login-promise-icon svg').innerHTML);
    expect(new Set(glyphs).size, 'each tile has its own icon').toBe(3);

    // and labels of a similar length, so no tile reads empty beside the others
    const lengths = labels.map((t) => t.length);
    expect(Math.max(...lengths) - Math.min(...lengths), 'the labels are of a length').toBeLessThanOrEqual(12);
    expect(new Set(labels).size, 'three distinct values, not one repeated').toBe(3);
  });

  it('centres everything inside the frame', () => {
    renderApp('/', null);

    expect(rule('.login-plate'), 'the frame centres what it holds').toMatch(/text-align:\s*center/);
    expect(rule('.login-plate-line'), 'the one line is centred as a block').toMatch(/margin:\s*0 auto/);
    expect(rule('.login-promise'), 'each tile centres its icon and label').toMatch(/align-items:\s*center/);
    expect(rule('.login-promise'), 'and its text').toMatch(/text-align:\s*center/);
    expect(rule('.login-lang'), 'the language pills centre their text').toMatch(/text-align:\s*center/);
    for (const sel of ['.login-plate', '.login-plate-line', '.login-promise', '.login-lang']) {
      expect(rule(sel), `${sel} is styled`).not.toBe('');
    }
  });

  it('names exactly one language as current, and never more', () => {
    const { container } = renderApp('/', null);
    const plate = container.querySelector('.login-plate');
    const current = [...plate.querySelectorAll('.login-lang')].filter((b) => b.classList.contains('on'));
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute('aria-pressed')).toBe('true');
    expect([...plate.querySelectorAll('.login-lang')].map((b) => b.textContent)).toEqual(['English', 'Français', 'Kinyarwanda']);
  });

  it('switches the page for every language in the strip, one language at a time', () => {
    const { container } = renderApp('/', null);
    const plate = container.querySelector('.login-plate');
    const pills = () => [...plate.querySelectorAll('.login-lang')];
    const current = () => pills().filter((b) => b.classList.contains('on'));

    expect(current().map((b) => b.textContent)).toEqual(['English']); // the default the app ships

    // every language the strip offers, not just the one a happy path would pick
    for (const lang of LANGS) {
      const pill = pills().find((b) => b.textContent === lang.label);
      expect(pill, `${lang.label} is offered`).toBeDefined();
      fireEvent.click(pill);

      expect(current(), `exactly one language is current after choosing ${lang.label}`).toHaveLength(1);
      expect(current()[0].textContent).toBe(lang.label);
      expect(pills().filter((b) => b.getAttribute('aria-pressed') === 'true'), 'and only one is pressed').toHaveLength(1);
      expect(pills().find((b) => b.textContent === lang.label).getAttribute('aria-pressed')).toBe('true');

      // the choice reaches the words inside the frame, not just the pill
      expect(container.querySelector('.login-plate h1').textContent).toBe(t('app.subtitle', lang.code));
    }
  });
});

describe('INVARIANT: the frame can never land on the words it surrounds', () => {
  const css = () => fs.readFileSync(path.resolve(process.cwd(), 'src', 'styles', 'global.css'), 'utf8');

  /** The declarations of one rule, by its exact selector — media overrides stripped. */
  function rule(selector) {
    const base = css().replace(/@media[^{]*\{[\s\S]*?\n\}/g, '');
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(base);
    return m ? m[1] : '';
  }
  const px = (body, prop) => {
    const m = new RegExp(`(?:^|[;\\s])${prop}:\\s*(-?[\\d.]+)px`).exec(body);
    return m ? Number(m[1]) : null;
  };

  it('sizes every rail so inset + largest mark stays inside the plate padding', () => {
    const { container } = renderApp('/', null);
    const edges = plateEdges(container);

    const padding = /padding:\s*([\d.]+)px(?:\s+([\d.]+)px)?/.exec(rule('.login-plate'));
    expect(padding, '.login-plate declares its padding').not.toBeNull();
    const padY = Number(padding[1]);                      // the words start this far in
    const padX = Number(padding[2] ?? padding[1]);
    expect(padY, '.login-plate declares a real vertical padding').toBeGreaterThan(0);
    expect(padX, '.login-plate declares a real horizontal padding').toBeGreaterThan(0);

    const largest = (edge) => Math.max(...edges[edge].marks.map((m) => m.width));

    // every number is read out of the stylesheet, so a declaration the parser misses
    // must fail loudly rather than compare as zero and pass for nothing
    for (const edge of ['top', 'bottom', 'left', 'right']) {
      const gap = px(rule(`.login-plate-rail.${edge}`), edge);
      expect(typeof gap, `.login-plate-rail.${edge} declares its ${edge} inset`).toBe('number');
      const limit = edge === 'top' || edge === 'bottom' ? padY : padX;
      // a rail that reached further than the padding would draw the ribbon over a word
      expect(gap + largest(edge), `${edge} edge stays in the padding`).toBeLessThanOrEqual(limit);
      expect(largest(edge), `the ${edge} edge really drew marks`).toBeGreaterThan(0);
    }
  });

  it('declares the rails inert, so the ribbon can never swallow a click', () => {
    expect(rule('.login-plate-rail')).toMatch(/pointer-events:\s*none/);
  });
});

describe('INVARIANT: the tab icon is a well-formed SVG with its image really inside it', () => {
  it('parses as XML — an SVG favicon that does not parse is a blank tab', () => {
    const doc = SVG_DOC();
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.documentElement.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(doc.documentElement.getAttribute('viewBox')).toBe('0 0 64 64');
    // every node must be in the SVG namespace, or the browser renders it as nothing
    for (const el of doc.getElementsByTagName('*')) {
      expect(el.namespaceURI, `${el.nodeName} is an SVG element`).toBe('http://www.w3.org/2000/svg');
    }
  });

  it('carries exactly one raster, and it decodes to a real PNG', () => {
    const doc = SVG_DOC();
    const imgs = [...doc.getElementsByTagName('image')];
    expect(imgs).toHaveLength(1);

    // self-contained by construction: a data URI can never 404 on the live site
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(imgs[0].getAttribute('href'));
    expect(match, 'the mark is embedded, not referenced').not.toBeNull();

    const bytes = Buffer.from(match[1], 'base64');
    expect([...bytes.subarray(0, 8)]).toEqual(PNG_SIG);
    expect(bytes.subarray(bytes.length - 8).toString('latin1')).toContain('IEND'); // not truncated

    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    expect(width).toBe(height);
    expect(width).toBeGreaterThanOrEqual(48);  // still sharp when the tab scales it to 16px
    expect(width).toBeLessThanOrEqual(256);    // and not a megabyte of icon in a tab
  });

  it('places that raster inside the tile and grounds it on the brand blue', () => {
    const doc = SVG_DOC();
    const [, , vbWidth, vbHeight] = doc.documentElement.getAttribute('viewBox').split(/\s+/).map(Number);
    const img = doc.getElementsByTagName('image')[0];
    const x = Number(img.getAttribute('x'));
    const y = Number(img.getAttribute('y'));
    const width = Number(img.getAttribute('width'));
    const height = Number(img.getAttribute('height'));

    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + width).toBeLessThanOrEqual(vbWidth);   // nothing spills outside the tile
    expect(y + height).toBeLessThanOrEqual(vbHeight);
    expect(width).toBeGreaterThan(vbWidth * 0.5);     // the mark is the subject of the icon
    expect(height).toBeGreaterThan(vbHeight * 0.5);

    const ground = [...doc.getElementsByTagName('rect')].some(
      (r) => Number(r.getAttribute('width')) === vbWidth && Number(r.getAttribute('height')) === vbHeight
    );
    expect(ground, 'the tile has a full-bleed ground behind the mark').toBe(true);
  });
});

describe('INVARIANT: every icon and every contact channel the home screen declares resolves', () => {
  it('every declared icon points at a file that exists, at the size it claims', () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const links = [
      ...doc.querySelectorAll('link[rel~="icon"]'),
      ...doc.querySelectorAll('link[rel="apple-touch-icon"]'),
    ];
    expect(links.length).toBeGreaterThanOrEqual(1);

    for (const link of links) {
      const href = (link.getAttribute('href') || '').replace(/^\.\//, '');
      const file = path.resolve(process.cwd(), 'public', href);
      expect(fs.existsSync(file), `${href} is declared but not published`).toBe(true);
      expect(fs.statSync(file).size, `${href} is not an empty placeholder`).toBeGreaterThan(1000);

      if (link.getAttribute('type') === 'image/png') {
        const buf = fs.readFileSync(file);
        expect([...buf.subarray(0, 8)], `${href} really is a PNG`).toEqual(PNG_SIG);
        const sizes = link.getAttribute('sizes');
        if (sizes) {
          const [w, h] = sizes.split('x').map(Number);
          expect(buf.readUInt32BE(16), `${href} is ${sizes} as declared`).toBe(w);
          expect(buf.readUInt32BE(20), `${href} is ${sizes} as declared`).toBe(h);
        }
      }
    }
  });

  it('every contact channel on the home screen is one a farmer can actually use', () => {
    const { container } = renderApp('/', null);
    const anchors = [...container.querySelectorAll('.login-contact a')];
    expect(anchors.length).toBeGreaterThan(0);

    for (const a of anchors) {
      const href = a.getAttribute('href');
      const label = a.textContent.trim();
      expect(label.length, 'never an empty link').toBeGreaterThan(0);
      expect(a.querySelector('svg[aria-hidden="true"]'), `${label} carries an icon`).not.toBeNull();

      if (href.startsWith('mailto:')) {
        expect(href, 'what you see is what it addresses').toBe(`mailto:${label}`);
        expect(label).toMatch(/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i);
      } else if (href.startsWith('tel:')) {
        expect(href, `${label} must be dialable: no spaces or punctuation`).toMatch(/^tel:\+\d{7,15}$/);
        expect(href.replace(/\D/g, ''), `${label} dials the number it shows`).toBe(label.replace(/\D/g, ''));
      } else {
        throw new Error(`contact channel "${href}" is neither a mail nor a phone link`);
      }
    }

    // exactly the two channels the price sheet publishes: nothing stray, nothing missing
    expect(anchors.map((a) => a.getAttribute('href')).sort())
      .toEqual(['mailto:info@afriinnox.com', 'tel:+250795814403']);
  });
});
