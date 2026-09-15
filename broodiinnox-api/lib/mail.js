/**
 * Transactional email — the SMTP transport behind every notification this
 * server sends (subscription receipts, device alerts, password resets).
 *
 * Mail goes out through the Afriinnox mailbox on Namecheap Private Email
 * (`mail.privateemail.com`), which needs SSL and authentication and takes the
 * full address as the username. Those are the only credentials this module
 * needs; everything else has a working default.
 *
 * Three rules shape this file:
 *
 *   1. A missing mailbox NEVER breaks a request. With no credentials the
 *      mailer reports itself disabled and every send is a no-op returning
 *      `{ skipped: true }` — collecting a payment, ingesting telemetry and
 *      unlocking a device must all keep working on a deployment whose email
 *      is not set up yet.
 *   2. A send failure is never thrown at the caller. `sendMail` returns a
 *      result object, so an SMTP outage can never fail a payment or a callback.
 *   3. The transport is injectable. `createMailer` takes one, which is how the
 *      tests exercise the whole path without a network, and why it is safe for
 *      `scripts/verify.mjs` to run with no dependencies installed —
 *      nodemailer is imported lazily, only when a real send actually happens.
 *
 * The password is never logged, never returned and never included in a health
 * payload: `describeMailConfig` reports whether it is SET, never its value.
 */
import { EMAIL_RE } from './constants.js';

/** Env vars without which no mail can be sent at all. */
export const MAIL_REQUIRED_ENV = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'];

/** Namecheap Private Email. Overridable, but this is the right default here. */
export const DEFAULT_SMTP_HOST = 'mail.privateemail.com';
export const DEFAULT_SMTP_PORT = 465; // 465 = implicit SSL, 587 = STARTTLS
export const DEFAULT_MAIL_FROM = 'info@afriinnox.com';
export const DEFAULT_FROM_NAME = 'Broodiinnox';
export const DEFAULT_APP_BASE_URL = 'https://broodiinnox-app.onrender.com';
export const DEFAULT_MAIL_TIMEOUT_MS = 15000;

/** True when `value` looks like an address we are willing to send to. */
export function isValidEmail(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 254) return false;
  return EMAIL_RE.test(trimmed);
}

