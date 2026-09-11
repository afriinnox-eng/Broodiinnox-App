/**
 * One check of the LIVE app: the deployed bundle carries the two-step price
 * list. The list reads as text with one Edit button; Edit turns it into fields;
 * Save makes a DRAFT that changes nothing for farmers; Publish makes it live and
 * notifies the farmers it concerns, and a farmer opening the same state is then
 * shown the new price.
 *
 *   node _live_sheet_check.mjs
 *
 * LIVE_BASE points it at another host and LIVE_CHECK_WAIT_MS bounds its waits, so
 * src/tests/live-sheet-check.test.js can run the same check against fixture
 * sites and prove it fails on a live app that lacks the feature.
 *
 * It fails by THROWING rather than calling process.exit(): exiting outright while
 * undici's sockets are still open aborts the process on Windows (0xC0000409),
 * which reports a code that is not 1 and loses the reason. The verdict line is
 * printed only when every step passed.
 */
import { JSDOM, VirtualConsole } from 'jsdom';

const BASE = (process.env.LIVE_BASE || 'https://broodiinnox-app.onrender.com').replace(/\/+$/, '');
const WAIT_MS = Number(process.env.LIVE_CHECK_WAIT_MS || 12000);
const KEY = 'broodiinnox_app_v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CheckFailed extends Error {}
const fail = (msg) => { console.error(`[live] FAIL: ${msg}`); throw new CheckFailed(msg); };

