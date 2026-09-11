/**
 * What the DEPLOYED app actually shows a farmer right now.
 *
 * Loads the live bundle from https://broodiinnox-app.onrender.com in a DOM,
 * answers the control API with a realistic device row (a live unit with NO farm
 * size recorded, which is the state the real brooder is in), signs in as the
 * farmer and reports what the Subscriptions page puts on screen: are the five
 * plans there, are real RWF amounts shown, or is something hidden behind a
 * button.
 *
 *   node _verify_live.mjs
 */
import { JSDOM, VirtualConsole } from 'jsdom';

const BASE = 'https://broodiinnox-app.onrender.com/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const html = await (await fetch(`${BASE}?cb=${Date.now()}`)).text();
const src = /<script[^>]*src="([^"]+)"[^>]*><\/script>/.exec(html)?.[1];
console.log('[live] app:', BASE, '| bundle:', src);
const code = await (await fetch(new URL(src, BASE))).text();
console.log('[live] bundle bytes:', code.length);

/** The row GET /api/devices returns for the real unit (no farm size is stored). */
const DEVICE_ROW = {
  device_id: 'BROODIINNOX-001', name: 'Damas', farmer_id: 'f1', location: 'Kigali',
  online: true, last_seen_at: new Date().toISOString(),
  relay_state: false, manual_control: true, day: 3, total_days: 21,
  max_temp: 31, min_temp: 30, ave_temp: 28.5,
  temp1: 28.5, temp2: null, temp3: null, temp4: null,
  s1_enabled: true, s2_enabled: false, s3_enabled: false, s4_enabled: false,
  failsafe_mode: false, sensor_error: false, mismatch_error: false,
  device_locked: false, signal_quality: 26, error: null, stale: false,
};

const vc = new VirtualConsole();
vc.on('jsdomError', (e) => console.error('[live jsdom error]', e.message));
const dom = new JSDOM(html, { url: BASE, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;
const doc = window.document;

// The deployed build talks to broodiinnox-api; serve it one live device row.
window.fetch = async (url) => {
  const u = String(url);
  const body = u.includes('/api/devices') ? { count: 1, devices: [DEVICE_ROW] } : { ok: true };
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
};
window.eval(code);

const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
const byText = (sel, re) => [...doc.querySelectorAll(sel)].find((el) => re.test(el.textContent || ''));
async function until(fn, ms = 8000) {
  const t = Date.now() + ms;
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > t) return null; await sleep(50); }
}

await until(() => byText('button', /demo farmer/i));
click(byText('button', /demo farmer/i));
click(await until(() => doc.querySelector('a[href="#/farmer/subscriptions"]')));
await until(() => byText('h1', /Subscriptions/i));
await sleep(1500); // let the first API poll land

const text = () => doc.body.textContent;
const PLANS = ['15-Day', '30-Day', '40-Day', '6-Month', '1-Year'];
console.log('\n[live] on the Subscriptions page, for a live unit with no farm size recorded:');
console.log('  plans named on screen :', PLANS.filter((p) => text().includes(p)).join(', ') || 'NONE');
console.log('  RWF amounts on screen :', (text().match(/RWF [\d,]+/g) || []).length);
console.log('  farm-size notice shown:', /No farm size is recorded/.test(text()));
console.log('  plan table for a band :', /Plans for Up to|Plans for \d/.test(text()));
console.log('  "View all" available  :', !!byText('button', /View all subscription plans/i));
console.log('  system card lock state:', /device locked/i.test(text()) ? 'locked' : 'not locked');

click(byText('button', /View all subscription plans/i));
await until(() => (text().match(/RWF [\d,]+/g) || []).length > 20);
console.log('\n[live] after pressing "View all subscription plans":');
console.log('  plans named on screen :', PLANS.filter((p) => text().includes(p)).join(', ') || 'NONE');
console.log('  RWF amounts on screen :', (text().match(/RWF [\d,]+/g) || []).length);
console.log('  sample prices         :', (text().match(/RWF [\d,]+/g) || []).slice(0, 6).join(' | '));

window.close();
process.exit(0);
