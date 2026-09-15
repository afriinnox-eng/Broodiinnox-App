/**
 * The payment flow, end to end, with no HTTP of its own — the route handlers
 * are thin wrappers around these three functions, so the money rules can be
 * tested (and reasoned about) without a server or a network.
 *
 *   createPaymentRequest   a farmer asks to pay   -> MoMo prompt on their phone
 *   refreshPayment         what did Ekorana decide? -> pending | successful | failed
 *   handleEkopayCallback   Ekorana told us something -> re-verify, then apply
 *
 * The provider is the Ekorana Payment Gateway ("Ekopay"), which collects on MTN
 * Mobile Money — see lib/ekopay.js for the API itself.
 *
 * Confirmation is always the gateway's own answer: the dashboard cannot confirm
 * a payment, and neither can a callback body (it is re-checked against the
 * gateway before it changes anything). Only a confirmed payment unlocks a unit.
 *
 * And only the gateway may FAIL one. A request this server could not get an
 * answer for — a timeout, a network error, a 5xx — leaves the payment PENDING
 * rather than failed, because the collection may exist and the farmer may
 * already have paid it. That distinction is the whole difference between a
 * farmer being unlocked and a farmer being charged for a locked unit.
 *
 * The `referenceId` the gateway is given is this payment's own id (`pay_…`) —
 * the gateway calls it "your unique transaction ID" and returns it on every
 * status read and every callback, which is what makes a callback resolvable
 * without trusting a single field of its body.
 */
import { DEFAULT_TOPIC_PREFIX } from './constants.js';
import {
  createEkopayClient, describeEkopayConfig, ekopayErrorMessage, ekopayFailureReason,
  ekopayNotConfiguredMessage, isDefiniteEkopayRejection, resolveEkopayConfig,
} from './ekopay.js';
import {
  applyProviderStatus, awaitsProvider, buildPayment, failPayment, findReusablePending,
  isConfirmed, newPaymentId, paymentPatch, paymentTouched, publicPayment, shouldPollStatus,
  unlockDeviceAfterPayment, validatePaymentInput, STATUS_POLL_AFTER_MS,
} from './payments.js';
import { notifyPaymentResult } from './notify.js';

const nowIso = () => new Date().toISOString();

/**
 * The one token to grep the production log for.
 *
 * Render's access log carries no request path — only a client IP, a status and
 * a byte count — so without a line of our own a callback is invisible, and an
 * investigation has to guess at one from a client IP and a response size. That
 * is exactly what happened while chasing the RWF 25,000 payment, and it very
 * nearly produced the wrong answer.
 */
export const EKOPAY_CALLBACK_LOG_PREFIX = '[ekopay] callback';

/**
 * Log one callback, then hand its reply back unchanged.
 *
 * EVERY callback this handler answers goes through here, refusals included, so
 * the line is a true record of arrivals: no line means Ekorana did not call.
 * A log that records only the interesting outcomes cannot answer the only
 * question asked of it — did the webhook arrive?
 *
 * It prints fixed primitives and nothing else. No request body, no gateway
 * message, no URL: none of it, so no credential can reach the log whatever the
 * gateway sends back (the API key travels as a query parameter, which makes
 * echoing a URL a live risk). The reason is a code from our own vocabulary,
 * never free text.
 *
 * And it cannot fail the callback it describes — a lost log line is worth far
 * less than the money the callback is carrying.
 */
function callbackReply({ status, body, ref, event, payment = null, reason = null, confirmed = null }) {
  try {
    const parts = [
      `event=${event}`,
      `http=${status}`,
      `ref=${ref || '-'}`,
      `payment=${payment?.id || '-'}`,
      `payment_status=${payment?.status || '-'}`,
    ];
    if (reason) parts.push(`reason=${reason}`);
    if (confirmed !== null) parts.push(`confirmed=${confirmed}`);
    console.log(`${EKOPAY_CALLBACK_LOG_PREFIX} ${parts.join(' ')}`);
  } catch {
    // never let the record of a callback break the callback
  }
  return { status, body };
}