/** `"Name <a@b.c>"` -> `{ name, address }`; a bare address -> `{ name:'', ... }`. */
export function parseAddress(input) {
  const raw = typeof input === 'string' ? input.trim() : '';
  const angled = raw.match(/^(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (angled) {
    const address = angled[2].trim().toLowerCase();
    return { name: angled[1].replace(/^["']|["']$/g, '').trim(), address };
  }
  return { name: '', address: raw.toLowerCase() };
}

/**
 * Lower-cased, trimmed address, or null when it is not usable.
 * Used to key `contacts` so "Info@Afriinnox.com" and "info@afriinnox.com" are
 * one recipient rather than two.
 */
export function normalizeAddress(value) {
  const { address } = parseAddress(value);
  return isValidEmail(address) ? address : null;
}

/** Parse a comma/semicolon separated list of addresses, dropping the junk. */
export function parseAddressList(value) {
  if (Array.isArray(value)) return value.map(normalizeAddress).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value
    .split(/[,;]/)
    .map((part) => normalizeAddress(part))
    .filter(Boolean);
}

function intOr(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function boolOr(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const s = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return fallback;
}

/**
 * Resolve the mailbox configuration from env.
 *
 * `missing` names what is absent; `invalid` names what is present but unusable
 * (an address that is not an address, a port that is not a port). Reporting
 * them separately is what lets a half-configured deployment say exactly which
 * variable is wrong instead of just "email does not work".
 */
export function resolveMailConfig(env = {}) {
  const raw = (key) => {
    const v = env[key];
    return typeof v === 'string' && v.trim() ? v.trim() : '';
  };

  const host = raw('SMTP_HOST') || DEFAULT_SMTP_HOST;
  const user = raw('SMTP_USER');
  const pass = raw('SMTP_PASSWORD');

  const fromParsed = parseAddress(raw('MAIL_FROM') || user || DEFAULT_MAIL_FROM);
  const fromName = raw('MAIL_FROM_NAME') || DEFAULT_FROM_NAME;
  const replyTo = normalizeAddress(raw('MAIL_REPLY_TO')) || fromParsed.address || null;

  const missing = [];
  // SMTP_HOST has a default, so it is only "missing" in the sense that a
  // deployment with no mailbox at all is missing the two credentials that
  // matter. Report the host only when there is nothing to send with.
  if (!user) missing.push('SMTP_USER');
  if (!pass) missing.push('SMTP_PASSWORD');

  const invalid = [];
  if (user && !isValidEmail(user)) invalid.push('SMTP_USER');
  if (fromParsed.address && !isValidEmail(fromParsed.address)) invalid.push('MAIL_FROM');

  const portRaw = raw('SMTP_PORT');
  const port = intOr(portRaw, DEFAULT_SMTP_PORT);
  if (portRaw && (port < 1 || port > 65535)) invalid.push('SMTP_PORT');

  const secure = boolOr(env.SMTP_SECURE, port === 465);

  // A critical device alert nobody owns still has to reach Afriinnox, so the
  // ops list falls back to the mailbox itself rather than to silence.
  const opsTo = parseAddressList(raw('MAIL_OPS_TO'));
  const resolvedOpsTo = opsTo.length ? opsTo : (isValidEmail(fromParsed.address) ? [fromParsed.address] : []);

  const appBaseUrl = (raw('APP_BASE_URL') || raw('MAIL_APP_BASE_URL') || DEFAULT_APP_BASE_URL).replace(/\/+$/, '');

  return {
    enabled: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
    host,
    port,
    secure,
    user,
    pass,
    from: fromParsed.address || null,
    fromName: fromName || null,
    replyTo,
    displayFrom: fromParsed.address
      ? (fromName ? `${fromName} <${fromParsed.address}>` : fromParsed.address)
      : null,
    opsTo: resolvedOpsTo,
    appBaseUrl,
    timeoutMs: intOr(raw('MAIL_TIMEOUT_MS'), DEFAULT_MAIL_TIMEOUT_MS),
  };
}

/** Safe to log or return over HTTP: presence flags and addresses, no password. */
export function describeMailConfig(config) {
  return {
    enabled: !!config.enabled,
    host: config.host,
    port: config.port,
    secure: !!config.secure,
    user_set: !!config.user,
    password_set: !!config.pass,
    from: config.from,
    reply_to: config.replyTo || null,
    ops_to: config.opsTo || [],
    app_base_url: config.appBaseUrl,
    missing: config.missing || [],
    invalid: config.invalid || [],
  };
}

/** The operator-facing "why is no email going out?" sentence. */
export function mailNotConfiguredMessage(config) {
  const parts = [];
  if (config.missing?.length) parts.push(`missing: ${config.missing.join(', ')}`);
  if (config.invalid?.length) parts.push(`invalid: ${config.invalid.join(', ')}`);
  const detail = parts.length ? ` (${parts.join('; ')})` : '';
  return `Email is not configured on the server yet${detail}, so no notification can be sent.`;
}

/** The nodemailer transport. Imported here and nowhere else, lazily. */
export async function createSmtpTransport(config) {
  const { default: nodemailer } = await import('nodemailer');
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: !!config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: config.timeoutMs,
    greetingTimeout: config.timeoutMs,
    socketTimeout: config.timeoutMs,
  });
}

/**
 * A mailer bound to one configuration.
 *
 * `send({ to, subject, text, html, replyTo })` always resolves — never throws —
 * with `{ ok, id, skipped, reason, error }`. Pass `transport` to inject a fake.
 */
export function createMailer(config, { transport = null } = {}) {
  let resolved = transport;
  let loading = null;

  async function getTransport() {
    if (resolved) return resolved;
    if (!config.enabled) return null;
    if (!loading) {
      loading = createSmtpTransport(config).then(
        (t) => { resolved = t; return t; },
        (err) => { loading = null; throw err; }
      );
    }
    return loading;
  }

  async function send({ to, subject, text, html, replyTo } = {}) {
    if (!config.enabled) {
      return { ok: false, skipped: true, reason: 'not-configured', error: mailNotConfiguredMessage(config) };
    }

    // A recipient list is a list of addresses: anything unusable is dropped
    // rather than sent to, so a bad contact row cannot make a whole
    // notification fail for the recipients who are fine.
    const recipients = parseAddressList(to);
    if (!recipients.length) {
      return { ok: false, skipped: true, reason: 'no-recipient', error: 'No deliverable recipient address.' };
    }
    if (!subject || !String(subject).trim()) {
      return { ok: false, skipped: true, reason: 'no-subject', error: 'Refusing to send an email with no subject.' };
    }

    try {
      const t = await getTransport();
      if (!t) {
        return { ok: false, skipped: true, reason: 'not-configured', error: mailNotConfiguredMessage(config) };
      }
      const info = await t.sendMail({
        from: config.displayFrom || config.from,
        to: recipients.join(', '),
        replyTo: replyTo || config.replyTo || undefined,
        subject: String(subject),
        text: text || undefined,
        html: html || undefined,
      });
      return { ok: true, id: (info && (info.messageId || info.id)) || null, recipients };
    } catch (err) {
      // Deliberately swallowed: an SMTP failure must never surface as a failed
      // payment, a failed callback or a failed telemetry ingest.
      return { ok: false, error: err && err.message ? err.message : String(err), recipients };
    }
  }

  return {
    enabled: !!config.enabled,
    config,
    send,
    /** Verify the mailbox really accepts these credentials (used by a CLI check). */
    async verify() {
      if (!config.enabled) {
        return { ok: false, skipped: true, reason: 'not-configured', error: mailNotConfiguredMessage(config) };
      }
      try {
        const t = await getTransport();
        if (typeof t.verify === 'function') await t.verify();
        return { ok: true, host: config.host, port: config.port, user: config.user };
      } catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) };
      }
    },
  };
}

/** Config + mailer straight from an env object. */
export function mailFromEnv(env = {}) {
  const config = resolveMailConfig(env);
  return { config, mailer: createMailer(config) };
}
