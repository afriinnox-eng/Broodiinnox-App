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
 * The `referenceId` the gateway is given is this payment's own id (`pay_…`) —
 * the gateway calls it "your unique transaction ID" and returns it on every
 * status read and every callback, which is what makes a callback resolvable
 * without trusting a single field of its body.
 */
import { DEFAULT_TOPIC_PREFIX } from './constants.js';
import {
  createEkopayClient, describeEkopayConfig, ekopayErrorMessage, ekopayFailureReason,
  ekopayNotConfiguredMessage, resolveEkopayConfig,
} from './ekopay.js';
import {
  applyProviderStatus, buildPayment, failPayment, findReusablePending, isPending,
  newPaymentId, paymentPatch, paymentTouched, publicPayment, shouldPollStatus,
  unlockDeviceAfterPayment, validatePaymentInput, STATUS_POLL_AFTER_MS,
} from './payments.js';

const nowIso = () => new Date().toISOString();

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
export async function createPaymentRequest({ store, body, env = process.env, fetchImpl, now = nowIso() } = {}) {
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
    // The gateway never accepted the request: the record stays as a FAILED
    // attempt with the reason, and nothing was charged.
    const reason = ekopayFailureReason(err);
    const failed = await store.updatePayment(id, paymentPatch(failPayment(row, reason, now)));
    return {
      status: 502,
      body: {
        error: ekopayErrorMessage(err),
        payment: publicPayment(failed || failPayment(row, reason, now)),
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
export async function refreshPayment({ store, bridge, paymentId, env = process.env, fetchImpl, now = nowIso(), force = false, prefix } = {}) {
  const payment = await store.getPayment(paymentId);
  if (!payment) return { status: 404, body: { error: `No payment "${paymentId}"` } };
  if (!isPending(payment)) {
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
  if (applied.confirmed) {
    const device = await store.getDevice(payment.device_id);
    unlock = await unlockDeviceAfterPayment({
      store, bridge, prefix: prefix || process.env.MQTT_TOPIC_PREFIX || DEFAULT_TOPIC_PREFIX,
      payment: stored || payment, device,
    });
  }

  return {
    status: 200,
    body: {
      payment: publicPayment(stored || applied.payment),
      refreshed: true,
      confirmed: applied.confirmed,
      device_unlock: unlock,
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
 */
export async function handleEkopayCallback({ store, bridge, body, reference, env = process.env, fetchImpl, now = nowIso(), prefix } = {}) {
  const ref = firstString(body?.referenceId, body?.reference_id, reference, body?.externalId, body?.external_id, body?.id);

  let payment = null;
  if (ref && /^pay_/.test(ref)) payment = await store.getPayment(ref);
  if (!payment && ref) {
    payment = (await store.listPayments({ limit: 200 })).find((p) => p.provider_ref === ref) || null;
  }
  if (!payment) {
    return { status: 404, body: { error: 'Unknown Ekorana reference', reference: ref || null } };
  }

  const { config, client } = ekopayFromEnv(env, fetchImpl);
  if (!config.enabled || !client) {
    return { status: 202, body: { received: true, verified: false, payment: publicPayment(payment) } };
  }

  let provider;
  try {
    provider = await client.getStatus(payment.provider_ref);
  } catch (err) {
    // Keep it pending: the poll (or the next callback) decides.
    const touched = await store.updatePayment(payment.id, paymentPatch(paymentTouched(payment, now)));
    return {
      status: 202,
      body: { received: true, verified: false, error: ekopayErrorMessage(err), payment: publicPayment(touched || payment) },
    };
  }

  const applied = applyProviderStatus(payment, provider, now);
  const stored = await store.updatePayment(payment.id, paymentPatch(applied.payment));

  let unlock = null;
  if (applied.confirmed) {
    const device = await store.getDevice(payment.device_id);
    unlock = await unlockDeviceAfterPayment({
      store, bridge, prefix: prefix || process.env.MQTT_TOPIC_PREFIX || DEFAULT_TOPIC_PREFIX,
      payment: stored || payment, device,
    });
  }
  return {
    status: 200,
    body: { received: true, verified: true, confirmed: applied.confirmed, payment: publicPayment(stored || applied.payment), device_unlock: unlock },
  };
}

function firstString(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}
