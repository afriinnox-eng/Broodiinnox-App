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
 *   4. HOME SCREEN HEADER — beside the icon and the wording, one line of the mark
 *      (a crest: largest and solid in the centre, smaller and fainter outward),
 *      and the Afriinnox contact channels the price sheet publishes.
 *   5. THE BROWSER TAB — public/favicon.svg embeds the same supplied artwork, so
 *      the tab no longer carries the old network/activity glyph, with the 256px
 *      asset published beside it as the raster fallback and apple-touch-icon.
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

describe('the home screen header: one line of the brand mark', () => {
  it('draws the crest of marks beside the icon and the wording, fading outward', () => {
    const { container } = renderApp('/', null);
    const crest = container.querySelector('.login-crest');
    expect(crest).not.toBeNull();

    const marks = [...crest.querySelectorAll('.login-crest-mark')];
    expect(marks).toHaveLength(7);
    for (const mark of marks) {
      const img = mark.querySelector('img');
      expect(img).not.toBeNull();
      expect(img.getAttribute('src')).toMatch(/afriinnox-icon/); // the real mark, not a stand-in
      expect(img.getAttribute('alt')).toBe('');                  // it repeats, so it is decoration, not content
    }

    const widths = marks.map((m) => parseFloat(m.style.width));
    const opacities = marks.map((m) => Number(m.style.opacity));
    expect(widths[3]).toBe(Math.max(...widths));  // biggest in the middle
    expect(widths[0]).toBe(Math.min(...widths));  // smallest at the edges
    expect(opacities[3]).toBe(1);
    expect(opacities[0]).toBeLessThan(0.5);
    expect(widths).toEqual([...widths].reverse());          // a crest, not a sequence
    expect(opacities).toEqual([...opacities].reverse());

    // it sits in the same header block as the icon and the product wording
    const brandRow = container.querySelector('.login-brand').parentElement;
    expect(crest.parentElement).toBe(brandRow.parentElement);
    expect(brandRow.textContent).toContain('BROODIINNOX');
    expect(container.querySelector('.login-brand').contains(crest)).toBe(false);
  });

  it('leaves out how many sensors a system needs, and keeps the other promises', () => {
    renderApp('/', null);
    expect(screen.queryByText(/sensor/i)).toBeNull();
    ['Automatic failsafe heating', 'Remote control & live alerts', 'MTN MoMo subscriptions']
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
/* assert what must hold for EVERY mark, EVERY index and EVERY element  */
/* — a crest that is symmetric at any length, a tile whose raster is    */
/* always inside it, every declared icon resolving, every rendered      */
/* contact channel being one that works. A private brand mark has no    */
/* "happy path": it is correct for all of them or it is wrong.         */
/* ------------------------------------------------------------------ */

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const SVG_DOC = () =>
  new DOMParser().parseFromString(
    fs.readFileSync(path.resolve(process.cwd(), 'public', 'favicon.svg'), 'utf8'),
    'image/svg+xml'
  );

/** Every mark the crest drew, in document order, with the geometry the component
 *  derives from BRAND_CREST — so the assertions below can be made per index. */
function crestMarks(container) {
  const crest = container.querySelector('.login-crest');
  if (!crest) return null;
  return [...crest.querySelectorAll('.login-crest-mark')].map((el) => ({
    width: parseFloat(el.style.width),
    height: parseFloat(el.style.height),
    radius: parseFloat(el.style.borderRadius),
    opacity: Number(el.style.opacity),
    lift: Number((el.style.transform.match(/translateY\((-?[\d.]+)px\)/) || [])[1]),
    img: el.querySelector('img'),
  }));
}

describe('INVARIANT: every mark the crest draws is a legible, decorative rounded square', () => {
  it('holds at every index of the row, not only at the two ends', () => {
    const { container } = renderApp('/', null);
    const marks = crestMarks(container);
    expect(marks).not.toBeNull();
    expect(marks.length).toBeGreaterThanOrEqual(5); // a line of marks, not a single tile
    expect(marks.length % 2).toBe(1);               // a crest is symmetric: it needs a centre

    for (const [i, m] of marks.entries()) {
      expect(m.height, `mark ${i} is square`).toBe(m.width);
      expect(m.width, `mark ${i} is legible`).toBeGreaterThanOrEqual(16);
      expect(m.width, `mark ${i} is a mark, not a hero image`).toBeLessThanOrEqual(40);
      expect(m.radius, `mark ${i} is rounded`).toBeGreaterThanOrEqual(m.width * 0.2);
      expect(m.radius, `mark ${i} is a rounded square, never a circle`).toBeLessThan(m.width * 0.5);
      expect(m.opacity, `mark ${i} is visible`).toBeGreaterThan(0);
      expect(m.opacity, `mark ${i} is not washed out`).toBeLessThanOrEqual(1);
      expect(Number.isFinite(m.lift), `mark ${i} is placed on the rule`).toBe(true);
      expect(m.img).not.toBeNull();
      expect(m.img.getAttribute('src')).toMatch(/afriinnox-icon/); // the shipped artwork, per mark
      expect(m.img.getAttribute('alt')).toBe('');                  // it repeats, so it is decoration
    }
  });

  it('is symmetric and fades monotonically outward at every index', () => {
    const { container } = renderApp('/', null);
    const marks = crestMarks(container);
    const centre = (marks.length - 1) / 2;
    const last = marks.length - 1;

    for (let i = 0; i <= last; i += 1) {
      expect(marks[i].width, `width mirrors at ${i}`).toBe(marks[last - i].width);
      expect(marks[i].opacity, `opacity mirrors at ${i}`).toBe(marks[last - i].opacity);
      expect(marks[i].lift, `placement mirrors at ${i}`).toBe(marks[last - i].lift);
    }
    // walking outward from the centre: never bigger, never brighter
    for (let step = 1; step <= centre; step += 1) {
      const inner = marks[centre - step + 1];
      const outer = marks[centre - step];
      expect(outer.width, `width step ${step}`).toBeLessThanOrEqual(inner.width);
      expect(outer.opacity, `opacity step ${step}`).toBeLessThan(inner.opacity);
    }
  });

  it('adds nothing to the header however many marks it draws', () => {
    const { container } = renderApp('/', null);
    const crest = container.querySelector('.login-crest');
    expect(crest.getAttribute('aria-hidden')).toBe('true');
    expect(crest.textContent).toBe(''); // no words in the crest, at any count

    // the header still announces exactly the product and the maker, and nothing else
    const brandRow = container.querySelector('.login-brand').parentElement;
    expect(brandRow.textContent).toBe('BROODIINNOXby AFRIINNOX Ltd');
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
