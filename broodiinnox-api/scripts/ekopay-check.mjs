/**
 * Does Ekorana actually accept the gateway credentials in this environment?
 *
 *   node scripts/ekopay-check.mjs
 *   node scripts/ekopay-check.mjs --json
 *
 * `GET /api/health` answers "is the server configured?" — this answers "does
 * the gateway accept it?". They are different questions, and only the second
 * one catches an API key that was pasted with a space in it, has expired, or
 * was never activated. Without this check the first person to find out is a
 * farmer whose payment will not go through.
 *
 * Reads broodiinnox-api/.env when it exists (real environment variables win),
 * sends nothing but a status read for a reference that cannot exist, and prints
 * no value — only whether each variable is set and how long it is.
 *
 *   exit 0  Ekorana accepts the credentials
 *   exit 1  Ekorana rejected them (message says which one to look at)
 *   exit 2  not configured (message names the variables still to be set)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EKOPAY_REQUIRED_ENV, describeEkopayConfig, resolveEkopayConfig, verifyEkopayCredentials,
} from '../lib/ekopay.js';

const asJson = process.argv.includes('--json');

/* --- environment: broodiinnox-api/.env first, real variables win --------- */
const envFile = join(import.meta.dirname, '..', '.env');
let fromFile = {};
try {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    fromFile[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
} catch { /* no .env — process.env alone is fine */ }
const env = { ...fromFile, ...process.env };

const config = resolveEkopayConfig(env);
const publicConfig = describeEkopayConfig(config);

/* Which of the required variables are set, and how long — never what they are. */
const credentials = Object.fromEntries(EKOPAY_REQUIRED_ENV.map((k) => [
  k,
  config.missing.includes(k)
    ? 'MISSING'
    : config.invalid.includes(k)
      ? `set but unusable (${String(env[k] ?? '').trim().length} chars)`
      : `set (${String(env[k] ?? '').trim().length} chars)`,
]));

const verdict = await verifyEkopayCredentials(config);

if (asJson) {
  console.log(JSON.stringify({
    env_file: Object.keys(fromFile).length ? envFile : null,
    config: publicConfig,
    credentials,
    verdict,
  }, null, 2));
} else {
  console.log(`[ekopay-check] env:       ${Object.keys(fromFile).length ? envFile : '(process environment only)'}`);
  console.log(`[ekopay-check] credentials: ${EKOPAY_REQUIRED_ENV.map((k) => `${k} ${credentials[k]}`).join(' · ')}`);
  console.log(`[ekopay-check] gateway:   ${config.baseUrl} currency=${config.currency} min=${config.minAmount} callback=${config.callbackUrl}`);
  const tag = verdict.ok ? 'OK' : verdict.step === 'config' ? 'NOT CONFIGURED' : 'REJECTED';
  console.log(`[ekopay-check] ${tag} (${verdict.step}${verdict.status ? ` ${verdict.status}` : ''}): ${verdict.message}`);
  if (!verdict.ok && verdict.step === 'config') {
    console.log('[ekopay-check] set them in broodiinnox-api/.env for local runs, or on Render (broodiinnox-api → Environment) for the live service.');
  }
}

process.exit(verdict.ok ? 0 : verdict.step === 'config' ? 2 : 1);