/** Resolve the gateway configuration and build the client (null when unconfigured). */
export function ekopayFromEnv(env, fetchImpl) {
  const config = resolveEkopayConfig(env);
  return {
    config,
    client: config.enabled ? createEkopayClient(config, { fetchImpl }) : null,
  };
}

function notConfigured(config) {
  return {
    status: 503,
    body: { error: ekopayNotConfiguredMessage(config), ekopay: describeEkopayConfig(config) },
  };
}

/**
 * Request a payment: validate, refuse what cannot be paid, reuse a prompt that
 * is already on the farmer's phone, otherwise ask Ekorana for a new one.
 *
 * Returns { status, body }; the body always carries the payment record when
 * one exists, so a refused or failed attempt is visible in the app and to
 * Afriinnox rather than vanishing.
 */
export async function createPaymentRequest({ store, body, env = process.env, fetchImpl, now = nowIso(), mailer = null } = {}) {
  const { config, client } = ekopayFromEnv(env, fetchImpl);

  const input = validatePaymentInput(body, { currency: config.currency, countryCode: config.countryCode });
  if (!input.ok) return { status: 400, body: { error: input.error } };

  // A payment can only be requested for a unit this server knows about.
  const device = await store.getDevice(input.value.device_id);
  if (!device) {
    return {
      status: 404,
      body: { error: `No device "${input.value.device_id}" — register it first (POST /api/devices).` },
    };
  }

  if (!config.enabled || !client) return notConfigured(config);

  // The same device asked twice while a prompt is live is the same intent:
  // hand back the payment that exists instead of prompting the farmer again.
  const existing = findReusablePending(
    await store.listPayments({ deviceId: input.value.device_id, limit: 50 }),
    { device_id: input.value.device_id, farmer_id: input.value.farmer_id },
    now
  );
  if (existing) return { status: 200, body: { payment: publicPayment(existing), reused: true } };

  const id = newPaymentId();
  // The gateway's referenceId IS our payment id: it is what every status read
  // and every callback carries, so a callback can be resolved by looking the
  // payment up, and a reference can never belong to two payments.
  const row = buildPayment(input.value, { id, referenceId: id, now });
  await store.createPayment(row);

  try {
    const sent = await client.initiatePayment({
      amount: row.amount,
      referenceId: row.id,
      phone: row.phone,
      senderMessage: row.payer_message,
    });
    const stored = await store.updatePayment(id, {
      provider_ref: sent.referenceId,
      // Ekorana's own transaction id, kept as the evidence on the record.
      financial_tx_id: sent.transactionId,
      status_checked_at: now,
      updated_at: now,
    });
    return { status: 201, body: { payment: publicPayment(stored || row) } };
  } catch (err) {
    const reason = ekopayFailureReason(err);

    // A REFUSAL — a 4xx from the gateway, or our own validation stopping the
    // request before it left the server — is definite: no collection can exist,
    // so the attempt is recorded FAILED and nothing was charged.
    //
    // Anything else (a timeout, a network error, a 5xx) is NOT a refusal. The
    // gateway may have created the collection and sent the prompt, and the
    // farmer may already have approved it. Recording that as FAILED hides money
    // that was collected, because a settled payment is never re-examined later.
    // So the payment stays PENDING, holding the reference it was created with,
    // and the poll keeps asking the gateway until it answers: the status is
    // decided by the gateway and by nothing else.
    if (isDefiniteEkopayRejection(err)) {
      const failed = await store.updatePayment(id, paymentPatch(failPayment(row, reason, now)));
      const settled = failed || failPayment(row, reason, now);
      // The gateway refused it outright, so there is a decision worth telling
      // the farmer about: no collection exists and nothing was charged.
      const notification = await notifyPaymentSafely({
        store, mailer, payment: settled, device, confirmed: false,
      });
      return {
        status: 502,
        body: {
          error: ekopayErrorMessage(err),
          payment: publicPayment(settled),
          notification: summarizeNotification(notification),
        },
      };
    }

    const open = await store.updatePayment(id, paymentPatch(paymentTouched({ ...row, reason }, now)));
    return {
      status: 202,
      body: {
        payment: publicPayment(open || { ...row, reason }),
        unconfirmed: true,
        notice: `The payment gateway has not confirmed this request yet (${ekopayErrorMessage(err)}). `
          + 'If no prompt arrived on the phone, the payment can be requested again in two minutes.',
      },
    };
  }
}

