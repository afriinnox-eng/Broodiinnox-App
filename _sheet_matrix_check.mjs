/**
 * What the LIVE app shows on its price list — freshly seeded, and under a saved
 * state left behind by an older build of the app.
 *
 *   node _sheet_matrix_check.mjs                    → the deployed app
 *   LIVE_BASE=http://127.0.0.1:4173 node ...        → a build served locally
 *
 * The second case is the one that matters, and it is the one that was wrong: a
 * browser used since the first build still carries that build's plan catalogue
 * in localStorage — three plans, "15-Day", "30-Day", "90-Day" — and none of
 * their ids matches a column of the approved sheet, so the console showed three
 * columns and "Customized" in every cell of every farm size, with the 6-Month
 * and 1-Year plans nowhere on it.
 *
 * It fails by THROWING rather than exiting: exiting while undici's sockets are
 * still open aborts the process on Windows (0xC0000409) and reports a code that
 * is not 1, losing the reason.
 */
import { JSDOM, VirtualConsole } from 'jsdom';

const BASE = (process.env.LIVE_BASE || 'https://broodiinnox-app.onrender.com').replace(/\/+$/, '');
const WAIT_MS = Number(process.env.LIVE_CHECK_WAIT_MS || 12000);
const KEY = 'broodiinnox_app_v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CheckFailed extends Error {}
const fail = (msg) => { console.error(`[matrix] FAIL: ${msg}`); throw new CheckFailed(msg); };

/** Every browser this check has open, so a failure cannot leave the process hanging on one. */
const open = new Set();
const close = (dom) => { open.delete(dom); dom.window.close(); };

/** The plan catalogue the FIRST build of the app seeded, and left in the browser. */
const OLD_PLANS = [
  { id: 'p15', name: '15-Day', durationDays: 15, price: 15000, active: true, description: 'Short cycle (piglets, small batches)' },
  { id: 'p30', name: '30-Day', durationDays: 30, price: 25000, active: true, description: 'Standard cycle (chickens)' },
  { id: 'p90', name: '90-Day', durationDays: 90, price: 65000, active: true, description: 'Multiple cycles — best value' },
];

/**
 * Three plans sitting AFTER the approved five, each carrying a multiplier — the
 * shape an older catalogue or a console's "add a plan" key leaves behind, and
 * the one that put three extra columns on the end of the price list.
 */
const EXTRA_PLANS = [
  { id: 'legacy-15', name: '15-Day', durationDays: 15, multiplier: 1, active: true, description: 'Extra column' },
  { id: 'legacy-30', name: '30-Day', durationDays: 30, multiplier: 1.6, active: true, description: 'Extra column' },
  { id: 'legacy-40', name: '40-Day', durationDays: 40, multiplier: 1.8, active: true, description: 'Extra column' },
];

const FIVE = ['15-Day Plan', '30-Day Plan', '40-Day Plan', '6-Month Plan', '1-Year Plan'];
/** The five prices the approved sheet prints, cheapest farm size first, mid row, and last priced row. */
const APPROVED = {
  b01: ['RWF 25,000', 'RWF 40,000', 'RWF 45,000', 'RWF 125,000', 'RWF 200,000'],
  b06: ['RWF 33,000', 'RWF 52,800', 'RWF 59,400', 'RWF 165,000', 'RWF 264,000'],
  b35: ['RWF 247,000', 'RWF 395,200', 'RWF 444,600', 'RWF 1,235,000', 'RWF 1,976,000'],
};

