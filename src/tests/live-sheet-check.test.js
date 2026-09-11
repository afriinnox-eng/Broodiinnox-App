/**
 * The live price-list check must be able to FAIL.
 *
 * _live_sheet_check.mjs exits 0 against the deployed site, which is only
 * evidence if the same script exits non-zero for a live app that does not do
 * what it says. These tests run the script itself, as a process, against fixture
 * sites that emulate the two-step contract — every way the live app could be
 * wrong, not one happy path:
 *
 *   1. VERDICT — a bundle whose list reads as text until Edit, whose Save only
 *      drafts, and whose Publish reaches the farmer exits 0 and says so; a bundle
 *      that is editable at rest, one whose Save publishes immediately, one whose
 *      farmer never sees the new price, one served with no bundle and one whose
 *      bundle 404s each exit 1 and say why.
 *   2. NOT VACUOUS — the passing fixture really does walk the whole path (seed,
 *      fields after Edit, the saved draft with the published list untouched, the
 *      publish and the notification), and the failing ones stop at the stage
 *      they are meant to catch.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHECKER = resolve(ROOT, '_live_sheet_check.mjs');

/**
 * A stand-in for the deployed bundle: it seeds a state, renders the price list
 * as text behind one Edit button, saves a draft, publishes it and tells the
 * farmer. Each flag removes one of the things the check depends on.
 */
