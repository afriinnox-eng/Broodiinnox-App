/**
 * One check of the LIVE site: the deployed bundle carries the farmer's
 * no-farm-size message, and that message names no admin navigation path.
 *
 *   node _live_check.mjs
 *
 * LIVE_BASE points it at another host — src/tests/live-check.test.js runs the
 * same check against fixture sites, so its verdict is known to be reachable and
 * not vacuous.
 *
 * It sets process.exitCode rather than calling process.exit(): exiting outright
 * while undici's sockets are still open aborts the process on Windows
 * (0xC0000409), which loses the message and reports a code that is not 1.
 */
const BASE = (process.env.LIVE_BASE || 'https://broodiinnox-app.onrender.com').replace(/\/+$/, '');

let failed = false;
const fail = (msg) => { console.error(`[live] FAIL: ${msg}`); failed = true; };

const res = await fetch(`${BASE}/?t=${Date.now()}`, { cache: 'no-store' });
const html = await res.text();
const src = /<script[^>]*src="([^"]+)"/.exec(html)?.[1];
console.log(`[live] index.html HTTP ${res.status}, bundle ${src}`);

if (!src) {
  fail('the served index.html has no bundle to load');
} else {
  const js = await fetch(new URL(src, `${BASE}/`), { cache: 'no-store' });
  const code = await js.text();
  console.log(`[live] bundle HTTP ${js.status}, ${code.length} chars`);

  const installs = (code.match(/records it at installation/g) || []).length;
  const adminPath = /Admin\s*(?:→|->)/.test(code);
  const oldText = /Admin\s*→\s*Systems/.test(code);
  console.log(`[live] says the size is recorded at installation: ${installs > 0} (${installs}x)`);
  console.log(`[live] names an admin navigation path: ${adminPath}`);
  console.log(`[live] old "Admin → Systems" text still present: ${oldText}`);

  const i = code.indexOf('records it at installation');
  console.log(`[live] deployed copy: ${JSON.stringify(code.slice(Math.max(0, i - 130), i + 90))}`);

  if (!installs) fail('the deployed bundle does not carry the message');
  if (adminPath) fail('the deployed bundle still names an admin path');
  if (oldText) fail('the old admin path is still in the deployed bundle');
}

if (!failed) console.log('[live] verdict: the live app serves the new farmer message: YES');
process.exitCode = failed ? 1 : 0;
