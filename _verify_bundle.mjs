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
/** Wait for the app to render something, without failing if it never comes. */
async function soon(fn, ms = 4000) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (fn()) return true;
    if (Date.now() > deadline) return false;
    await sleep(25);
  }
}

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

/* 8. the subscription page: this farm's own band first, other sizes on request */
click(await waitFor('the Subscriptions nav link', () => doc.querySelector('a[href="#/farmer/subscriptions"]')));
const viewAll = await waitFor('the subscription plans', () => byText('button', /View all subscription plans/i));
const ownBand = /Plans for 1,000–1,199 chicks/.test(doc.body.textContent);
const ownPrice = /RWF 52,800/.test(doc.body.textContent);          // 30-Day on 1,000–1,199 chicks
const otherBefore = /RWF 1,368,000/.test(doc.body.textContent);    // 1-Year on 10,000+ chicks
console.log(`[bundle] subscriptions: plans for the farm's own size shown=${ownBand}, its 30-Day price ${ownPrice ? 'RWF 52,800 shown' : 'missing'}, another size's price shown before the button=${otherBefore}`);
if (!ownBand || !ownPrice) fail('the subscription page does not price the plans for the farm size');
if (otherBefore) fail('plans of other farm sizes are visible before the button is pressed');

click(viewAll);
const otherAfter = await soon(() => /RWF 1,368,000/.test(doc.body.textContent));
const customized = /Customized/.test(doc.body.textContent);
console.log(`[bundle] after "View all subscription plans": every farm size shown=${otherAfter}, the customized top band labelled=${customized}`);
if (!otherAfter) fail('the button did not reveal the other farm sizes');

/* 9. all five plans, each with real RWF — on the page and in the payment modal */
const FIVE = ['15-Day Plan', '30-Day Plan', '40-Day Plan', '6-Month Plan', '1-Year Plan']
  .filter((n) => doc.body.textContent.includes(n));
const rwfCount = () => (doc.body.textContent.match(/RWF [\d,]+/g) || []).length;
console.log(`[bundle] plans named: ${FIVE.length}/5 (${FIVE.join(', ') || 'NONE'}) | RWF amounts on screen: ${rwfCount()}`);
if (FIVE.length !== 5) fail(`only ${FIVE.length} of the 5 plans are listed`);
if (rwfCount() < 100) fail('the price list does not show real RWF amounts');

let options = [];
click(await waitFor('a plan button on a system card', () => byText('button', /Renew \/ extend|Choose/)));
// the select that offers PLANS (the page also carries the language switcher)
await soon(() => {
  options = [...doc.querySelectorAll('select')]
    .map((s) => [...s.options])
    .find((os) => os.some((o) => /15-Day Plan/.test(o.textContent))) || [];
  return options.length === 5;
});
const priced = options.length === 5 && options.every((o) => /RWF [\d,]+/.test(o.textContent));
console.log(`[bundle] payment modal: ${options.length} plans offered, each priced=${priced} — ${options.map((o) => o.textContent).join(' / ')}`);
if (!priced) fail('the payment modal does not offer all five plans with real prices');
const cancel = byText('button', /^Cancel$/);
if (cancel) click(cancel);

/* 10. the same bundle, booted with no farm size recorded for the farmer's
       systems: what the farmer reads then must say the size is recorded at
       installation and must NOT walk them through the admin console. */
const patched = JSON.parse(window.localStorage.getItem('broodiinnox_app_v1'));
patched.devices = (patched.devices || []).map((d) => (d.farmerId === 'f1' ? { ...d, farmSize: null, batch: null } : d));
const dom2 = new JSDOM(html, {
  url: `${base}#/farmer/subscriptions`,
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse: (w) => w.localStorage.setItem('broodiinnox_app_v1', JSON.stringify(patched)),
});
const win2 = dom2.window;
const doc2 = win2.document;
win2.fetch = () => Promise.reject(new Error('offline in verification'));
win2.eval(code);
const wait2 = async (label, fn, ms = 8000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const out = fn();
    if (out) return out;
    if (Date.now() > deadline) fail(`timed out waiting for ${label} at ${win2.location.hash} (body: ${JSON.stringify(doc2.body.textContent.slice(0, 700))})`);
    await sleep(25);
  }
};
await wait2('the app shell with no farm size', () => doc2.querySelector('a[href="#/farmer/subscriptions"]'));
await wait2('the no-farm-size message', () => /No farm size is recorded for this system yet/.test(doc2.body.textContent));
const body2 = doc2.body.textContent;
const sentence = (body2.match(/No farm size is recorded[\s\S]*?\./) || [''])[0].replace(/\s+/g, ' ').trim();
const saysInstall = /Afriinnox records it at installation/.test(body2);
const adminPath = /Admin\s*(→|->)/.test(body2);
console.log(`[bundle] no farm size recorded: message shown=true, says the size is recorded at installation=${saysInstall}, names an admin path=${adminPath}`);
console.log(`[bundle] what the farmer reads: ${JSON.stringify(sentence)}`);
if (!saysInstall) fail('the no-farm-size message does not say where the farm size comes from');
if (adminPath) fail('the farmer-facing message still walks the user through the admin console');

win2.close();
window.close();
server.close();
process.exit(0);
