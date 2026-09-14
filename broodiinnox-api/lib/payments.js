/**
 * Payment records and the rules that decide whether money has actually arrived.
 *
 * One invariant runs through this file:
 *
 *   A payment is confirmed ONLY by the provider's own answer. The amount the
 *   provider collected must match the amount requested, in the same currency,
 *   or the payment is recorded as FAILED — a mismatch is never rounded up into
 *   a success, and a device is never unlocked on anything but a confirmed
 *   payment.
 *
 * Records live in the store (CockroachDB, or memory in dev); the routes and
 * the MoMo callback go through these functions, so the rule is in one place.
 */
import { buildControlMessage } from './commands.js';
import { DEVICE_ID_RE } from './constants.js';
import { normalizeMsisdn } from './momo.js';

export const PAYMENT_STATUS = { PENDING: 'pending', SUCCESSFUL: 'successful', FAILED: 'failed' };
export const PAYMENT_METHOD = 'MTN MoMo';

/** A single MoMo payment is a subscription term — no sensible amount is larger. */
export const MAX_AMOUNT = 100_000_000;

/**
 * A second request for the same device while one is still pending is the same
 * intent, not a second charge: double-taps and retries within this window get
 * the existing payment back instead of a new prompt on the farmer's phone.
 */
export const PENDING_REUSE_MS = 120_000;

/** How long a pending payment waits before its status is asked of MoMo again. */
export const STATUS_POLL_AFTER_MS = 5_000;

export const PHONE_ERROR = 'Enter a valid MTN MoMo number, e.g. 0788123456 or 250788123456.';
export const AMOUNT_ERROR = `The amount must be a whole number of RWF between 1 and ${MAX_AMOUNT.toLocaleString('en-US')}.`;

/**
 * Validate a payment request from the dashboard.
 * Returns { ok, error, value } — `value` is normalized and safe to persist.
 */
export function validatePaymentInput(body, { currency = 'RWF', countryCode = '250' } = {}) {
  const fail = (error) => ({ ok: false, error, value: null });

  const deviceId = typeof body?.device_id === 'string' ? body.device_id.trim() : '';
  if (!DEVICE_ID_RE.test(deviceId)) return fail(`Invalid device_id "${deviceId}" — must match /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/`);

  const amount = Number(body?.amount);
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) return fail(AMOUNT_ERROR);

  const cur = (typeof body?.currency === 'string' && body.currency.trim() ? body.currency.trim() : currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) return fail(`Invalid currency "${body?.currency}" — use the ISO code, e.g. RWF`);

  const phone = normalizeMsisdn(body?.phone, countryCode);
  if (!phone) return fail(PHONE_ERROR);

  const text = (v, max = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

  return {
    ok: true,
    error: null,
    value: {
      device_id: deviceId,
      farmer_id: text(body?.farmer_id),
      plan_id: text(body?.plan_id),
      band_id: text(body?.band_id, 60),
      amount,
      currency: cur,
      phone,
      method: PAYMENT_METHOD,
      payer_message: text(body?.payer_message, 100) || 'Broodiinnox subscription',
      payee_note: text(body?.payee_note, 100) || 'Broodiinnox subscription payment',
    },
  };
}

/** The row we insert before the prompt is sent (status: pending). */
export function buildPayment(value, { id, referenceId = null, now = new Date().toISOString() } = {}) {
  return {
    id,
    device_id: value.device_id,
    farmer_id: value.farmer_id,
    plan_id: value.plan_id,
    band_id: value.band_id,
    amount: value.amount,
    currency: value.currency,
    phone: value.phone,
    method: value.method || PAYMENT_METHOD,
    status: PAYMENT_STATUS.PENDING,
    provider_confirmed: false,
    provider_ref: referenceId,
    financial_tx_id: null,
    reason: null,
    payer_message: value.payer_message || null,
    created_at: now,
    updated_at: now,
    confirmed_at: null,
    status_checked_at: null,
  };
}