async function check() {
  const res = await fetch(`${BASE}/?t=${Date.now()}`, { cache: 'no-store' });
  const html = await res.text();
  const src = /<script[^>]*src="([^"]+)"/.exec(html)?.[1];
  if (!src) fail('the served index.html has no bundle to load');
  const js = await fetch(new URL(src, `${BASE}/`), { cache: 'no-store' });
  if (!js.ok) fail(`the bundle is not served: HTTP ${js.status}`);
  const code = await js.text();
  console.log(`[matrix] served ${src}: HTTP ${js.status}, ${code.length} chars`);

  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => console.error('[jsdom error]', e.message));

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
    open.add(dom);
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

  /* ---------- a fresh browser: the app seeds itself from the approved sheet ---------- */
  const fresh = boot('#/farmer/dashboard', null);
  const seeded = await waitFor(fresh.window.document, 'the app to seed a state', () => {
    try {
      const s = JSON.parse(fresh.window.localStorage.getItem(KEY));
      return s && s.sheet && s.plans ? s : null;
    } catch { return null; }
  });
  fresh.window.close();
  open.delete(fresh);
  const seededRow = (bandId) => Object.keys(seeded.sheet.bands.find((b) => b.id === bandId).prices)
    .map((k) => seeded.sheet.bands.find((b) => b.id === bandId).prices[k]);
  console.log(`[matrix] fresh: ${seeded.plans.length} plans — ${seeded.plans.map((p) => p.name).join(', ')}`);
  console.log(`[matrix] fresh: the seeded sheet for 1,000–1,199 chicks: ${seededRow('b06').join(', ')}`);
  if (seeded.plans.length !== FIVE.length) fail(`a fresh app seeds ${seeded.plans.length} plans, not ${FIVE.length}`);
  for (const bandId of Object.keys(APPROVED)) {
    const cells = seededRow(bandId);
    if (new Set(cells).size !== cells.length) fail(`two plans share a price on ${bandId}: ${cells.join(', ')}`);
  }

  /* ---------- the console, on a fresh state and on one an older build left ---------- */
  const admin = { id: 'a1', name: 'Innocent Ingabire', role: 'admin', adminRole: 'super', email: 'admin@afriinnox.com' };
  const stale = { ...seeded, plans: OLD_PLANS, session: admin };
  delete stale.sheet;
  delete stale.sheetDraft;
  const withExtras = { ...seeded, plans: [...seeded.plans, ...EXTRA_PLANS], session: admin };
  delete withExtras.sheetDraft;
  const STATES = [
    ['fresh', { ...seeded, session: admin }],
    ['a state an older build left behind', stale],
    ['a catalogue carrying three extra plans', withExtras],
  ];
  for (const [label, state] of STATES) {
    const dom = boot('#/admin/subscriptions', state);
    const doc = dom.window.document;
    const table = await waitFor(doc, `the price list (${label})`, () => {
      const t = [...doc.querySelectorAll('.table-wrap table')].find((x) => /Up to 599 chicks/.test(x.textContent));
      return t && t.querySelectorAll('tbody tr').length === 36 ? t : null;
    });
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    console.log(`[matrix] ${label}: ${heads.length - 1} plan columns — ${heads.slice(1).join(' | ')}`);
    if (heads.length - 1 !== FIVE.length) fail(`${label}: the console has ${heads.length - 1} plan columns, not ${FIVE.length}`);
    if (heads.slice(1).join(' ') !== FIVE.join(' ')) fail(`${label}: the columns are ${heads.slice(1).join(', ')}`);
    for (const [bandId, expected] of Object.entries(APPROVED)) {
      const bandLabel = seeded.sheet.bands.find((b) => b.id === bandId).label;
      const tr = [...table.querySelectorAll('tbody tr')].find((r) => r.querySelector('td')?.textContent.trim() === bandLabel);
      if (!tr) fail(`${label}: ${bandLabel} is not in the price list`);
      const cells = [...tr.querySelectorAll('td')].slice(1).map((td) => td.textContent.trim());
      console.log(`[matrix] ${label}: ${bandLabel}: ${cells.join(', ')}`);
      if (cells.join(' | ') !== expected.join(' | ')) fail(`${label}: ${bandLabel} reads ${cells.join(', ')}, not ${expected.join(', ')}`);
    }
    dom.window.close();
    open.delete(dom);
  }
}

check().then(
  () => {
    console.log(`[matrix] verdict: on ${BASE}, the console shows exactly the five approved plans — no extra column — and prices them at every farm size, on a fresh state, on a state an older build left, and on a catalogue carrying three extras: YES`);
    process.exitCode = 0;
  },
  (e) => {
    for (const d of [...open]) { try { close(d); } catch { /* already gone */ } }
    if (!(e instanceof CheckFailed)) console.error('[matrix] unexpected error:', e);
    process.exitCode = 1;
  },
);
