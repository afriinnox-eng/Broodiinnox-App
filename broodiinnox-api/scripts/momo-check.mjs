/**
 * Does MTN actually accept the MoMo credentials in this environment?
 *
 *   node scripts/momo-check.mjs
 *   node scripts/momo-check.mjs --json
 *
 * `GET /api/health` answers "is the server configured?" — this answers "does
 * MTN accept it?". They are different questions, and only the second one
 * catches a subscription key that was pasted wrong, has expired, belongs to
 * another product, or belongs to the other environment. Without this check the
 * first person to find out is a farmer whose payment will not go through.
 *
 * Reads broodiinnox-api/.env when it exists (real environment variables win),
 * sends nothing but a token request and one reference lookup, and prints no
 * value — only whether each variable is set and how long it is.
 *
 *   exit 0  MTN accepts the credentials
 *   exit 1  MTN rejected them (message says which one to look at)
 *   exit 2  not configured (message names the missing variables)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MOMO_REQUIRED_ENV, describeMomoConfig, resolveMomoConfig, verifyMomoCredentials,
} from '../lib/momo.js';

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

const config = resolveMomoConfig(env);
const publicConfig = describeMomoConfig(config);

/* Which of the three are set, and how long — never what they are. */
const credentials = Object.fromEntries(MOMO_REQUIRED_ENV.map((k) => [
  k,
  config.missing.includes(k) ? 'MISSING' : `set (${String(env[k] ?? '').trim().length} chars)`,
]));

const verdict = await verifyMomoCredentials(config);

if (asJson) {
  console.log(JSON.stringify({
    env_file: Object.keys(fromFile).length ? envFile : null,
    config: publicConfig,
    credentials,
    verdict,
  }, null, 2));
} else {
  console.log(`[momo-check] env:       ${Object.keys(fromFile).length ? envFile : '(process environment only)'}`);
  console.log(`[momo-check] credentials: ${MOMO_REQUIRED_ENV.map((k) => `${k} ${credentials[k]}`).join(' · ')}`);
  console.log(`[momo-check] provider:  ${config.baseUrl} target=${config.targetEnvironment} currency=${config.currency} callback=${config.callbackUrl ? 'yes' : 'no'}`);
  const tag = verdict.ok ? 'OK' : verdict.step === 'config' ? 'NOT CONFIGURED' : 'REJECTED';
  console.log(`[momo-check] ${tag} (${verdict.step}${verdict.status ? ` ${verdict.status}` : ''}): ${verdict.message}`);
  if (!verdict.ok && verdict.step === 'config') {
    console.log('[momo-check] set them in broodiinnox-api/.env for local runs, or on Render (broodiinnox-api → Environment) for the live service.');
  }
}

process.exit(verdict.ok ? 0 : verdict.step === 'config' ? 2 : 1);
