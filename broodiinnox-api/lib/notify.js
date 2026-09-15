/**
 * Notifications — the one place that decides WHO gets told WHAT, and the only
 * place that touches the mailer.
 *
 * Everything that reaches a person goes through `notify()`: resolve the
 * recipients for the event, render the template, send, and record the attempt
 * in `email_log` whether it succeeded or not.
 *
 * The rule that matters most here: **a notification can never break the thing
 * that caused it.** Ingesting telemetry, confirming a payment, unlocking a
 * device and answering Ekorana's callback all keep working when the mailbox is
 * unconfigured, when SMTP is down, or when a contact row is nonsense. Nothing
 * in this file throws at its caller — every failure comes back as a result
 * object and lands in the log.
 *
 * Recipients, in order:
 *   1. contacts bound to this device          (the person using it)
 *   2. contacts bound to the farmer who owns it
 *   3. the operators in MAIL_OPS_TO, and if that is unset, the mailbox itself
 *
 * Step 3 is deliberate: an alert about a unit nobody is registered against must
 * still reach Afriinnox rather than vanish, because a silent brooder is exactly
 * the failure this system exists to catch.
 *
 * Opt-out: `contacts.opted_in = false` silences device alerts and subscription
 * reminders. It does NOT silence a password reset or a payment receipt — those
 * are transactional and the person asked for them. Account-critical mail is the
 * exception, and this is the only place that distinction is enforced.
 */
import { renderEmail } from './emailTemplates.js';
import { createMailer, isValidEmail, resolveMailConfig } from './mail.js';

/** Templates a person cannot opt out of: they asked, or it is their receipt. */
export const ALWAYS_SEND_TEMPLATES = new Set(['password_reset', 'payment_received', 'welcome']);

/** Statuses written to `email_log`. */
export const EMAIL_STATUS = {
  sent: 'sent',
  failed: 'failed',
  skipped: 'skipped',
};

/** Deduplicated, lower-cased address list, preserving the first name seen. */
function mergeRecipient(map, contact) {
  const email = typeof contact?.email === 'string' ? contact.email.trim().toLowerCase() : '';
  if (!isValidEmail(email) || map.has(email)) return;
  map.set(email, { email, name: contact.name || '', contact });
}

/**
 * Who should hear about this device.
 *
 * Returns `[{ email, name, contact }]`, possibly empty — the caller decides
 * whether empty means "use the operators" or "there is nobody to tell".
 */
export async function resolveContacts(store, { deviceId, farmerId, device } = {}) {
  const out = new Map();
  try {
    if (deviceId) {
      for (const c of await store.listContacts({ deviceId })) mergeRecipient(out, c);
    }
    const owner = farmerId || device?.farmer_id || null;
    if (owner) {
      for (const c of await store.listContacts({ farmerId: owner })) mergeRecipient(out, c);
    }
  } catch {
    // An unreadable contacts table must not stop the notification path from
    // reporting the failure in the log.
  }
  return [...out.values()];
}

/** The operator fallback list, from config. */
export function operatorRecipients(config) {
  return (config?.opsTo || [])
    .filter((email) => isValidEmail(email))
    .map((email) => ({ email, name: config.fromName || 'Broodiinnox', contact: null }));
}

/**
 * Send one rendered template to an explicit address list.
 *
 * Always resolves `{ ok, sent, skipped, failed, results }`. Every attempt is
 * recorded, so "the email never arrived" can be answered from the database
 * rather than by opening the mailbox.
 */
export async function sendTemplate({
  store,
  mailer,
  to,
  template,
  data = {},
  deviceId = null,
  paymentId = null,
  event = null,
  enforceOptOut = false,
} = {}) {
  const recipients = (Array.isArray(to) ? to : [to]).filter((r) => r && isValidEmail(r.email));

  if (!recipients.length) {
    return { ok: false, sent: 0, skipped: 0, failed: 0, results: [], error: 'No deliverable recipient address.' };
  }

  const rendered = renderEmail(template, data);
  if (!rendered) {
    return { ok: false, sent: 0, skipped: 0, failed: 0, results: [], error: `Unknown email template "${template}".` };
  }

  const m = mailer || createMailer(resolveMailConfig({}));
  const results = [];
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const recipient of recipients) {
    // Opt-out only applies to the templates that are not transactional.
    const refused = enforceOptOut
      && !ALWAYS_SEND_TEMPLATES.has(template)
      && recipient.contact
      && recipient.contact.opted_in === false;

    if (refused) {
      skipped += 1;
      results.push({ email: recipient.email, status: EMAIL_STATUS.skipped, reason: 'opted-out' });
      await record({ store, recipient, rendered, status: EMAIL_STATUS.skipped, error: 'Recipient has notifications switched off.', deviceId, paymentId, event });
      continue;
    }

    const out = await m.send({
      to: recipient.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });

    if (out.ok) {
      sent += 1;
      results.push({ email: recipient.email, status: EMAIL_STATUS.sent, id: out.id || null });
      await record({ store, recipient, rendered, status: EMAIL_STATUS.sent, providerId: out.id, deviceId, paymentId, event });
    } else if (out.skipped) {
      // The mailbox is not configured, or the address is unusable. Recorded as
      // skipped with the reason, so a half-set-up server is visible rather than
      // looking like it silently sent nothing.
      skipped += 1;
      results.push({ email: recipient.email, status: EMAIL_STATUS.skipped, reason: out.reason || 'skipped' });
      await record({ store, recipient, rendered, status: EMAIL_STATUS.skipped, error: out.error, deviceId, paymentId, event });
    } else {
      failed += 1;
      results.push({ email: recipient.email, status: EMAIL_STATUS.failed, error: out.error || 'send failed' });
      await record({ store, recipient, rendered, status: EMAIL_STATUS.failed, error: out.error, deviceId, paymentId, event });
    }
  }

  return {
    ok: failed === 0,
    sent, skipped, failed, results,
    template,
    configured: !!m.enabled,
  };
}

