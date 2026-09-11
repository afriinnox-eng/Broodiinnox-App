/**
 * One functional check of the ASSEMBLED app: build dist/, serve it, fetch the
 * entry point and its bundle over HTTP, execute it, and drive the AUT/MAN
 * control the way a farmer does. Units passing proves the pieces work; this
 * proves they are wired into one program a user can actually operate.
 *
 * jsdom cannot execute `type="module"` scripts, so the bundle (checked below:
 * no ESM syntax left after the build) is executed as a classic script against
 * the real index.html. Same code, same entry point.
 *
 *   node _verify_bundle.mjs
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { extname, join } from 'node:path';

const DIST = 'dist';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const fail = (msg) => { console.error(`[bundle] FAIL: ${msg}`); process.exit(1); };

/* 1. build the real production bundle */
const build = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { stdio: 'inherit' });
if (build.status !== 0) fail('the production build did not succeed');

/* 2. serve dist/ like the deployed static site (SPA rewrite included) */
const server = createServer(async (req, res) => {
  const path = decodeURIComponent((req.url || '/').split('?')[0]);
  try {
    const file = join(DIST, path === '/' ? 'index.html' : path);
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(await readFile(join(DIST, 'index.html')));
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

/* 3. fetch the entry point and its bundle exactly as a browser would */
const html = await (await fetch(base)).text();
const src = /<script[^>]*src="([^"]+)"[^>]*><\/script>/.exec(html)?.[1];
if (!src) fail('the served index.html has no bundle to load');
const res = await fetch(new URL(src, base));
const code = await res.text();
console.log(`[bundle] served ${src}: HTTP ${res.status}, ${code.length} chars`);
if (/^\s*(import|export)\s/m.test(code)) fail('the bundle is ESM and cannot be executed here');

/* 4. execute it against the real markup */
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => console.error('[jsdom error]', e.message));
vc.on('error', (...a) => console.error('[app console.error]', ...a));
const dom = new JSDOM(html, { url: base, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;
const doc = window.document;
// The build has no VITE_IOT_API_URL, so it runs the seeded fleet. If a build
// ever carried a live URL, an absent fetch must not blank the page.
window.fetch = () => Promise.reject(new Error('offline in verification'));
window.eval(code);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(label, fn, ms = 8000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const out = fn();
    if (out) return out;
    if (Date.now() > deadline) fail(`timed out waiting for ${label} (body: ${JSON.stringify(doc.body.textContent.slice(0, 120))})`);
    await sleep(25);
  }
}
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
const byText = (sel, re) => [...doc.querySelectorAll(sel)].find((el) => re.test(el.textContent || ''));

/* 5. sign in as a farmer, open My Systems — the path a user takes */
await waitFor('the app to mount the login screen', () => doc.querySelector('form, .login-card, h1'));
console.log('[bundle] entry point mounted:', JSON.stringify(doc.querySelector('h1')?.textContent ?? doc.body.textContent.trim().slice(0, 40)));
click(await waitFor('the demo-farmer button', () => byText('button', /demo farmer/i)));

click(await waitFor('the app shell after sign-in', () => doc.querySelector('a[href="#/farmer/systems"]')));
await waitFor('the My Systems page', () => doc.querySelector('[data-mode-device-id]'));
console.log('[bundle] page rendered:', JSON.stringify(doc.querySelector('h1')?.textContent));

/* 6. assert on what the assembled program actually shows */
const id = doc.querySelector('[data-mode-device-id]').getAttribute('data-mode-device-id');
const modeBtn = (m) => doc.querySelector(`[data-mode-device-id="${id}"][data-mode="${m}"]`);
const sw = () => doc.querySelector(`[data-device-id="${id}"]`);
console.log(`[bundle] device under test: ${id}`);
console.log(`[bundle] mode controls: ${doc.querySelectorAll('[data-mode-device-id]').length}, switches: ${doc.querySelectorAll('[data-device-id]').length}`);
console.log(`[bundle] initial: AUT/MAN pressed=${modeBtn('auto')?.getAttribute('aria-pressed')}/${modeBtn('manual')?.getAttribute('aria-pressed')} switch disabled=${sw()?.disabled} text=${JSON.stringify(sw()?.textContent)}`);

// Mode (AUT/MAN) must sit to the RIGHT of the System (ON/OFF) button: one row,
// switch first.
const row = sw()?.closest('.power-controls');
const follows = (a, b) => (a.compareDocumentPosition(b) & window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const placed = !!row && modeBtn('auto')?.closest('.power-controls') === row && follows(sw(), modeBtn('auto'));
console.log(`[bundle] placement: SYSTEM and MODE share one row=${!!row}, switch is the left-hand control=${placed}, labels=${JSON.stringify([...row.querySelectorAll('.power-switch-label')].map((e) => e.textContent))}`);
if (!placed) fail('Mode (AUT/MAN) is not rendered to the right of the System (ON/OFF) button');

if (modeBtn('auto')?.getAttribute('aria-pressed') !== 'true') fail('the system does not start in AUT');
if (sw()?.disabled !== true) fail('the switch is usable in AUT, where the system switches the heater itself');

/* 7. operate it: MAN, then OFF and ON again — the reported bug, end to end */
click(modeBtn('manual'));
await waitFor('MAN to make the switch usable', () => sw().disabled === false);
console.log(`[bundle] after MAN: switch disabled=${sw().disabled} text=${JSON.stringify(sw().textContent)} held-on warning=${/until you switch it off/.test(doc.body.textContent)}`);
if (modeBtn('manual')?.getAttribute('aria-pressed') !== 'true') fail('MAN is not shown as the selected mode');

click(sw());
click(await waitFor('the OFF confirmation dialog', () => byText('button', /yes, switch off/i)));
await waitFor('the heater to be held off', () => sw().getAttribute('aria-checked') === 'false');
console.log(`[bundle] after OFF: aria-checked=${sw().getAttribute('aria-checked')} text=${JSON.stringify(sw().textContent)} MAN pressed=${modeBtn('manual')?.getAttribute('aria-pressed')}`);

click(sw());
await waitFor('the heater to be held on again', () => sw().getAttribute('aria-checked') === 'true');
const stillManual = modeBtn('manual')?.getAttribute('aria-pressed') === 'true' && !sw().disabled;
console.log(`[bundle] after ON: aria-checked=${sw().getAttribute('aria-checked')} text=${JSON.stringify(sw().textContent)} still MAN=${stillManual}`);
if (!stillManual) fail('switching ON lost MAN — the reported bug is still there');

console.log('[bundle] verdict: the assembled app renders both controls and MAN survives an OFF/ON round trip: YES');
window.close();
server.close();
process.exit(0);