export function isPending(payment) {
  return !!payment && payment.status === PAYMENT_STATUS.PENDING;
}

export function isConfirmed(payment) {
  return !!payment
    && payment.status === PAYMENT_STATUS.SUCCESSFUL
    && payment.provider_confirmed === true;
}

/**
 * The pending payment a fresh request is allowed to reuse, if any: same
 * device, still pending, with a provider reference, created inside the window.
 * Oldest first, so the reference the farmer already has a prompt for wins.
 */
export function findReusablePending(payments, { device_id, farmer_id } = {}, nowIso, withinMs = PENDING_REUSE_MS) {
  const now = Date.parse(nowIso || '') || Date.now();
  return (payments || [])
    .filter((p) => p
      && p.device_id === device_id
      && (!farmer_id || !p.farmer_id || p.farmer_id === farmer_id)
      && isPending(p)
      && !!p.provider_ref
      && now - (Date.parse(p.created_at || '') || 0) < withinMs)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0] || null;
}

/** Has a pending payment waited long enough for its status to be asked again? */
export function shouldPollStatus(payment, nowIso, afterMs = STATUS_POLL_AFTER_MS) {
  if (!isPending(payment) || !payment.provider_ref) return false;
  const now = Date.parse(nowIso || '') || Date.now();
  const last = Date.parse(payment.status_checked_at || payment.updated_at || payment.created_at || '') || 0;
  return now - last >= afterMs;
}

/**
 * What the provider actually collected, for the amount check.
 *
 * A provider answer that does not mention an amount at all is accepted (the
 * SUCCESSFUL verdict is the confirmation); an amount it does give must be the
 * amount asked for — including when it arrives as unreadable junk, which is a
 * mismatch and not a pass.
 */
export function providerAmountMatches(payment, provider) {
  const raw = provider?.amount;
  if (raw !== undefined && raw !== null && raw !== '') {
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount !== Number(payment.amount)) return false;
  }
  const currency = provider?.currency ? String(provider.currency).toUpperCase() : null;
  if (currency && currency !== String(payment.currency).toUpperCase()) return false;
  return true;
}

/**
 * Apply the provider's verdict to a payment.
 *
 * `provider` is what GET /collection/v1_0/requesttopay/<ref> (or a callback we
 * have re-verified with the provider) returned. Only `successful` confirms,
 * and only when the amount and currency collected are the ones requested.
 *
 * Returns { payment, confirmed, changed } and never throws.
 */
export function applyProviderStatus(payment, provider, now = new Date().toISOString()) {
  if (!payment) return { payment: null, confirmed: false, changed: false };
  // A settled payment is history: a late or repeated callback cannot rewrite it.
  if (payment.status !== PAYMENT_STATUS.PENDING) {
    return { payment, confirmed: isConfirmed(payment), changed: false };
  }
  const verdict = provider?.status || 'pending';
  const base = {
    ...payment,
    updated_at: now,
    status_checked_at: now,
    reason: provider?.reason || null,
    provider_ref: payment.provider_ref || provider?.referenceId || null,
  };

  if (verdict === 'successful') {
    if (!providerAmountMatches(payment, provider)) {
      return {
        changed: true,
        confirmed: false,
        payment: {
          ...base,
          status: PAYMENT_STATUS.FAILED,
          provider_confirmed: false,
          reason: 'AMOUNT_MISMATCH',
        },
      };
    }
    return {
      changed: true,
      confirmed: true,
      payment: {
        ...base,
        status: PAYMENT_STATUS.SUCCESSFUL,
        provider_confirmed: true,
        financial_tx_id: provider?.financialTransactionId || payment.financial_tx_id || null,
        confirmed_at: now,
        reason: null,
      },
    };
  }

  if (verdict === 'failed') {
    return {
      changed: true,
      confirmed: false,
      payment: {
        ...base,
        status: PAYMENT_STATUS.FAILED,
        provider_confirmed: false,
        financial_tx_id: provider?.financialTransactionId || payment.financial_tx_id || null,
      },
    };
  }

  // Still pending: only the last-checked stamp moves.
  return { payment: base, confirmed: false, changed: true };
}

