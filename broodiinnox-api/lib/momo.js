/**
 * MTN Mobile Money (MoMo) — Collections API client.
 *
 * This is the ONLY place MoMo credentials are used. They are read from the
 * server's environment (`process.env`), never from the browser, and never
 * echoed in a response — a dashboard sees payment records, never secrets.
 *
 * Flow (MTN MoMo Collections, "request to pay"):
 *
 *   1. POST /collection/token/                        Basic apiUser:apiKey -> access token
 *   2. POST /collection/v1_0/requesttopay             Bearer token + X-Reference-Id -> 202
 *      (the payer gets a prompt on their phone and approves it with their MoMo PIN)
 *   3. GET  /collection/v1_0/requesttopay/<reference> -> PENDING | SUCCESSFUL | FAILED
 *
 * Step 3 — the provider's own answer — is the ONLY thing that ever confirms a
 * payment. Nothing a browser sends can mark a payment successful.
 *
 * Environment (read per request, so an env change needs only a restart):
 *
 *   MOMO_SUBSCRIPTION_KEY     Ocp-Apim-Subscription-Key of the Collections product
 *   MOMO_API_USER             API user (UUID) created for this app
 *   MOMO_API_KEY              API key of that user
 *   MOMO_TARGET_ENVIRONMENT   sandbox (default) | mtnrwanda (live)
 *   MOMO_BASE_URL             default https://sandbox.momodeveloper.mtn.com
 *   MOMO_CURRENCY             default RWF
 *   MOMO_CALLBACK_URL         optional public https URL for payment notifications
 *   MOMO_COUNTRY_CODE         default 250 (Rwanda) — used to normalize MSISDNs
 *   MOMO_TIMEOUT_MS           default 15000
 *
 * Everything here is pure or fetch-injectable, so it is tested without a
 * network (test/momo.test.js).
 *
 * verifyMomoCredentials() asks MTN itself whether the configured credentials
 * work — the question GET /api/health cannot answer, and the one
 * scripts/momo-check.mjs exists to ask.
 */

export const MOMO_SANDBOX_BASE = 'https://sandbox.momodeveloper.mtn.com';

/** The env vars that must all be present before a payment can be requested. */
export const MOMO_REQUIRED_ENV = ['MOMO_SUBSCRIPTION_KEY', 'MOMO_API_USER', 'MOMO_API_KEY'];

export class MoMoError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.name = 'MoMoError';
    this.status = status;
    this.code = code;
  }
}

const str = (v) => (typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim());