/**
 * Ask the provider what it decided about a payment.
 *
 * `force` skips the poll throttle (the farmer pressing "check status"). A
 * provider error leaves the payment PENDING — a network hiccup is not a failed
 * payment, and only the provider may fail one.
 */
export async function refreshPayment({ store, bridge, paymentId, env = process.env, fetchImpl, now = nowIso(), force = false, prefix, mailer = null } = {}) {
  const payment = await store.getPayment(paymentId);
  if (!payment) return { status: 404, body: { error: `No payment "${paymentId}"` } };
  // A payment the PROVIDER settled is history and is not asked about again. One
  // that is pending, or that this server failed for want of an answer, is still
  // open to the gateway's verdict.
  if (!awaitsProvider(payment)) {
    return { status: 200, body: { payment: publicPayment(payment), refreshed: false } };
  }
  if (!force && !shouldPollStatus(payment, now, STATUS_POLL_AFTER_MS)) {
    return { status: 200, body: { payment: publicPayment(payment), refreshed: false } };
  }
  if (!payment.provider_ref) {
    return { status: 409, body: { error: 'This payment has no Ekorana reference yet.', payment: publicPayment(payment) } };
  }

  const { config, client } = ekopayFromEnv(env, fetchImpl);
  if (!config.enabled || !client) return notConfigured(config);

  let provider;
  try {
    provider = await client.getStatus(payment.provider_ref);
  } catch (err) {
    const touched = await store.updatePayment(payment.id, paymentPatch(paymentTouched(payment, now)));
    return {
      status: 502,
      body: { error: ekopayErrorMessage(err), payment: publicPayment(touched || payment), refreshed: false },
    };
  }

  const applied = applyProviderStatus(payment, provider, now);
  const stored = await store.updatePayment(payment.id, paymentPatch(applied.payment));

  let unlock = null;
  let device = null;
  if (applied.confirmed) {
    device = await store.getDevice(payment.device_id);
    unlock = await unlockDeviceAfterPayment({
      store, bridge, prefix: prefix || process.env.MQTT_TOPIC_PREFIX || DEFAULT_TOPIC_PREFIX,
      payment: stored || payment, device,
    });
  }

  const notification = await notifyIfSettled({
    store, mailer, applied, payment: stored || applied.payment, deviceId: payment.device_id, device, unlock,
  });

  return {
    status: 200,
    body: {
      payment: publicPayment(stored || applied.payment),
      refreshed: true,
      confirmed: applied.confirmed,
      device_unlock: unlock,
      notification: summarizeNotification(notification),
    },
  };
}

/**
 * An Ekorana payment notification (the `callbackUrl` sent to the gateway).
 *
 * The endpoint cannot authenticate Ekorana, so it trusts the body for NOTHING:
 * it finds the payment by the referenceId the gateway echoes back, asks Ekorana
 * itself, and applies that answer. A callback can therefore never confirm a
 * payment on its own, and never unlock a device.
 *
 * The gateway retries three times (30 s, 60 s, 120 s) when no 200 arrives
 * within ten seconds, and asks duplicates be handled by referenceId. Both are
 * harmless here: a settled payment is history (`applyProviderStatus` returns it
 * unchanged), so a retry re-applies nothing — and the unlock it re-offers is a
 * no-op for a unit that already reports itself unlocked, which is also what
 * makes it a second chance for one whose bridge was down when the first
 * callback landed.
 *
 * Every answer it gives is logged once, whatever the outcome — see
 * `callbackReply` — so the production log, not an inference, says whether
 * Ekorana called and what it was told to do.
 */