async function record({ store, recipient, rendered, status, providerId = null, error = null, deviceId, paymentId, event }) {
  if (!store || typeof store.logEmail !== 'function') return;
  try {
    await store.logEmail({
      to_email: recipient.email,
      template: rendered.template,
      subject: rendered.subject,
      status,
      provider_id: providerId,
      error: error || null,
      device_id: deviceId || null,
      payment_id: paymentId || null,
      event: event || null,
    });
  } catch {
    // The log is diagnostics, never the point of the request.
  }
}

/**
 * The generic entry point: an event plus the people it concerns.
 * `kind` picks the recipient rule; everything else is pass-through.
 */
export async function notify({
  store, mailer, template, data = {}, deviceId = null, farmerId = null, device = null,
  paymentId = null, event = null, to = null, useOperatorFallback = true,
} = {}) {
  const config = (mailer && mailer.config) || resolveMailConfig({});

  const explicit = to ? (Array.isArray(to) ? to : [to]) : null;
  let recipients = explicit
    ? explicit.filter((r) => isValidEmail(r?.email)).map((r) => ({ email: r.email.toLowerCase(), name: r.name || '', contact: r.contact || null }))
    : await resolveContacts(store, { deviceId, farmerId, device });

  if (!recipients.length && useOperatorFallback) {
    recipients = operatorRecipients(config);
  }

  if (!recipients.length) {
    return {
      ok: false, sent: 0, skipped: 0, failed: 0, results: [],
      error: 'No recipient for this notification and no operator fallback is configured (MAIL_OPS_TO).',
      template,
    };
  }

  return sendTemplate({
    store, mailer, to: recipients, template, data, deviceId, paymentId, event,
    enforceOptOut: true,
  });
}

/**
 * A payment outcome. Only ever called once the gateway has settled it, so a
 * receipt means money actually arrived.
 *
 * The name in the greeting comes from the contact, falling back to the farmer
 * id, so a receipt is addressed to a person wherever we know one.
 */
export async function notifyPaymentResult({ store, mailer, payment, device = null, confirmed, unlock = null } = {}) {
  if (!payment) return { ok: false, error: 'No payment to notify about.' };

  const recipients = await resolveContacts(store, {
    deviceId: payment.device_id,
    farmerId: payment.farmer_id,
    device,
  });
  const withNames = recipients.map((r) => ({ ...r, name: r.name || payment.farmer_id || '' }));
  const config = (mailer && mailer.config) || resolveMailConfig({});
  const to = withNames.length ? withNames : operatorRecipients(config);

  const template = confirmed ? 'payment_received' : 'payment_failed';
  const data = {
    name: (to[0] && to[0].name) || '',
    deviceId: payment.device_id,
    amount: payment.amount,
    currency: payment.currency,
    planId: payment.plan_id,
    reference: payment.id,
    phone: payment.phone,
    paidAt: payment.confirmed_at || payment.updated_at || null,
    reason: payment.reason || '',
    daysAdded: unlock && unlock.days_added !== undefined ? unlock.days_added : (payment.plan_id || ''),
    appUrl: config.appBaseUrl,
  };

  return sendTemplate({
    store, mailer, to, template, data,
    deviceId: payment.device_id,
    paymentId: payment.id,
    event: confirmed ? 'payment.confirmed' : 'payment.failed',
    // A receipt is transactional: never suppressed by an opt-out.
    enforceOptOut: false,
  });
}

/** A condition the unit raised. `severity` decides how urgently it reads. */
export async function notifyDeviceAlert({ store, mailer, device, alert } = {}) {
  const a = alert || {};
  if (!a.device_id && !device?.device_id) return { ok: false, error: 'No alert to notify about.' };

  const config = (mailer && mailer.config) || resolveMailConfig({});
  const recipients = await resolveContacts(store, {
    deviceId: a.device_id || device?.device_id,
    farmerId: device?.farmer_id,
    device,
  });
  const to = recipients.length ? recipients : operatorRecipients(config);

  return sendTemplate({
    store, mailer, to, template: 'device_alert',
    data: {
      name: (to[0] && to[0].name) || '',
      deviceId: a.device_id || device?.device_id,
      severity: a.severity || 'warning',
      kind: a.kind || 'condition',
      message: a.message || '',
      ts: a.ts || new Date().toISOString(),
      appUrl: config.appBaseUrl,
    },
    deviceId: a.device_id || device?.device_id || null,
    event: `alert.${a.kind || 'condition'}`,
    enforceOptOut: true,
  });
}

/** A reminder that the paid period is ending. */
export async function notifySubscriptionExpiring({ store, mailer, device, daysLeft, endsAt = null, planId = null } = {}) {
  const config = (mailer && mailer.config) || resolveMailConfig({});
  const recipients = await resolveContacts(store, { deviceId: device?.device_id, farmerId: device?.farmer_id, device });
  const to = recipients.length ? recipients : operatorRecipients(config);

  return sendTemplate({
    store, mailer, to, template: 'subscription_expiring',
    data: {
      name: (to[0] && to[0].name) || '',
      deviceId: device?.device_id,
      daysLeft,
      endsAt,
      planId,
      appUrl: config.appBaseUrl,
    },
    deviceId: device?.device_id || null,
    event: 'subscription.expiring',
    enforceOptOut: true,
  });
}