/** Record a failure that happened before MoMo ever saw the request. */
export function failPayment(payment, reason, now = new Date().toISOString()) {
  return {
    ...payment,
    status: PAYMENT_STATUS.FAILED,
    provider_confirmed: false,
    reason: reason || 'REQUEST_FAILED',
    updated_at: now,
    status_checked_at: now,
  };
}

/** A payment id: sortable, obviously ours, and unique enough for a reference. */
export function newPaymentId() {
  const random = Math.random().toString(36).slice(2, 8);
  return `pay_${Date.now().toString(36)}${random}`;
}

/**
 * The mutable columns of a payment, as a patch for the store — the immutable
 * ones (id, device, amount, phone) are never rewritten by a status update.
 */
export function paymentPatch(next) {
  if (!next) return {};
  return {
    status: next.status,
    provider_confirmed: next.provider_confirmed === true,
    provider_ref: next.provider_ref ?? null,
    financial_tx_id: next.financial_tx_id ?? null,
    reason: next.reason ?? null,
    updated_at: next.updated_at,
    confirmed_at: next.confirmed_at ?? null,
    status_checked_at: next.status_checked_at ?? null,
  };
}

/**
 * Note that the provider was just asked and did not answer usably — without
 * changing the payment's status. A provider error must never fail a payment
 * that may well be about to succeed on the farmer's phone.
 */
export function paymentTouched(payment, now = new Date().toISOString()) {
  return { ...payment, updated_at: now, status_checked_at: now };
}

/** The JSON shape the dashboard receives (snake_case, no secrets). */
export function publicPayment(row) {
  if (!row) return null;
  return {
    id: row.id,
    device_id: row.device_id,
    farmer_id: row.farmer_id ?? null,
    plan_id: row.plan_id ?? null,
    band_id: row.band_id ?? null,
    amount: row.amount,
    currency: row.currency,
    phone: row.phone,
    method: row.method,
    status: row.status,
    provider_confirmed: row.provider_confirmed === true,
    provider_ref: row.provider_ref ?? null,
    financial_transaction_id: row.financial_tx_id ?? null,
    reason: row.reason ?? null,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    confirmed_at: iso(row.confirmed_at),
    status_checked_at: iso(row.status_checked_at),
  };
}

function iso(v) {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * A confirmed payment is what unlocks the hardware: send the firmware's
 * subscription kill-switch back to ACTIVE for that unit.
 *
 * Idempotent — a unit that is already unlocked gets nothing — and never fatal
 * to the payment: a bridge that is down is logged and reported, not thrown.
 */
export async function unlockDeviceAfterPayment({ store, bridge, prefix, payment, device, log = console } = {}) {
  if (!payment?.device_id) return { sent: false, reason: 'no device on the payment' };
  if (device && device.device_locked === false) return { sent: false, reason: 'device already unlocked' };

  const msg = buildControlMessage(payment.device_id, 'device_active', 'ACTIVE', {
    prefix,
    locked: !!device?.device_locked,
    minTemp: device?.min_temp,
    maxTemp: device?.max_temp,
  });
  if (!msg.ok) return { sent: false, reason: msg.error };

  let sent = false;
  let error = null;
  try {
    await bridge.publish(msg.topic, msg.payload);
    sent = true;
  } catch (err) {
    error = err?.message || String(err);
    if (log?.warn) log.warn(`[payments] could not unlock ${payment.device_id}: ${error}`);
  }
  try {
    await store?.logCommand({
      device_id: payment.device_id,
      command: 'device_active',
      value: 'ACTIVE',
      topic: msg.topic,
      payload: msg.payload,
      published: sent,
      error: sent ? null : error,
    });
  } catch (err) {
    if (log?.warn) log.warn(`[payments] could not audit the unlock of ${payment.device_id}: ${err.message}`);
  }
  return { sent, error, topic: msg.topic, payload: msg.payload };
}