export async function handleEkopayCallback({ store, bridge, body, reference, env = process.env, fetchImpl, now = nowIso(), prefix, mailer = null } = {}) {
  const ref = firstString(body?.referenceId, body?.reference_id, reference, body?.externalId, body?.external_id, body?.id);

  let payment = null;
  if (ref && /^pay_/.test(ref)) payment = await store.getPayment(ref);
  if (!payment && ref) {
    payment = (await store.listPayments({ limit: 200 })).find((p) => p.provider_ref === ref) || null;
  }
  if (!payment) {
    return callbackReply({
      status: 404,
      event: 'unknown-reference',
      ref,
      body: { error: 'Unknown Ekorana reference', reference: ref || null },
    });
  }

  const { config, client } = ekopayFromEnv(env, fetchImpl);
  if (!config.enabled || !client) {
    return callbackReply({
      status: 202,
      event: 'unconfigured',
      ref,
      payment,
      body: { received: true, verified: false, payment: publicPayment(payment) },
    });
  }

  let provider;
  try {
    provider = await client.getStatus(payment.provider_ref);
  } catch (err) {
    // Keep it pending: the poll (or the next callback) decides.
    const touched = await store.updatePayment(payment.id, paymentPatch(paymentTouched(payment, now)));
    return callbackReply({
      status: 202,
      event: 'verify-failed',
      ref,
      payment: touched || payment,
      reason: ekopayFailureReason(err),
      body: { received: true, verified: false, error: ekopayErrorMessage(err), payment: publicPayment(touched || payment) },
    });
  }

  const applied = applyProviderStatus(payment, provider, now);
  const stored = await store.updatePayment(payment.id, paymentPatch(applied.payment));

  let unlock = null;
  let device = null;
  if (applied.confirmed) {
    device = await store.getDevice(payment.device_id);
    unlock = await unlockDeviceAfterPayment({
      store, bridge, prefix: prefix || process.env.MQTT_TOPIC_PREFIX || DEFAULT_TOPIC_PREFIX,
      payment: stored || payment, device,
    });
  }

  const notification = await notifyIfSettled({
    store, mailer, applied, payment: stored || applied.payment, deviceId: payment.device_id, device, unlock,
  });

  return callbackReply({
    status: 200,
    event: 'verified',
    ref,
    payment: stored || applied.payment,
    confirmed: Boolean(applied.confirmed),
    body: {
      received: true, verified: true, confirmed: applied.confirmed,
      payment: publicPayment(stored || applied.payment),
      device_unlock: unlock,
      notification: summarizeNotification(notification),
    },
  });
}

/**
 * Email the farmer only when the gateway has actually SETTLED this payment, and
 * only on the transition that settled it.
 *
 * Two gates, and both matter:
 *
 *   applied.changed — a poll or a callback that changed nothing (the gateway
 *                     still says pending) must not send a second receipt.
 *   !awaitsProvider — the payment must no longer be waiting on an answer. A
 *                     payment WE failed for want of a reply is still owed one,
 *                     so it is not a decision and there is nothing to report;
 *                     reporting it would be exactly the "your payment failed"
 *                     email that the RWF 25,000 incident would have sent to a
 *                     farmer who had already paid.
 */
async function notifyIfSettled({ store, mailer, applied, payment, deviceId, device = null, unlock = null }) {
  if (!applied?.changed || !payment) return null;
  if (awaitsProvider(payment)) return null;
  const confirmed = isConfirmed(payment);
  const under = device || (deviceId && store.getDevice ? await store.getDevice(deviceId) : null);
  return notifyPaymentSafely({ store, mailer, payment, device: under, confirmed, unlock });
}

/**
 * Tell the farmer what the gateway decided. Never fatal: an undeliverable
 * notification must not fail a payment that was just confirmed and a device
 * that was just unlocked.
 */
async function notifyPaymentSafely({ store, mailer, payment, device = null, confirmed, unlock = null }) {
  try {
    return await notifyPaymentResult({ store, mailer, payment, device, confirmed, unlock });
  } catch (err) {
    console.error(`[payments] notification failed for ${payment?.id}: ${err?.message || err}`);
    return { ok: false, error: err?.message || String(err) };
  }
}

/** The delivery outcome, small enough to sit in an API response. */
function summarizeNotification(out) {
  if (!out) return null;
  return {
    sent: out.sent || 0,
    skipped: out.skipped || 0,
    failed: out.failed || 0,
    error: out.error || null,
  };
}

function firstString(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}