function int(v, dflt) {
  const n = Number.parseInt(str(v), 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

/** Resolve the MoMo configuration from an environment object. */
export function resolveMomoConfig(env = process.env) {
  const e = env || {};
  const baseUrl = (str(e.MOMO_BASE_URL) || MOMO_SANDBOX_BASE).replace(/\/+$/, '');
  const subscriptionKey = str(e.MOMO_SUBSCRIPTION_KEY);
  const apiUser = str(e.MOMO_API_USER);
  const apiKey = str(e.MOMO_API_KEY);
  const missing = MOMO_REQUIRED_ENV.filter((k) => !str(e[k]));
  const urlOk = /^https?:\/\/[^/]+/.test(baseUrl);
  return {
    enabled: missing.length === 0 && urlOk,
    missing: urlOk ? missing : [...missing, 'MOMO_BASE_URL'],
    subscriptionKey,
    apiUser,
    apiKey,
    baseUrl,
    targetEnvironment: str(e.MOMO_TARGET_ENVIRONMENT) || 'sandbox',
    currency: (str(e.MOMO_CURRENCY) || 'RWF').toUpperCase(),
    callbackUrl: str(e.MOMO_CALLBACK_URL),
    countryCode: str(e.MOMO_COUNTRY_CODE).replace(/\D/g, '') || '250',
    timeoutMs: int(e.MOMO_TIMEOUT_MS, 15_000),
  };
}

/**
 * What the server may say about its MoMo configuration in public: whether it
 * is usable, where it points and what is missing. NEVER the key values.
 */
export function describeMomoConfig(config) {
  return {
    enabled: !!config?.enabled,
    target_environment: config?.targetEnvironment || 'sandbox',
    currency: config?.currency || 'RWF',
    callback_configured: !!config?.callbackUrl,
    missing: (config?.missing || []).slice(),
  };
}

/** A payment that cannot be requested without a configured provider says why. */
export function momoNotConfiguredMessage(config) {
  const missing = (config?.missing || MOMO_REQUIRED_ENV).join(', ');
  return `MTN MoMo is not configured on the server — set ${missing} in the environment (Render: broodiinnox-api → Environment) and restart.`;
}

/**
 * Normalize a phone number to the MSISDN form MoMo expects: digits only,
 * country code first, no "+" (e.g. 0788123456 -> 250788123456).
 * Returns null when the number cannot be one.
 */
export function normalizeMsisdn(phone, countryCode = '250') {
  if (typeof phone !== 'string' && typeof phone !== 'number') return null;
  let s = String(phone).replace(/[\s()\-.]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  else if (s.startsWith('00')) s = s.slice(2);
  if (!/^\d+$/.test(s)) return null;

  const cc = String(countryCode || '250').replace(/\D/g, '') || '250';
  if (s.startsWith('0')) s = cc + s.replace(/^0+/, '');
  else if (!s.startsWith(cc) && s.length <= 9) s = cc + s; // "788123456" -> "250788123456"

  if (!s.startsWith(cc)) return null;
  if (s.length < cc.length + 8 || s.length > 15) return null;
  return s;
}

/** Map a MoMo `status` onto this platform's payment states. */
export function interpretMomoStatus(body) {
  const raw = str(body?.status).toUpperCase();
  const reason = body?.reason ? String(body.reason) : null;
  const common = {
    reason,
    financialTransactionId: body?.financialTransactionId ? String(body.financialTransactionId) : null,
    payer: body?.payer?.partyId ? String(body.payer.partyId) : null,
    // What was actually collected. Carried through so the caller can check it
    // against what was requested: a SUCCESSFUL for the wrong amount must never
    // be treated as the payment that was asked for.
    amount: body?.amount !== undefined && body?.amount !== null && body?.amount !== '' ? body.amount : null,
    currency: body?.currency ? String(body.currency) : null,
  };
  // An unknown or missing status is PENDING, never a success and never a
  // failure: a provider answer we do not understand must not move money or
  // unlock a device.
  if (raw === 'SUCCESSFUL') return { ...common, status: 'successful' };
  if (['FAILED', 'REJECTED', 'TIMEOUT', 'CANCELLED', 'CANCELED'].includes(raw)) {
    return { ...common, status: 'failed' };
  }
  return { ...common, status: 'pending', reason };
}

/** Plain words for the failure reasons MTN returns. */
export function momoReasonMessage(reason) {
  const r = str(reason).toUpperCase();
  const map = {
    PAYER_NOT_FOUND: 'That number is not an MTN MoMo account.',
    PAYEE_NOT_FOUND: 'The receiving MoMo account was not found.',
    NOT_ALLOWED: 'This MoMo account is not allowed to make this payment.',
    NOT_ALLOWED_TARGET_ENVIRONMENT: 'The MoMo account cannot pay the target environment configured on the server.',
    INVALID_CALLBACK_URL_HOST: 'MoMo rejected the configured callback URL host.',
    INVALID_CURRENCY: 'MoMo does not accept the currency configured on the server.',
    AMOUNT_NOT_ALLOWED: 'The amount is not allowed by MoMo for this account.',
    SERVICE_UNAVAILABLE: 'MTN MoMo is temporarily unavailable — try again in a moment.',
    INTERNAL_PROCESSING_ERROR: 'MTN MoMo could not process the request — try again in a moment.',
    COULD_NOT_PERFORM_TRANSACTION: 'The transaction could not be performed — try again.',
    APPROVAL_REJECTED: 'The payment was rejected on the phone.',
    EXPIRED: 'The MoMo prompt expired before it was approved — request it again.',
    RESOURCE_ALREADY_EXIST: 'This payment reference was already used — request the payment again.',
    RESOURCE_NOT_FOUND: 'MTN MoMo does not know this payment reference.',
  };
  return map[r] || null;
}

/** A friendly message for a failed HTTP call to MoMo. */
export function momoErrorMessage(err) {
  const status = err?.status ?? null;
  const reason = momoReasonMessage(err?.body?.reason);
  if (reason) return reason;
  if (status === 400) return 'MTN MoMo rejected the request (400). Check the amount, currency and number.';
  if (status === 401 || status === 403) return 'MTN MoMo rejected the API credentials (401/403) — check MOMO_SUBSCRIPTION_KEY, MOMO_API_USER and MOMO_API_KEY.';
  if (status === 404) return 'MTN MoMo does not know the target environment or reference (404) — check MOMO_TARGET_ENVIRONMENT.';
  if (status === 409) return 'This payment reference was already used — request the payment again.';
  if (status === 429) return 'MTN MoMo is rate-limiting this server (429) — try again shortly.';
  if (status === 500 || status === 502 || status === 503) return 'MTN MoMo is temporarily unavailable — try again in a moment.';
  if (err?.code === 'timeout') return 'MTN MoMo did not answer in time — try again.';
  if (err?.code === 'network') return 'Could not reach MTN MoMo — check the server’s network and MOMO_BASE_URL.';
  return err?.message || 'The MTN MoMo request failed.';
}

/**
 * Create the MoMo Collections client. `fetchImpl` and `newReference` are
 * injectable so the whole flow is testable without a network.
 */
export function createMomoClient(config, { fetchImpl, newReference, now } = {}) {
  const cfg = config || {};
  if (!cfg.enabled) {
    throw new MoMoError(momoNotConfiguredMessage(cfg), { code: 'not-configured' });
  }
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') throw new MoMoError('no fetch implementation available', { code: 'network' });

  const clock = typeof now === 'function' ? now : () => Date.now();
  const makeReference = typeof newReference === 'function' ? newReference : newMomoReference;
  const basic = Buffer.from(`${cfg.apiUser}:${cfg.apiKey}`).toString('base64');
  let tokenCache = { value: null, expiresAt: 0 };

  async function call(path, { method = 'GET', body, bearer, referenceId, callback = false } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs || 15_000);
    try {
      const res = await doFetch(`${cfg.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: bearer ? `Bearer ${bearer}` : `Basic ${basic}`,
          'Ocp-Apim-Subscription-Key': cfg.subscriptionKey,
          'X-Target-Environment': cfg.targetEnvironment,
          ...(referenceId ? { 'X-Reference-Id': referenceId } : {}),
          // MTN posts its verdict here as soon as the payer answers. The app
          // polls as well, so a callback that never arrives (a sleeping
          // free-tier server, a blocked host) delays nothing permanently —
          // see MOMO_CALLBACK_URL.
          ...(callback && cfg.callbackUrl ? { 'X-Callback-Url': cfg.callbackUrl } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      let data = null;
      if (text) {
        try { data = JSON.parse(text); } catch { data = { raw: text }; }
      }
      if (!res.ok) {
        throw new MoMoError(momoErrorMessage({ status: res.status, body: data }), { status: res.status, code: 'provider' });
      }
      return data || {};
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new MoMoError('MTN MoMo did not answer in time', { code: 'timeout' });
      }
      if (err instanceof MoMoError) throw err;
      throw new MoMoError(`Could not reach MTN MoMo: ${err.message}`, { code: 'network' });
    } finally {
      clearTimeout(timer);
    }
  }

  /** A Collections access token, reused until it is nearly expired. */
  async function token() {
    const nowMs = clock();
    if (tokenCache.value && tokenCache.expiresAt - 30_000 > nowMs) return tokenCache.value;
    const data = await call('/collection/token/', { method: 'POST' });
    const value = data?.access_token;
    if (!value) throw new MoMoError('MTN MoMo returned no access token', { code: 'provider' });
    const ttl = Number(data?.expires_in);
    tokenCache = { value, expiresAt: nowMs + (Number.isFinite(ttl) && ttl > 0 ? ttl : 3600) * 1000 };
    return value;
  }

  /**
   * Ask the payer to pay. The payload is exactly what Collections expects:
   * amounts travel as strings, the payer is an MSISDN, and the reference id is
   * ours (and is what the status endpoint is polled with later).
   * Returns { referenceId, status: 'pending' } — 202 means "prompt sent", not
   * "paid": only getStatus() decides that.
   */
  async function requestToPay({ amount, currency, externalId, payer, payerMessage, payeeNote, referenceId } = {}) {
    const ref = referenceId ? String(referenceId) : makeReference();
    const msidn = normalizeMsisdn(payer, cfg.countryCode);
    if (!msidn) throw new MoMoError('A valid MTN MoMo number is required', { code: 'invalid-phone' });
    const value = Number(amount);
    if (!Number.isInteger(value) || value <= 0) {
      throw new MoMoError('A positive whole amount is required', { code: 'invalid-amount' });
    }
    const bearer = await token();
    await call('/collection/v1_0/requesttopay', {
      method: 'POST',
      bearer,
      referenceId: ref,
      callback: true,
      body: {
        amount: String(value),
        currency: (currency || cfg.currency).toUpperCase(),
        externalId: String(externalId || ref),
        payer: { partyIdType: 'MSISDN', partyId: msidn },
        payerMessage: payerMessage || 'Broodiinnox subscription',
        payeeNote: payeeNote || 'Broodiinnox subscription payment',
      },
    });
    return { referenceId: ref, status: 'pending', payer: msidn };
  }

  /** The provider's own verdict on one request-to-pay reference. */
  async function getStatus(referenceId) {
    if (!referenceId) throw new MoMoError('A payment reference is required', { code: 'invalid-reference' });
    const bearer = await token();
    const data = await call(`/collection/v1_0/requesttopay/${encodeURIComponent(referenceId)}`, { bearer });
    return { ...interpretMomoStatus(data), raw: data, referenceId: String(referenceId) };
  }

  return {
    config: cfg,
    token,
    requestToPay,
    getStatus,
    /** Internal token cache, exposed for tests (never contains credentials). */
    _peekToken: () => tokenCache.value,
  };
}

/**
 * RFC 4122 v4 reference id, using the platform's crypto when available.
 * This is the X-Reference-Id of a request-to-pay, and is what its status is
 * polled with later — so it is generated BEFORE the call and recorded with the
 * payment, making a request that failed mid-flight traceable at MoMo.
 */
export function newMomoReference() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const hex = () => Math.floor(Math.random() * 65536).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

/**
 * Ask MTN whether the configured credentials actually work.
 *
 * `resolveMomoConfig().enabled` only says the variables are *present*, which
 * is all `GET /api/health` can report. A subscription key that was pasted
 * with a space in it, has expired, belongs to another product, or belongs to
 * the other environment is "present" too — and without this check the first
 * person to find out would be a farmer whose payment will not go through.
 *
 * Returns a verdict rather than throwing:
 *
 *   { ok, step, status, message }   step: 'config' | 'token' | 'collections'
 *
 * `message` is a sentence an operator can act on, and no credential value is
 * ever echoed back.
 */
export async function verifyMomoCredentials(config, { fetchImpl, newReference } = {}) {
  const cfg = config || {};
  if (!cfg.enabled) {
    return { ok: false, step: 'config', status: null, message: momoNotConfiguredMessage(cfg) };
  }

  let client;
  try {
    client = createMomoClient(cfg, { fetchImpl, newReference });
  } catch (err) {
    return { ok: false, step: 'config', status: null, message: err.message };
  }

  // Step 1 — the token. MTN gates this call on all three credentials, so it is
  // what separates "set" from "accepted".
  try {
    await client.token();
  } catch (err) {
    return { ok: false, step: 'token', status: err?.status ?? null, message: err.message };
  }

  // Step 2 — read a reference that cannot exist. 404 RESOURCE_NOT_FOUND is the
  // healthy answer (it proves the Collections product answers for these
  // credentials); 401/403 here is a different failure from a bad password.
  const ref = typeof newReference === 'function' ? newReference() : newMomoReference();
  try {
    await client.getStatus(ref);
    return {
      ok: true,
      step: 'collections',
      status: 200,
      message: `MTN MoMo accepts these credentials (${cfg.targetEnvironment}, ${cfg.currency}).`,
    };
  } catch (err) {
    if (err?.status === 404) {
      return {
        ok: true,
        step: 'collections',
        status: 404,
        message: `MTN MoMo accepts these credentials and answers the Collections API for ${cfg.targetEnvironment}.`,
      };
    }
    return { ok: false, step: 'collections', status: err?.status ?? null, message: err.message };
  }
}