const fixtureBundle = ({ guarded = true, savesDraft = true, reachesFarmer = true } = {}) => `
(function(){
  var KEY = 'broodiinnox_app_v1';
  function read(){ try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  function write(s){ localStorage.setItem(KEY, JSON.stringify(s)); }
  function seeds(){
    var bands = [];
    for (var i = 0; i < 36; i++) {
      var id = 'b' + ('0' + (i + 1)).slice(-2);
      var min = i === 5 ? 1000 : i * 100 + 1;
      var max = i === 35 ? null : (i === 5 ? 1199 : (i + 1) * 100);
      bands.push({ id: id, min: min, max: max, label: i === 5 ? '1,000–1,199 chicks' : 'row ' + id,
        prices: { t15d: 1000 + i, t30d: i === 5 ? 52800 : 2000 + i, t40d: 3000 + i, t6m: 4000 + i, t1y: 5000 + i } });
    }
    return {
      devices: [{ id: 'BRD001', farmerId: 'f1', farmSize: 1000, subscription: { planId: 't30d' } }],
      farmers: [{ id: 'f1', name: 'Jean Damascene' }],
      notifications: [],
      plans: [{ id: 't15d', name: '15-Day Plan', durationDays: 15, multiplier: 1 }, { id: 't30d', name: '30-Day Plan', durationDays: 30, multiplier: 1.6 },
        { id: 't40d', name: '40-Day Plan', durationDays: 40, multiplier: 1.8 }, { id: 't6m', name: '6-Month Plan', durationDays: 180, multiplier: 5 },
        { id: 't1y', name: '1-Year Plan', durationDays: 365, multiplier: 8 }],
      sheet: { bands: bands },
      session: null
    };
  }
  if (!read()) write(seeds());
  var money = function (v) { return v == null ? 'Customized' : 'RWF ' + Number(v).toLocaleString('en-US'); };

  if (/admin/.test(location.hash)) {
    var working = JSON.parse(JSON.stringify(read().sheet.bands));
    var editing = false;
    // guarded: false is a live app whose list is editable at rest: it still
    // offers the Edit button, but the fields are already there
    var alwaysFields = ${guarded ? 'false' : 'true'};
    var showPublish = false;
    var render = function(){
      var s = read();
      var fields = editing || alwaysFields;
      var bands = editing ? working : (s.sheetDraft ? s.sheetDraft.bands : s.sheet.bands);
      var html = '<div class="row-between"><h3>Price list by farm size (chicks)</h3><div class="btn-row">';
      if (editing) html += '<button>Save</button><button>Cancel</button>';
      else html += (showPublish ? '<button>Publish (1)</button>' : '') + '<button>Edit</button>';
      html += '</div></div><div class="table-wrap"><table><thead><tr><th>Farm size</th>';
      for (var j = 0; j < s.plans.length; j++) html += '<th>' + s.plans[j].name + '</th>';
      html += '</tr></thead><tbody>';
      for (var i = 0; i < bands.length; i++) {
        var b = bands[i];
        html += '<tr><td>' + (fields ? '<input class="cell-input name" aria-label="Farm size name" value="' + b.label + '">' : '<b>' + b.label + '</b>') + '</td>';
        for (var k = 0; k < s.plans.length; k++) {
          var v = b.prices[s.plans[k].id];
          html += '<td>' + (fields
            ? '<input class="cell-input price" aria-label="' + s.plans[k].name + ' — ' + b.label + '" value="' + (v == null ? '' : v) + '">'
            : money(v)) + '</td>';
        }
        html += '</tr>';
      }
      document.body.innerHTML = html + '</tbody></table></div>';

      [].slice.call(document.querySelectorAll('input.cell-input.price')).forEach(function (inp) {
        inp.addEventListener('input', function () {
          var label = inp.getAttribute('aria-label');
          var plans = read().plans;
          for (var i2 = 0; i2 < working.length; i2++) {
            for (var p2 = 0; p2 < plans.length; p2++) {
              if (plans[p2].name + ' — ' + working[i2].label === label) working[i2].prices[plans[p2].id] = Number(inp.value);
            }
          }
        });
      });
      [].slice.call(document.querySelectorAll('button')).forEach(function (btn) {
        var text = btn.textContent.trim();
        if (text === 'Edit') btn.onclick = function () { editing = true; alwaysFields = false; render(); };
        else if (text === 'Cancel') btn.onclick = function () { editing = false; render(); };
        else if (text === 'Save') btn.onclick = function () {
          var st = read();
          ${savesDraft
            ? "st.sheetDraft = { bands: working, plans: st.plans, savedAt: new Date().toISOString(), savedBy: 'Innocent Ingabire' }; write(st); showPublish = true;"
            : 'st.sheet = { bands: working, publishedBy: null }; write(st);'}
          editing = false;
          render();
        };
        else if (/^Publish/.test(text)) btn.onclick = function () {
          document.body.insertAdjacentHTML('beforeend', '<div class="modal"><button>Publish</button><button>Cancel</button></div>');
          [].slice.call(document.querySelectorAll('.modal button')).forEach(function (mb) {
            if (mb.textContent.trim() === 'Publish') mb.onclick = function () {
              var st2 = read();
              st2.sheet = { bands: st2.sheetDraft.bands, publishedBy: 'Innocent Ingabire' };
              st2.notifications = [{ id: 'n_new', farmerId: 'f1', title: 'Price list updated',
                body: 'the 30-Day Plan price for 1,000–1,199 chicks is now RWF 60,000 (it was RWF 52,800). This applies from now on — nothing you have already paid for changes.' }]
                .concat(st2.notifications || []);
              st2.sheetDraft = null;
              write(st2);
              showPublish = false;
              var m = document.querySelector('.modal');
              if (m) m.remove();
              render();
            };
            if (mb.textContent.trim() === 'Cancel') mb.onclick = function () { var m = document.querySelector('.modal'); if (m) m.remove(); };
          });
        };
      });
    };
    render();
  }

  if (/farmer/.test(location.hash) && !/dashboard/.test(location.hash)) {
    var st = read();
    var band = st.sheet.bands.filter(function (b) { return b.id === 'b06'; })[0];
    var shown = ${reachesFarmer ? 'band.prices.t30d' : '52800'};
    document.body.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Your price</th></tr></thead>'
      + '<tbody><tr><td>RWF ' + Number(shown).toLocaleString('en-US') + '</td></tr></tbody></table></div>';
  }
})();
`;

