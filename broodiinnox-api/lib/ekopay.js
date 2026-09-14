/**
 * Ekorana Payment Gateway ("Ekopay") — the MTN Mobile Money collection this
 * platform actually runs on.
 *
 * This is the ONLY place the gateway's API key is used. It is read from the
 * server's environment (`process.env`), never from the browser, and never
 * echoed in a response or a log — a dashboard sees payment records, never a
 * credential. The key travels as a query parameter (the gateway's own scheme,
 * `?apiKey=…`), which is why the request URL is built here and never printed.
 *
 * Flow (Ekorana Payment Gateway API — Initiate Payment):
 *
 *   1. POST /payment/initiate?apiKey=…   201
 *        { amount, referenceId, phoneNumber, transferPhone, callbackUrl,
 *          senderMessage? }
 *      The payer gets a prompt on their phone and approves it with their MoMo
 *      PIN. 201 means "requested", never "paid".
 *   2. GET  /payment/status/<referenceId>?apiKey=…
 *        → pending | success | failed
 *   3. POST <callbackUrl>   the gateway posts
 *        { referenceId, status, statusCode, date, amount, message }
 *      and expects HTTP 200 within 10 seconds; it retries three times, at 30 s,
 *      60 s and 120 s. The callback body is trusted for nothing — step 2 is
 *      asked again — so a duplicate or a forged notification changes nothing.
 *
 * Step 2 — the gateway's own answer — is the ONLY thing that ever confirms a
 * payment. Nothing a browser sends can mark a payment successful.
 *
 * Environment (read per request, so an env change needs only a restart):
 *
 *   EKOPAY_API_KEY            your Ekorana API key (the `apiKey` query parameter)
 *   EKOPAY_TRANSFER_PHONE     your merchant MTN number — where the money lands
 *   EKOPAY_BASE_URL           default https://api.payment.ekorana.com/api/v1
 *   EKOPAY_CALLBACK_URL       where the gateway posts the verdict; defaults to
 *                             this deployment's public callback
 *   EKOPAY_CURRENCY           default RWF — the gateway collects in RWF
 *   EKOPAY_COUNTRY_CODE       default 250 (Rwanda) — used to normalize MSISDNs
 *   EKOPAY_MIN_AMOUNT         default 50 — the gateway's own floor
 *   EKOPAY_TIMEOUT_MS         default 8000 — under the gateway's 10 s callback budget
 *
 * Everything here is pure or fetch-injectable, so it is tested without a
 * network (test/ekopay.test.js).
 *
 * verifyEkopayCredentials() asks the gateway itself whether the configured key
 * works — the question GET /api/health cannot answer, and the one
 * scripts/ekopay-check.mjs exists to ask.
 */

export const EKOPAY_BASE_URL = 'https://api.payment.ekorana.com/api/v1';

/** The env vars that must all be present and usable before a payment can be requested. */
export const EKOPAY_REQUIRED_ENV = ['EKOPAY_API_KEY', 'EKOPAY_TRANSFER_PHONE'];

/** The gateway's own floor, in RWF: "amount must be at least 50". */
export const EKOPAY_MIN_AMOUNT = 50;

/**
 * Where Ekorana posts the verdict when EKOPAY_CALLBACK_URL is not set. The app
 * polls as well, so a callback that never arrives (a sleeping free-tier
 * service, a gateway retry that gives up) delays nothing permanently — but the
 * URL is a required field of the initiate request, so there is always one.
 */
export const EKOPAY_CALLBACK_PATH = '/api/payments/ekopay/callback';
export const EKOPAY_DEFAULT_CALLBACK_URL = `https://broodiinnox-api.onrender.com${EKOPAY_CALLBACK_PATH}`;

export class EkopayError extends Error {
  constructor(message, { status = null, code = null, body = null } = {}) {
    super(message);
    this.name = 'EkopayError';
    this.status = status;
    this.code = code;
    /** The gateway's own error body — read for the reason, never echoed back. */
    this.body = body;
  }
}

const str = (v) => (typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim());

/**
 * The API key travels in the request URL, so an error message that quotes a
 * URL quotes a credential. Nothing that leaves this module may carry one.
 */
const scrub = (text, key) => (key ? String(text ?? '').split(key).join('[redacted]') : String(text ?? ''));

