/**
 * Wait for the Render static site to finish deploying the commit that was just
 * pushed, and report the deploy this app is actually serving. No secret printed.
 *
 *   node _wait_deploy_app.mjs [commit-sha]
 *
 * The service has autoDeploy on, so the push starts the build itself; this only
 * waits for that build and names it. Bounded — re-run it if it is still building.
 */
import process from 'node:process';

const API = 'https://api.render.com/v1';
const SERVICE_ID = 'srv-dabs4a67bikc73e3uma0';
const APP_URL = 'https://broodiinnox-app.onrender.com';
const SHA = process.argv[2] || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = process.env.RENDER_API_KEY;
if (!KEY) throw new Error('no RENDER_API_KEY in the environment');

async function call(path) {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${KEY}` } });
  return r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status} ${path}`));
}

const items = (await call(`/services/${SERVICE_ID}/deploys?limit=12`)).map((x) => x.deploy || x).filter(Boolean);
const mine = items.find((d) => SHA && (d.commit?.id || '').startsWith(SHA)) || items[0];
if (!mine) throw new Error('this service has no deploys');
console.log(`[app] deploy ${mine.id} commit ${(mine.commit?.id || '?').slice(0, 7)} "${(mine.commit?.message || '').split('\n')[0].slice(0, 60)}" trigger ${mine.trigger}`);

const DONE = ['live', 'build_failed', 'deploy_failed', 'canceled'];
const deadline = Date.now() + 100_000;
let status = mine.status;
while (!DONE.includes(status) && Date.now() < deadline) {
  console.log(`[app] ${new Date().toISOString().slice(11, 19)} ${status}`);
  await sleep(7000);
  const now = (await call(`/services/${SERVICE_ID}/deploys?limit=12`)).map((x) => x.deploy || x).filter(Boolean);
  status = (now.find((d) => d.id === mine.id) || {}).status || status;
}
console.log(`[app] ${status} at ${APP_URL}`);
if (status !== 'live') process.exitCode = ['build_failed', 'deploy_failed', 'canceled'].includes(status) ? 1 : 3;