const INDEX = (src = './assets/app.js') => `<!doctype html><html><body><div id="root"></div>`
  + `<script src="${src}"></script></body></html>`;

let scenario = { html: INDEX(), js: fixtureBundle(), jsStatus: 200 };
let base = '';
let server;

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = (req.url || '/').split('?')[0];
    if (path === '/' || path === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(scenario.html);
      return;
    }
    res.writeHead(scenario.jsStatus, { 'content-type': 'text/javascript' });
    res.end(scenario.js);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server.closeAllConnections?.();
  server.close();
});

/* async spawn, never spawnSync: the fixture answers from this process's loop */
function run() {
  return new Promise((done) => {
    const child = spawn(process.execPath, [CHECKER], {
      cwd: ROOT,
      env: { ...process.env, LIVE_BASE: base, LIVE_CHECK_WAIT_MS: '900' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b; });
    child.stderr.on('data', (b) => { stderr += b; });
    child.on('close', (code) => done({ code, stdout, stderr }));
  });
}

describe('the live price-list check passes only for a live app that edits in two steps', () => {
  const CASES = () => [
    ['a live app that drafts on Save and publishes to farmers', 0, { html: INDEX(), js: fixtureBundle() }],
    ['a live app whose list is editable without pressing Edit', 1, { html: INDEX(), js: fixtureBundle({ guarded: false }) }],
    ['a live app whose Save publishes immediately', 1, { html: INDEX(), js: fixtureBundle({ savesDraft: false }) }],
    ['a live app whose farmer never sees the new price', 1, { html: INDEX(), js: fixtureBundle({ reachesFarmer: false }) }],
    ['a live app serving a bundle that is not there', 1, { html: INDEX(), js: 'Not Found', jsStatus: 404 }],
    ['a live app whose page loads no bundle at all', 1, { html: '<html><body>maintenance</body></html>', js: '' }],
  ];

  // each case spawns the checker, which boots the bundle three times: its own budget
  it.each(CASES())('%s exits %i', async (_label, expected, fixture) => {
    scenario = { jsStatus: 200, ...fixture };
    const { code, stdout, stderr } = await run();
    if (expected === 0) {
      expect(stdout).toMatch(/verdict: the live app edits the price list in two steps/);
      expect(stderr).toBe('');
    } else {
      expect(stderr).toMatch(/FAIL/);
      expect(stdout).not.toMatch(/verdict/);
    }
    expect(code).toBe(expected);
  }, 30000);
});

describe('the fixtures really exercise the check', () => {
  it('reaches the stage each case is meant to catch', async () => {
    scenario = { html: INDEX(), js: fixtureBundle(), jsStatus: 200 };
    const ok = await run();
    // the whole path, in order: seed, read-only list, fields, draft, publish
    expect(ok.stdout).toMatch(/seeded \d+ systems, \d+ plans, \d+ farm sizes/);
    expect(ok.stdout).toMatch(/the price list at rest: 0 price fields/);
    expect(ok.stdout).toMatch(/after Edit: 180 price fields and 36 farm-size names/);
    expect(ok.stdout).toMatch(/the PUBLISHED list is still 52800/);
    expect(ok.stdout).toMatch(/then the published list is 60000, the draft is cleared, and 1 farmer\(s\) were told/);
    expect(ok.stdout).toMatch(/shows the published price=true, still quotes the old one=false/);

    scenario = { html: INDEX(), js: fixtureBundle({ savesDraft: false }), jsStatus: 200 };
    const immediate = await run();
    expect(immediate.stdout).toMatch(/after Edit: 180 price fields/);
    expect(immediate.stderr).toMatch(/timed out waiting for the edit to be saved/);

    scenario = { html: INDEX(), js: fixtureBundle({ guarded: false }), jsStatus: 200 };
    const open = await run();
    expect(open.stderr).toMatch(/editable without pressing Edit/);
  }, 40000);
});
