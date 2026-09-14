/**
 * MTN Mobile Money, from the dashboard's side.
 *
 * The browser never talks to Ekorana and never sees an API key: it asks
 * broodiinnox-api to collect a payment and reads back what the gateway decided.
 * The credentials (`EKOPAY_*`) and the verification live on the server — this
 * module only carries the request and the answer.
 *
 * Nothing here can confirm a payment. `providerFieldsFromRow()` copies what the
 * API reports, and the store activates a subscription only when that report says
 * `status: successful` AND `provider_confirmed: true` — which the API sets from
 * the gateway's own answer and from nothing else.
 *
 * Configuration: the same API as the devices (`VITE_IOT_API_URL`). When it is
 * not set the app runs its built-in simulation, and none of this is used.
 */
import { IotApiError, resolveIotConfig } from './iot.js';

/** Resolved once per build, like liveConfig — import.meta.env is not testable at runtime. */
export const paymentsConfig = resolvePaymentConfig(import.meta.env);

export function resolvePaymentConfig(env) {
  const iot = resolveIotConfig(env);
  return { enabled: iot.enabled, baseUrl: iot.baseUrl, apiKey: iot.apiKey, timeoutMs: iot.timeoutMs };
}

/** What a farmer is told when the number they typed cannot be one. */
export const MOMO_PHONE_ERROR = 'Enter a valid MTN MoMo number, e.g. 0788123456 or 250788123456.';

/**
 * Normalize a phone number to the MSISDN form MoMo expects: digits only,
 * country code first, no "+" (0788123456 -> 250788123456). Returns null when
 * the number cannot be one. Mirrors `normalizeMsisdn` in broodiinnox-api:
 * the browser refuses a typo before it becomes a charge, and the server
 * refuses it again because a browser is never trusted with money.
 */
export function normalizeMomoPhone(phone, countryCode = '250') {
  if (typeof phone !== 'string' && typeof phone !== 'number') return null;
  let s = String(phone).replace(/[\s()\-.]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  else if (s.startsWith('00')) s = s.slice(2);
  if (!/^\d+$/.test(s)) return null;

  const cc = String(countryCode || '250').replace(/\D/g, '') || '250';
  if (s.startsWith('0')) s = cc + s.replace(/^0+/, '');
  else if (!s.startsWith(cc) && s.length <= 9) s = cc + s;

  if (!s.startsWith(cc)) return null;
  if (s.length < cc.length + 8 || s.length > 15) return null;
  return s;
}

/** null when the number is usable, otherwise the reason to show the farmer. */
export function momoPhoneError(phone) {
  return normalizeMomoPhone(phone) ? null : MOMO_PHONE_ERROR;
}

export class PaymentApiError extends Error {
  constructor(message, { status = null, code = null, payment = null } = {}) {
    super(message);
    this.name = 'PaymentApiError';
    this.status = status;
    this.code = code;
    /** The payment record the API sent alongside a refusal (502/409 carry one). */
    this.payment = payment || null;
  }
}

/**
 * Create the payments client. `fetchImpl` is injectable for tests.
 */
export function createPaymentsApi({ baseUrl, apiKey = '', timeoutMs = 8000, fetchImpl } = {}) {
  if (!/^https?:\/\/[^/]+/.test(baseUrl || '')) {
    throw new PaymentApiError('payments API is not configured (set VITE_IOT_API_URL)', { code: 'not-configured' });
  }
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') throw new PaymentApiError('no fetch implementation available', { code: 'network' });

  async function request(path, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let data = null;
      if (text) {
        try { data = JSON.parse(text); } catch { data = text; }
      }
      if (!res.ok) {
        const message = data && typeof data === 'object' && data.error
          ? data.error
          : `Payment request failed (HTTP ${res.status})`;
        throw new PaymentApiError(message, {
          status: res.status,
          payment: (data && typeof data === 'object' && data.payment) || null,
        });
      }
      return data;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new PaymentApiError(`The payment server did not answer in ${timeoutMs}ms`, { code: 'timeout' });
      }
      if (err instanceof PaymentApiError) throw err;
      if (err instanceof IotApiError) throw new PaymentApiError(err.message, { status: err.status, code: err.code });
      throw new PaymentApiError(`Could not reach the payment server: ${err.message}`, { code: 'network' });
    } finally {
      clearTimeout(timer);
    }
  }

  const enc = (id) => encodeURIComponent(id);
  return {
    baseUrl,
    request,
    /**
     * Ask for a payment. The amount travels as the price the app published for
     * that farm size and plan; the server asks MTN to collect exactly it.
     * Returns { payment, reused } — reused means a prompt is already live for
     * this system and the farmer has not been prompted twice.
     */
    requestPayment: (body) => request('/api/payments', { method: 'POST', body }),
    listPayments: ({ farmerId, deviceId, limit = 100 } = {}) => {
      const q = new URLSearchParams();
      if (farmerId) q.set('farmerId', farmerId);
      if (deviceId) q.set('deviceId', deviceId);
      q.set('limit', String(limit));
      return request(`/api/payments?${q.toString()}`);
    },
    getPayment: (id) => request(`/api/payments/${enc(id)}`),
    /** Force a status check with MTN (the farmer pressing "check status"). */
    refreshPayment: (id) => request(`/api/payments/${enc(id)}/refresh`, { method: 'POST' }),
    /**
     * Whether the server can take payments at all, and what is still to be set.
     * Read from the API's own health report (`ekopay`), which carries the names
     * of the variables and never a value.
     */
    providerStatus: async () => {
      const health = await request('/api/health');
      return health && typeof health === 'object' && health.ekopay ? health.ekopay : null;
    },
  };
}