function int(v, dflt) {
  const n = Number.parseInt(str(v), 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

/**
 * Normalize a phone number to the MSISDN form the gateway expects: digits
 * only, country code first, no "+" (e.g. 0788123456 -> 250788123456).
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

/**
 * Resolve the gateway configuration from an environment object.
 *
 * `missing` is a variable that is not set at all; `invalid` is one that is set
 * but unusable (a base URL that is not a URL, a merchant number that cannot be
 * an MSISDN). Both stop payments — and both are named, so a half-configured
 * deployment is never mistaken for a working one.
 */
export function resolveEkopayConfig(env = process.env) {
  const e = env || {};
  const baseUrl = (str(e.EKOPAY_BASE_URL) || EKOPAY_BASE_URL).replace(/\/+$/, '');
  const apiKey = str(e.EKOPAY_API_KEY);
  const transferPhoneRaw = str(e.EKOPAY_TRANSFER_PHONE);
  const countryCode = str(e.EKOPAY_COUNTRY_CODE).replace(/\D/g, '') || '250';

  const missing = [];
  if (!apiKey) missing.push('EKOPAY_API_KEY');
  if (!transferPhoneRaw) missing.push('EKOPAY_TRANSFER_PHONE');

  const invalid = [];
  const urlOk = /^https?:\/\/[^/]+/.test(baseUrl);
  if (!urlOk) invalid.push('EKOPAY_BASE_URL');
  const transferPhone = transferPhoneRaw ? normalizeMsisdn(transferPhoneRaw, countryCode) : null;
  if (transferPhoneRaw && !transferPhone) invalid.push('EKOPAY_TRANSFER_PHONE');

  return {
    enabled: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
    apiKey,
    baseUrl,
    transferPhone,
    callbackUrl: str(e.EKOPAY_CALLBACK_URL) || EKOPAY_DEFAULT_CALLBACK_URL,
    currency: (str(e.EKOPAY_CURRENCY) || 'RWF').toUpperCase(),
    countryCode,
    minAmount: int(e.EKOPAY_MIN_AMOUNT, EKOPAY_MIN_AMOUNT),
    timeoutMs: int(e.EKOPAY_TIMEOUT_MS, 8_000),
  };
}

/**
 * What the server may say about its gateway configuration in public: whether it
 * is usable, where it points and what is still to be set. NEVER the key, and
 * never the merchant number — only whether one is there.
 */
export function describeEkopayConfig(config) {
  return {
    enabled: !!config?.enabled,
    base_url: config?.baseUrl || EKOPAY_BASE_URL,
    currency: config?.currency || 'RWF',
    min_amount: config?.minAmount ?? EKOPAY_MIN_AMOUNT,
    transfer_phone_set: !!config?.transferPhone,
    callback_configured: !!config?.callbackUrl,
    missing: (config?.missing || []).slice(),
    invalid: (config?.invalid || []).slice(),
  };
}

/** A payment that cannot be requested without a configured gateway says why. */
export function ekopayNotConfiguredMessage(config) {
  const parts = [];
  if ((config?.missing || []).length) parts.push(`set ${config.missing.join(', ')}`);
  if ((config?.invalid || []).length) parts.push(`fix ${config.invalid.join(', ')}`);
  const what = parts.length ? parts.join(' and ') : `set ${EKOPAY_REQUIRED_ENV.join(', ')}`;
  return `The Ekorana payment gateway is not configured on the server — ${what} in the environment (Render: broodiinnox-api → Environment) and restart.`;
}

/** A reference that cannot exist, for the credential probe in scripts/ekopay-check.mjs. */
export function newEkopayProbeReference() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return `probe-${c.randomUUID()}`;
  return `probe-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Map the gateway's `status` onto this platform's payment states.
 *
 * The documented values are `pending`, `success` and `failed`; the callback
 * also carries a `statusCode` where "200 = success, other = failed". The two
 * are read together and the answer that says money did NOT move wins — a
 * "success" sitting next to a non-200 code is a failure, not a payment.
 *
 * An unknown or missing status is PENDING, never a success and never a failure:
 * an answer we do not understand must not move money or unlock a device.
 */
export function interpretEkopayStatus(body) {
  const raw = str(body?.status).toLowerCase();
  const code = body?.statusCode === undefined || body?.statusCode === null || body?.statusCode === ''
    ? null
    : Number(body.statusCode);

  const common = {
    reason: body?.message ? String(body.message) : body?.reason ? String(body.reason) : null,
    financialTransactionId: body?.transactionId ? String(body.transactionId) : null,
    payer: body?.phoneNumber ? String(body.phoneNumber) : null,
    // What was actually collected. Carried through so the caller can check it
    // against what was requested: a success for the wrong amount must never be
    // treated as the payment that was asked for.
    amount: body?.amount !== undefined && body?.amount !== null && body?.amount !== '' ? body.amount : null,
    // The gateway collects in RWF and does not report a currency; when one does
    // travel with the answer it is checked all the same.
    currency: body?.currency ? String(body.currency) : null,
  };

  if (['success', 'successful', 'completed', 'paid'].includes(raw)) {
    if (code !== null && code !== 200) return { ...common, status: 'failed' };
    return { ...common, status: 'successful' };
  }
  if (['failed', 'failure', 'error', 'rejected', 'cancelled', 'canceled', 'expired'].includes(raw)) {
    return { ...common, status: 'failed' };
  }
  return { ...common, status: 'pending' };
}

/** Plain words for the errors Ekorana documents. */
export function ekopayReasonMessage(reason) {
  const r = str(reason);
  if (!r) return null;
  if (/already exists/i.test(r)) return 'This payment reference was already used — request the payment again.';
  if (/at least 50|at least \d+/i.test(r)) return `The amount is below the gateway's minimum of ${EKOPAY_MIN_AMOUNT} RWF.`;
  if (/invalid phone/i.test(r)) return 'That number is not one the payment gateway can charge — check it and try again.';
  if (/not active/i.test(r)) return 'The payment gateway says this API key is not active — ask Ekorana to activate it.';
  if (/invalid api key/i.test(r)) return 'The payment gateway rejected the API key — check EKOPAY_API_KEY in the server environment.';
  if (/transaction not found/i.test(r)) return 'The payment gateway does not know this transaction — request the payment again.';
  return null;
}

/** A friendly message for a failed HTTP call to the gateway. */
export function ekopayErrorMessage(err) {
  const status = err?.status ?? null;
  const reason = ekopayReasonMessage(err?.body?.error || err?.body?.message);
  if (reason) return reason;
  if (status === 400) return 'The payment gateway rejected the request (400) — check the amount, the number and the reference.';
  if (status === 401 || status === 403) return 'The payment gateway rejected the API key (401/403) — check EKOPAY_API_KEY in the server environment.';
  if (status === 404) return 'The payment gateway does not know this transaction (404) — request the payment again.';
  if (status === 409) return 'This payment reference was already used — request the payment again.';
  if (status === 429) return 'The payment gateway is rate-limiting this server (429) — try again shortly.';
  if (status === 500 || status === 502 || status === 503) return 'The payment gateway is temporarily unavailable — try again in a moment.';
  if (err?.code === 'timeout') return 'The payment gateway did not answer in time — try again.';
  if (err?.code === 'network') return 'Could not reach the payment gateway — check the server’s network and EKOPAY_BASE_URL.';
  return err?.message || 'The payment request failed.';
}

/**
 * The short reason code a failed attempt is recorded under. The dashboard turns
 * these into a sentence; anything unrecognised falls back to REQUEST_FAILED and
 * the plain-words message the API sent alongside it.
 */
export function ekopayFailureReason(err) {
  const raw = str(err?.body?.error || err?.body?.message);
  if (/already exists/i.test(raw)) return 'REFERENCE_EXISTS';
  if (/at least/i.test(raw)) return 'AMOUNT_TOO_SMALL';
  if (/invalid phone/i.test(raw)) return 'INVALID_PHONE';
  if (/not active/i.test(raw)) return 'API_KEY_INACTIVE';
  if (/invalid api key/i.test(raw)) return 'INVALID_API_KEY';
  if (/transaction not found/i.test(raw)) return 'TRANSACTION_NOT_FOUND';
  if (err?.status === 401 || err?.status === 403) return 'INVALID_API_KEY';
  if (err?.code === 'timeout') return 'TIMEOUT';
  if (err?.code === 'network') return 'NETWORK';
  if (err?.code === 'not-configured') return 'NOT_CONFIGURED';
  if (err?.code === 'invalid-phone') return 'INVALID_PHONE';
  if (err?.code === 'invalid-amount') return 'AMOUNT_TOO_SMALL';
  return 'REQUEST_FAILED';
}

/**
 * Create the Ekorana gateway client. `fetchImpl` is injectable so the whole
 * flow is testable without a network.
 */
export function createEkopayClient(config, { fetchImpl } = {}) {
  const cfg = config || {};
  if (!cfg.enabled) {
    throw new EkopayError(ekopayNotConfiguredMessage(cfg), { code: 'not-configured' });
  }
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') throw new EkopayError('no fetch implementation available', { code: 'network' });

  // The key is a query parameter — the gateway's own scheme — so the URL is a
  // credential. It is built here and never logged, returned or thrown.
  const withKey = (path) => `${cfg.baseUrl}${path}${path.includes('?') ? '&' : '?'}apiKey=${encodeURIComponent(cfg.apiKey)}`;

  async function call(path, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs || 8_000);
    try {
      const res = await doFetch(withKey(path), {
        method,
        headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      let data = null;
      if (text) {
        try { data = JSON.parse(text); } catch { data = { raw: text }; }
      }
      if (!res.ok) {
        throw new EkopayError(ekopayErrorMessage({ status: res.status, body: data }), { status: res.status, code: 'provider', body: data });
      }
      return data || {};
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new EkopayError('The payment gateway did not answer in time', { code: 'timeout' });
      }
      if (err instanceof EkopayError) throw err;
      throw new EkopayError(scrub(`Could not reach the payment gateway: ${err.message}`, cfg.apiKey), { code: 'network' });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Ask the payer to pay. Returns { referenceId, transactionId, status:
   * 'pending' } — 201 means "prompt sent", not "paid": only getStatus() decides
   * that. The payer and the merchant number travel as MSISDNs, the amount as
   * the integer the gateway documents.
   */
  async function initiatePayment({ amount, referenceId, phone, transferPhone, callbackUrl, senderMessage } = {}) {
    if (!str(referenceId)) throw new EkopayError('A payment reference is required', { code: 'invalid-reference' });
    const msisdn = normalizeMsisdn(phone, cfg.countryCode);
    if (!msisdn) throw new EkopayError('A valid MTN MoMo number is required', { code: 'invalid-phone' });

    const value = Number(amount);
    if (!Number.isInteger(value) || value <= 0) {
      throw new EkopayError('A positive whole amount is required', { code: 'invalid-amount' });
    }
    if (value < (cfg.minAmount || EKOPAY_MIN_AMOUNT)) {
      throw new EkopayError(`The amount must be at least ${cfg.minAmount || EKOPAY_MIN_AMOUNT} RWF`, { code: 'invalid-amount' });
    }

    const transfer = normalizeMsisdn(transferPhone || cfg.transferPhone, cfg.countryCode);
    if (!transfer) throw new EkopayError('The merchant number to transfer to is not a valid MSISDN', { code: 'invalid-transfer-phone' });

    const cb = str(callbackUrl || cfg.callbackUrl);
    if (!cb) throw new EkopayError('The payment gateway requires a callback URL', { code: 'invalid-callback' });

    const data = await call('/payment/initiate', {
      method: 'POST',
      body: {
        amount: value,
        referenceId: String(referenceId),
        phoneNumber: msisdn,
        transferPhone: transfer,
        callbackUrl: cb,
        ...(str(senderMessage) ? { senderMessage: str(senderMessage).slice(0, 160) } : {}),
      },
    });

    // The documented shape is { transaction, message }; a bare transaction is
    // accepted too, so a gateway that answers the short way is not an error.
    const tx = data?.transaction || data;
    return {
      referenceId: str(tx?.referenceId) || String(referenceId),
      transactionId: tx?.transactionId ? String(tx.transactionId) : null,
      status: 'pending',
      payer: msisdn,
      amount: value,
      raw: data,
    };
  }

  /** The gateway's own verdict on one reference. */
  async function getStatus(referenceId) {
    if (!str(referenceId)) throw new EkopayError('A payment reference is required', { code: 'invalid-reference' });
    const data = await call(`/payment/status/${encodeURIComponent(referenceId)}`);
    return { ...interpretEkopayStatus(data), raw: data, referenceId: String(referenceId) };
  }

  return { config: cfg, initiatePayment, getStatus };
}

/**
 * Ask Ekorana whether the configured API key actually works.
 *
 * `resolveEkopayConfig().enabled` only says the variables are *present and
 * well-formed*, which is all `GET /api/health` can report. A key that was
 * pasted with a space in it, that has expired, or that was never activated
 * looks exactly the same there — and without this check the first person to
 * find out would be a farmer whose payment will not go through.
 *
 * Returns a verdict rather than throwing:
 *
 *   { ok, step, status, message }   step: 'config' | 'status'
 *
 * The probe is a status read for a reference that cannot exist. The gateway
 * gates that call on the key, so 404 "Transaction not found" is the healthy
 * answer and 401 is the rejection — and no credential value is ever echoed.
 */
export async function verifyEkopayCredentials(config, { fetchImpl, newReference } = {}) {
  const cfg = config || {};
  if (!cfg.enabled) {
    return { ok: false, step: 'config', status: null, message: ekopayNotConfiguredMessage(cfg) };
  }

  let client;
  try {
    client = createEkopayClient(cfg, { fetchImpl });
  } catch (err) {
    return { ok: false, step: 'config', status: null, message: err.message };
  }

  const ref = typeof newReference === 'function' ? newReference() : newEkopayProbeReference();
  try {
    await client.getStatus(ref);
    return {
      ok: true,
      step: 'status',
      status: 200,
      message: `The Ekorana gateway accepts this API key and answered a status read (${cfg.currency}).`,
    };
  } catch (err) {
    if (err?.status === 404) {
      return {
        ok: true,
        step: 'status',
        status: 404,
        message: 'The Ekorana gateway accepts this API key (it answered "Transaction not found" for a reference that cannot exist).',
      };
    }
    return { ok: false, step: 'status', status: err?.status ?? null, message: err.message };
  }
}
