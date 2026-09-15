/**
 * Deploy broodiinnox-api to Render as a web service (no secret ever printed).
 *
 *   node scripts/render-deploy.mjs
 *
 * 1. create (or reuse) the web service on the Broodiinnox-App repo, rootDir
 *    broodiinnox-api, node runtime — build `npm ci && npm run build`,
 *    start `node scripts/server.js`
 * 2. set DATABASE_URL from the repo root .env (COCKROACHURL)
 * 3. trigger a deploy and poll until live
 * 4. verify the public /api/health endpoint
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const API = 'https://api.render.com/v1';
const OWNER = 'tea-dabesqtg1s2s73cg04e0';
const NAME = 'broodiinnox-api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const keyFile = String(readFileSync('C:\\Users\\CLAUDE\\Desktop\\Tech Projects\\render_api.txt', 'utf8')).trim();
const KEY = keyFile.includes('=') ? keyFile.split('=', 2)[1].trim() : keyFile;
if (!KEY) throw new Error('no render api key found');

const envText = readFileSync(join(import.meta.dirname, '..', '..', '.env'), 'utf8');
const pick = (k) => {
  const l = envText.split(/\r?\n/).find((x) => x.trim().startsWith(`${k}=`));
  return l ? l.slice(l.indexOf('=') + 1).trim() : undefined;
};
const DB_URL = pick('COCKROACHURL') || pick('DATABASE_URL');
if (!DB_URL) throw new Error('no DB url in root .env (COCKROACHURL)');

async function call(method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data };
}

const payload = {
  type: 'web_service',
  name: NAME,
  ownerId: OWNER,
  repo: 'https://github.com/afriinnox-eng/Broodiinnox-App',
  branch: 'main',
  autoDeploy: 'no',
  rootDir: 'broodiinnox-api',
  envVars: [{ key: 'DATABASE_URL', value: DB_URL, sync: false }],
  serviceDetails: {
    env: 'node',
    plan: 'free',
    region: 'oregon',
    healthCheckPath: '/api/health',
    numInstances: 1,
    envSpecificDetails: {
      buildCommand: 'npm ci && npm run build',
      startCommand: 'node scripts/server.js',
    },
  },
};

console.log('[deploy] creating web service ...');
let res = await call('POST', '/services', payload);
let serviceId = res.data?.service?.id || res.data?.id;
let created = res.status === 201;

if (!serviceId && res.status === 400 && /already exists|already in use|duplicate|conflict/i.test(JSON.stringify(res.data || {}))) {
  console.log('[deploy] service already exists — reusing it');
  const list = await call('GET', `/services?name=${NAME}`);
  const found = (Array.isArray(list.data) ? list.data : []).find((s) => s?.service?.name === NAME || s?.name === NAME);
  serviceId = found?.service?.id || found?.id;
  created = false;
} else if (res.status !== 201) {
  throw new Error(`create failed HTTP ${res.status}: ${JSON.stringify(res.data || {}).slice(0, 600)}`);
}
if (!serviceId) throw new Error('could not determine service id');
console.log(`[deploy] service id ${serviceId} (${created ? 'created' : 'reused'})`);

if (!created) {
  const up = await call('PUT', `/services/${serviceId}/env-vars/DATABASE_URL`, { value: DB_URL });
  if (up.status >= 300) throw new Error(`env-var update failed HTTP ${up.status}: ${JSON.stringify(up.data || {}).slice(0, 400)}`);
  console.log('[deploy] DATABASE_URL env-var set');
}

console.log('[deploy] triggering deploy ...');
const dep = await call('POST', `/services/${serviceId}/deploys`, { clearCache: 'do_not_clear' });
if (![201, 202].includes(dep.status)) throw new Error(`deploy trigger failed HTTP ${dep.status}: ${JSON.stringify(dep.data || {}).slice(0, 400)}`);

let status = 'created';
for (let i = 0; i < 90 && !['live', 'deploy_failed', 'canceled'].includes(status); i++) {
  await sleep(5000);
  const poll = await call('GET', `/services/${serviceId}/deploys?limit=3`);
  const list = Array.isArray(poll.data) ? poll.data : [];
  const items = list.map((x) => x.deploy || x).filter(Boolean);
  const last = items.find((d) => d.trigger === 'api') || items[0];
  status = last?.status || 'unknown';
  console.log(`[deploy] poll ${i + 1}: ${status}`);
}
if (status !== 'live') throw new Error(`deploy ended ${status} — see Render dashboard for logs`);

const info = await call('GET', `/services/${serviceId}`);
const svc = info.data?.service || info.data || {};
const url = svc.serviceDetails?.url || svc.url || `https://${NAME}.onrender.com`;
console.log(`[deploy] LIVE at ${url}`);

try {
  const h = await fetch(`${url}/api/health`);
  const hb = await h.json();
  console.log(`[deploy] public health: HTTP ${h.status} mode=${hb?.storage?.mode} service=${hb?.service}`);
  if (h.status !== 200 || hb?.storage?.mode !== 'cockroach') process.exitCode = 1;
} catch (e) {
  throw new Error(`public health check failed: ${e.message}`);
}
