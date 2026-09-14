/**
 * MTN Mobile Money, from the dashboard's side.
 *
 * The browser never talks to MTN and never sees a MoMo credential: it asks
 * broodiinnox-api to collect a payment and reads back what the provider
 * decided. The credentials (`MOMO_*`) and the verification live on the server —
 * this module only carries the request and the answer.
 *
 * Nothing here can confirm a payment. `providerFieldsFromRow()` copies what the
 * API reports, and the store activates a subscription only when that report says
 * `status: successful` AND `provider_confirmed: true` — which the API sets from
 * MTN's own answer and from nothing else.
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
    /** Whether the server can take payments at all, and what is missing. */
    momoStatus: async () => {
      const health = await request('/api/health');
      return health && typeof health === 'object' && health.momo ? health.momo : null;
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

/** Plain words for the failure reasons MTN MoMo returns. */
const FAILURE_NOTES = {
  AMOUNT_MISMATCH: 'MTN MoMo collected a different amount than the one requested, so the payment was not accepted and nothing was unlocked. If money left your wallet, contact Afriinnox with the MTN transaction reference.',
  PAYER_NOT_FOUND: 'That number is not an MTN MoMo account. Check the number and request the payment again.',
  PAYEE_NOT_FOUND: 'The receiving MTN MoMo account was not found — contact Afriinnox.',
  NOT_ALLOWED: 'This MTN MoMo account is not allowed to make this payment.',
  NOT_ALLOWED_TARGET_ENVIRONMENT: 'This MTN MoMo account cannot pay right now — contact Afriinnox.',
  AMOUNT_NOT_ALLOWED: 'MTN MoMo does not allow this amount on that account.',
  INVALID_CURRENCY: 'MTN MoMo does not accept the currency this server is configured for — contact Afriinnox.',
  INVALID_CALLBACK_URL_HOST: 'MTN MoMo rejected the configured callback URL — contact Afriinnox.',
  APPROVAL_REJECTED: 'The payment was rejected on the phone.',
  EXPIRED: 'The MTN MoMo prompt expired before it was approved — request the payment again.',
  SERVICE_UNAVAILABLE: 'MTN MoMo is temporarily unavailable — try again in a moment.',
  INTERNAL_PROCESSING_ERROR: 'MTN MoMo could not process the request — try again in a moment.',
  COULD_NOT_PERFORM_TRANSACTION: 'The transaction could not be performed — try again.',
  RESOURCE_ALREADY_EXIST: 'This payment was already requested — check its status before trying again.',
  RESOURCE_NOT_FOUND: 'MTN MoMo does not know this payment reference — request the payment again.',
  REQUEST_FAILED: 'MTN MoMo refused the payment request — try again, or contact Afriinnox.',
  INVALID_PHONE: 'That number is not an MTN MoMo number — check it and try again.',
};

/**
 * The sentence to show for a payment that did not go through. Handles both a
 * MoMo reason code (PAYER_NOT_FOUND) and a message the API already wrote in
 * plain words (an unconfigured server, a refused request).
 */
export function momoFailureNote(payment) {
  const reason = typeof payment?.failureReason === 'string' ? payment.failureReason.trim() : '';
  if (!reason) return 'The MTN MoMo payment did not go through. You can request it again.';
  if (!/^[A-Z0-9_]+$/.test(reason)) return reason;
  return FAILURE_NOTES[reason] || 'MTN MoMo refused the payment. Try again, or contact Afriinnox for help.';
}

/** What a farmer is told while the prompt is on their phone. */
export function momoPendingNote(payment) {
  const phone = payment?.phone ? ` on ${payment.phone}` : '';
  return `Waiting for MTN MoMo — approve the prompt${phone} with your MoMo PIN. The system unlocks by itself once the payment is confirmed.`;
}

/** What the app shows when the server cannot take payments at all. */
export function momoDisabledNote(momo = {}) {
  const missing = Array.isArray(momo?.missing) && momo.missing.length ? momo.missing.join(', ') : null;
  return missing
    ? `MTN MoMo is not configured on the server yet (missing: ${missing}), so no payment can be collected. Afriinnox has to set it before farmers can pay.`
    : 'MTN MoMo is not configured on the server yet, so no payment can be collected. Afriinnox has to set it before farmers can pay.';
}