async function check() {
  const res = await fetch(`${BASE}/?t=${Date.now()}`, { cache: 'no-store' });
  const html = await res.text();
  const src = /<script[^>]*src="([^"]+)"/.exec(html)?.[1];
  if (!src) fail('the served index.html has no bundle to load');
  const js = await fetch(new URL(src, `${BASE}/`), { cache: 'no-store' });
  if (!js.ok) fail(`the bundle is not served: HTTP ${js.status}`);
  const code = await js.text();
  console.log(`[live] served ${src}: HTTP ${js.status}, ${code.length} chars`);

  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => console.error('[jsdom error]', e.message));
  vc.on('error', (...a) => console.error('[app console.error]', ...a));

  /** Boot the deployed bundle. A null state means "no saved state": the app seeds one. */
  const boot = (hash, state) => {
    const dom = new JSDOM(html, {
      url: `${BASE}/${hash}`,
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      virtualConsole: vc,
      beforeParse: state ? (w) => w.localStorage.setItem(KEY, JSON.stringify(state)) : undefined,
    });
    dom.window.fetch = () => Promise.reject(new Error('offline in verification'));
    dom.window.eval(code);
    return dom;
  };

  const waitFor = async (doc, label, fn, ms = WAIT_MS) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const out = fn();
      if (out) return out;
      if (Date.now() > deadline) fail(`timed out waiting for ${label} (text: ${JSON.stringify(doc.body.textContent.slice(0, 200))})`);
      await sleep(50);
    }
  };

  /* window A: no saved state, so the deployed app seeds a full one */
  const domA = boot('#/farmer/dashboard', null);
  await waitFor(domA.window.document, 'the deployed app to seed a state', () => {
    try {
      const s = JSON.parse(domA.window.localStorage.getItem(KEY));
      return s && s.sheet && s.plans ? s : null;
    } catch { return null; }
  });
  const seeded = JSON.parse(domA.window.localStorage.getItem(KEY));
  console.log(`[live] the deployed app seeded ${seeded.devices.length} systems, ${seeded.plans.length} plans, ${seeded.sheet.bands.length} farm sizes`);
  domA.window.close();

  /* window B: the admin's price list, end to end */
  const admin = { id: 'a1', name: 'Innocent Ingabire', role: 'admin', adminRole: 'super', email: 'admin@afriinnox.com' };
  const domB = boot('#/admin/subscriptions', { ...seeded, session: admin });
  const winB = domB.window;
  const docB = winB.document;
  const state = () => JSON.parse(winB.localStorage.getItem(KEY));
  const priceIn = (bands, bandId, planId) => bands.find((b) => b.id === bandId).prices[planId];
  const button = (name) => [...docB.querySelectorAll('button')].find((b) => b.textContent.trim() === name) || null;
  const tap = (el) => el.dispatchEvent(new winB.MouseEvent('click', { bubbles: true, cancelable: true, view: winB }));
  const LABEL = '30-Day Plan — 1,000–1,199 chicks';
  const cellFor = () => [...docB.querySelectorAll('input.cell-input')].find((i) => i.getAttribute('aria-label') === LABEL) || null;

  const editButton = await waitFor(docB, 'the price list', () => button('Edit'));
  const fieldsAtRest = docB.querySelectorAll('input.cell-input.price').length;
  console.log(`[live] the price list at rest: ${fieldsAtRest} price fields, ${docB.querySelectorAll('button').length} buttons`);
  if (fieldsAtRest !== 0) fail(`the price list is editable without pressing Edit (${fieldsAtRest} fields on screen)`);

  tap(editButton);
  await waitFor(docB, 'the fields of the edit session', () => docB.querySelectorAll('input.cell-input.price').length === 36 * seeded.plans.length);
  const names = docB.querySelectorAll('input[aria-label="Farm size name"]').length;
  console.log(`[live] after Edit: ${docB.querySelectorAll('input.cell-input.price').length} price fields and ${names} farm-size names`);
  if (names !== 36) fail(`the edit session has ${names} farm-size name fields, expected 36`);

  const cell = await waitFor(docB, `the cell for ${LABEL}`, () => cellFor());
  const before = cell.value;
  cell.focus();
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(cell), 'value');
  desc.set.call(cell, '60000');
  cell.dispatchEvent(new winB.Event('input', { bubbles: true }));
  cell.blur();

  tap(await waitFor(docB, 'the Save button', () => button('Save')));
  await waitFor(docB, 'the edit to be saved', () => {
    try { return priceIn(state().sheetDraft.bands, 'b06', 't30d') === 60000; } catch { return false; }
  });
  const savedState = state();
  const stillPublished = priceIn(savedState.sheet.bands, 'b06', 't30d');
  console.log(`[live] Save: the saved list has 30-Day at ${before} -> ${priceIn(savedState.sheetDraft.bands, 'b06', 't30d')} by ${savedState.sheetDraft.savedBy}; the PUBLISHED list is still ${stillPublished}`);
  if (stillPublished !== 52800) fail('saving a list changed what is published, before it was published');

  tap(await waitFor(docB, 'the Publish button', () => [...docB.querySelectorAll('button')].find((b) => /^Publish/.test(b.textContent.trim())) || null));
  const confirm = await waitFor(docB, 'the Publish confirmation', () => [...docB.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === 'Publish') || null);
  tap(confirm);
  await waitFor(docB, 'the list to be published', () => {
    try { return priceIn(state().sheet.bands, 'b06', 't30d') === 60000 && !state().sheetDraft; } catch { return false; }
  });
  const published = state();
  const told = published.notifications.filter((n) => n.title === 'Price list updated');
  console.log(`[live] Publish: then the published list is ${priceIn(published.sheet.bands, 'b06', 't30d')}, the draft is cleared, and ${told.length} farmer(s) were told: ${JSON.stringify(told[0]?.body || '')}`);
  if (!told.length) fail('publishing the price list notified nobody');
  winB.close();

  /* window C: a farmer, on the same state, is shown the published price */
  const domC = boot('#/farmer/subscriptions', {
    ...published,
    session: { id: 'f1', name: 'Jean Damascene', role: 'farmer', phone: '0788123456' },
  });
  const docC = domC.window.document;
  const plans = await waitFor(docC, "the farmer's plan tables", () => {
    const tables = [...docC.querySelectorAll('.table-wrap table')].filter((t) => /Your price/.test(t.textContent));
    return tables.length ? tables.map((t) => t.textContent).join(' ') : null;
  });
  const paysNew = /RWF 60,000/.test(plans);
  const paysOld = /RWF 52,800/.test(plans);
  console.log(`[live] the farmer, on the same state: shows the published price=${paysNew}, still quotes the old one=${paysOld}`);
  domC.window.close();

  if (!paysNew || paysOld) fail('the farmer is not shown the price the admin published');
}

check().then(
  () => {
    console.log('[live] verdict: the live app edits the price list in two steps — Save privately, Publish to farmers with a notification: YES');
    process.exitCode = 0;
  },
  (e) => {
    if (!(e instanceof CheckFailed)) console.error('[live] unexpected error:', e);
    process.exitCode = 1;
  },
);
