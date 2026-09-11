/**
 * The live check must be able to FAIL.
 *
 * _live_check.mjs exits 0 on the deployed site, which is only evidence if the
 * same script exits non-zero for a bundle that is stale or that still walks the
 * farmer through the admin console. These tests run the script itself, as a
 * process, against fixture sites — every valid input, not one happy path:
 *
 *   1. VERDICT — a bundle carrying the message with no admin path exits 0 and
 *      says so; a bundle with an admin path, a bundle with no message, a 404
 *      bundle and a page with no bundle at all each exit 1 and say why.
 *   2. URL SHAPES — the bundle src is resolved against the page, so a relative
 *      "./assets/app.js" and an absolute "http://host/assets/app.js" both load
 *      (the relative form is what the live site serves).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHECKER = resolve(ROOT, '_live_check.mjs');

/* the real copy the farmer reads, exactly as it ships */
const MESSAGE =
  'No farm size is recorded for this system yet, so its own prices cannot be shown. '
  + 'Afriinnox records it at installation — until then, the full published price list '
  + 'below shows every plan at every size.';

const page = (src = './assets/app.js') => `<!doctype html><html><body><div id="root"></div>`
  + `<script type="module" src="${src}"></script></body></html>`;

let scenario = { html: page(), js: `x(${JSON.stringify(MESSAGE)})`, jsStatus: 200 };
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

/* async, NOT spawnSync: the fixture server answers from THIS process's event
 * loop, so blocking that loop would deadlock the child waiting for a reply. */
function run() {
  return new Promise((done) => {
    const child = spawn(process.execPath, [CHECKER], {
      cwd: ROOT,
      env: { ...process.env, LIVE_BASE: base },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b; });
    child.stderr.on('data', (b) => { stderr += b; });
    child.on('close', (code) => done({ code, stdout, stderr }));
  });
}

describe('the live check passes only for a bundle that carries the message', () => {
  /* [what the site serves, the exit code that must follow] */
  const CASES = () => [
    ['the shipped bundle', 0, { html: page(), js: `x(${JSON.stringify(MESSAGE)})` }],
    ['a bundle whose src is absolute', 0, { html: page(`${base}/assets/app.js`), js: `x(${JSON.stringify(MESSAGE)})` }],
    ['a bundle that still names an admin path', 1, {
      html: page(),
      js: `x(${JSON.stringify(MESSAGE)});y("Admin → Systems → this unit → Farm size")`,
    }],
    ['a stale bundle with no message', 1, { html: page(), js: 'var a = 1;' }],
    ['a bundle that is not there', 1, { html: page(), js: 'Not Found', jsStatus: 404 }],
    ['a page with no bundle at all', 1, { html: '<html><body>maintenance</body></html>', js: '' }],
  ];

  it.each(CASES())('%s exits %i', async (_label, expected, fixture) => {
    scenario = { jsStatus: 200, ...fixture };
    const { code, stdout, stderr } = await run();
    expect(code).toBe(expected);
    if (expected === 0) {
      expect(stdout).toMatch(/verdict: the live app serves the new farmer message: YES/);
      expect(stderr).toBe('');
    } else {
      expect(stderr).toMatch(/FAIL/);
      expect(stdout).not.toMatch(/verdict/);
    }
  });
});

describe('the check reads the bundle from the page, not from a fixed path', () => {
  it('resolves the relative src the live site serves and reports its real size', async () => {
    scenario = { html: page(), js: `x(${JSON.stringify(MESSAGE)})${'x'.repeat(1000)}`, jsStatus: 200 };
    const { code, stdout } = await run();
    expect(code).toBe(0);
    const served = Number(/bundle HTTP 200, (\d+) chars/.exec(stdout)?.[1]);
    expect(served).toBeGreaterThan(1000);
  });
});