/**
 * The provider-derived fields of a payment row, as the store keeps them.
 * Deliberately a whitelist: nothing here can turn a payment successful — that
 * is `providerConfirmed`, which only the API sets from MTN's own answer.
 */
export function providerFieldsFromRow(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    apiId: row.id ?? null,
    providerRef: row.provider_ref ?? null,
    financialTxId: row.financial_transaction_id ?? null,
    providerConfirmed: row.provider_confirmed === true,
    providerStatus: typeof row.status === 'string' ? row.status : 'pending',
    failureReason: row.reason ?? null,
    phone: row.phone ?? null,
    currency: row.currency ?? null,
    amount: typeof row.amount === 'number' ? row.amount : null,
    statusCheckedAt: row.status_checked_at ?? null,
    confirmedAt: row.confirmed_at ?? null,
  };
}

/** Is this row a payment the provider itself confirmed? */
export function isProviderConfirmed(row) {
  return !!row && row.status === 'successful' && row.provider_confirmed === true;
}

/**
 * Plain words for the reasons the Ekorana gateway gives. `AMOUNT_MISMATCH` is
 * ours: it is what the API records when the gateway collected a different
 * amount than the one asked for.
 */
const FAILURE_NOTES = {
  AMOUNT_MISMATCH: 'The payment gateway collected a different amount than the one requested, so the payment was not accepted and nothing was unlocked. If money left your wallet, contact Afriinnox with the gateway reference.',
  REQUEST_FAILED: 'The payment gateway refused the request — try again, or contact Afriinnox.',
  TIMEOUT: 'The payment gateway did not answer in time — try again.',
  NETWORK: 'The server could not reach the payment gateway — try again in a moment.',
  NOT_CONFIGURED: 'Payments are not configured on the server yet — contact Afriinnox.',
  REFERENCE_EXISTS: 'This payment was already requested — check its status before trying again.',
  AMOUNT_TOO_SMALL: 'The amount is below the payment gateway’s minimum of 50 RWF — contact Afriinnox.',
  INVALID_PHONE: 'That number is not an MTN MoMo number — check it and try again.',
  INVALID_API_KEY: 'The payment gateway rejected the server’s API key — contact Afriinnox.',
  API_KEY_INACTIVE: 'The payment gateway says the server’s API key is not active — contact Afriinnox.',
  TRANSACTION_NOT_FOUND: 'The payment gateway does not know this transaction — request the payment again.',
};

/**
 * The sentence to show for a payment that did not go through. Handles both a
 * reason code (AMOUNT_MISMATCH) and a message the API already wrote in plain
 * words (an unconfigured server, a refused request).
 */
export function paymentFailureNote(payment) {
  const reason = typeof payment?.failureReason === 'string' ? payment.failureReason.trim() : '';
  if (!reason) return 'The MTN MoMo payment did not go through. You can request it again.';
  if (!/^[A-Z0-9_]+$/.test(reason)) return reason;
  return FAILURE_NOTES[reason] || 'The payment did not go through. Try again, or contact Afriinnox for help.';
}

/**
 * What a farmer is told about a payment that is still open.
 *
 * A pending payment carrying a reason is one the server asked the gateway for
 * and never got an answer about: there may be no prompt on the phone at all, so
 * the farmer is told to look rather than told to approve something that is not
 * there. The reason is a code (TIMEOUT, NETWORK) and is not shown as words.
 */
export function paymentPendingNote(payment) {
  const phone = payment?.phone ? ` on ${payment.phone}` : '';
  if (payment?.failureReason) {
    return `We asked MTN MoMo for a prompt${phone} and the gateway has not confirmed it yet. `
      + 'If no prompt appeared, request the payment again in two minutes; if it did, approve it with your '
      + 'MoMo PIN — the system unlocks by itself once the gateway confirms.';
  }
  return `Waiting for MTN MoMo — approve the prompt${phone} with your MoMo PIN. The system unlocks by itself once the payment is confirmed.`;
}

/**
 * What the app shows when the server cannot take payments at all. The names of
 * the variables still to be set are shown because the reader is Afriinnox staff
 * looking at the deployment, not a farmer.
 */
export function providerDisabledNote(provider = {}) {
  const parts = [];
  const missing = (provider?.missing || []).filter(Boolean);
  const invalid = (provider?.invalid || []).filter(Boolean);
  if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
  if (invalid.length) parts.push(`unusable: ${invalid.join(', ')}`);
  const why = parts.length ? ` (${parts.join('; ')})` : '';
  return `Payments are not configured on the server yet${why}, so no payment can be collected. Afriinnox has to set the Ekorana gateway up before farmers can pay.`;
}
