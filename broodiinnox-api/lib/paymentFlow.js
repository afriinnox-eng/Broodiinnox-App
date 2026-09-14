/**
 * The payment flow, end to end, with no HTTP of its own — the route handlers
 * are thin wrappers around these three functions, so the money rules can be
 * tested (and reasoned about) without a server or a network.
 *
 *   createPaymentRequest  a farmer asks to pay   -> MoMo prompt on their phone
 *   refreshPayment        what did MoMo decide?  -> pending | successful | failed
 *   handleMomoCallback    MoMo told us something -> re-verify, then apply
 *
 * Confirmation is always the provider's own answer: the dashboard cannot
 * confirm a payment, and neither can a callback body (it is re-checked against
 * MoMo before it changes anything). Only a confirmed payment unlocks a unit.
 */
import { DEFAULT_TOPIC_PREFIX } from './constants.js';
import {
  createMomoClient, describeMomoConfig, momoErrorMessage, momoNotConfiguredMessage,
  newMomoReference, resolveMomoConfig,
} from './momo.js';
import {
  applyProviderStatus, buildPayment, failPayment, findReusablePending, isPending,
  newPaymentId, paymentPatch, paymentTouched, publicPayment, shouldPollStatus,
  unlockDeviceAfterPayment, validatePaymentInput, STATUS_POLL_AFTER_MS,
} from './payments.js';

const nowIso = () => new Date().toISOString();

/** Resolve the MoMo configuration and build the client (null when unconfigured). */
export function momoFromEnv(env, fetchImpl) {
  const config = resolveMomoConfig(env);
  return {
    config,
    client: config.enabled ? createMomoClient(config, { fetchImpl }) : null,
  };
}

function notConfigured(config) {
  return {
    status: 503,
    body: { error: momoNotConfiguredMessage(config), momo: describeMomoConfig(config) },
  };
}

/**
 * Request a payment: validate, refuse what cannot be paid, reuse a prompt that
 * is already on the farmer's phone, otherwise ask MoMo for a new one.
 *
 * Returns { status, body }; the body always carries the payment record when
 * one exists, so a refused or failed attempt is visible in the app and to
 * Afriinnox rather than vanishing.
 */
export async function createPaymentRequest({ store, body, env = process.env, fetchImpl, now = nowIso() } = {}) {
  const { config, client } = momoFromEnv(env, fetchImpl);

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
  const referenceId = newMomoReference();
  const row = buildPayment(input.value, { id, referenceId, now });
  await store.createPayment(row);

  try {
    const sent = await client.requestToPay({
      amount: row.amount,
      currency: row.currency,
      externalId: row.id,
      payer: row.phone,
      payerMessage: row.payer_message,
      payeeNote: row.payee_note,
      referenceId,
    });
    const stored = await store.updatePayment(id, {
      provider_ref: sent.referenceId,
      status_checked_at: now,
      updated_at: now,
    });
    return { status: 201, body: { payment: publicPayment(stored || row) } };
  } catch (err) {
    // MoMo never accepted the request: the record stays as a FAILED attempt
    // with the reason, and nothing was charged.
    const failed = await store.updatePayment(id, paymentPatch(failPayment(row, err?.code || 'REQUEST_FAILED', now)));
    return {
      status: 502,
      body: {
        error: momoErrorMessage(err),
        payment: publicPayment(failed || failPayment(row, 'REQUEST_FAILED', now)),
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
    return { status: 409, body: { error: 'This payment has no MTN MoMo reference yet.', payment: publicPayment(payment) } };
  }

  const { config, client } = momoFromEnv(env, fetchImpl);
  if (!config.enabled || !client) return notConfigured(config);

  let provider;
  try {
    provider = await client.getStatus(payment.provider_ref);
  } catch (err) {
    const touched = await store.updatePayment(payment.id, paymentPatch(paymentTouched(payment, now)));
    return {
      status: 502,
      body: { error: momoErrorMessage(err), payment: publicPayment(touched || payment), refreshed: false },
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
 * A MoMo payment notification.
 *
 * The endpoint cannot authenticate MTN, so it trusts the body for NOTHING:
 * it finds the payment, asks MoMo itself, and applies that answer. A callback
 * can therefore never confirm a payment on its own, and never unlock a device.
 *
 * Look the payment up by our own id (`externalId`, which we set) or by the
 * X-Reference-Id, which may be the last path segment of the callback URL.
 */
export async function handleMomoCallback({ store, bridge, body, reference, env = process.env, fetchImpl, now = nowIso(), prefix } = {}) {
  const externalId = firstString(body?.externalId, body?.external_id, body?.id);
  const ref = firstString(body?.referenceId, body?.reference_id, reference);

  let payment = null;
  if (externalId && /^pay_/.test(externalId)) payment = await store.getPayment(externalId);
  if (!payment && ref) {
    payment = (await store.listPayments({ limit: 200 })).find((p) => p.provider_ref === ref) || null;
  }
  if (!payment) {
    return { status: 404, body: { error: 'Unknown MTN MoMo reference', reference: ref || externalId || null } };
  }

  const { config, client } = momoFromEnv(env, fetchImpl);
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
      body: { received: true, verified: false, error: momoErrorMessage(err), payment: publicPayment(touched || payment) },
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
