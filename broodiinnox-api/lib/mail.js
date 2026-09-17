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
 *   4. There are two ways out, and the HTTPS one wins. SMTP is a mailbox
 *      (Gmail, Namecheap Private Email, anything); HTTPS is a provider's REST
 *      API on port 443. That second route exists because some hosts — Render's
 *      free instance types are one — silently drop outbound traffic to every
 *      SMTP port, so a correct mailbox with correct credentials still times
 *      out and no amount of SMTP configuration helps. When a provider key is
 *      configured, mail goes over HTTPS and the mailbox is only a fallback.
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

/**
 * The HTTPS providers this server can send through, one endpoint each.
 *
 *   MAIL_HTTP_PROVIDER  resend | brevo   (see DEFAULT_HTTP_MAIL_PROVIDER when
 *                                        it is not set)
 *   MAIL_HTTP_API_KEY   the provider key (or RESEND_API_KEY / BREVO_API_KEY)
 *   MAIL_FROM           an address on a domain verified at that provider —
 *                       Resend and Brevo both refuse to send as a domain you
 *                       have not proved you own, so this matters.
 */
export const HTTP_MAIL_ENDPOINTS = {
  resend: 'https://api.resend.com/emails',
  brevo: 'https://api.brevo.com/v3/smtp/email',
};

/**
 * Whose API a bare `MAIL_HTTP_API_KEY` is taken to belong to. Setting a
 * provider's own key variable (`RESEND_API_KEY`, `BREVO_API_KEY`) overrides
 * this, so the inference only decides the ambiguous case — and getting it wrong
 * is loud rather than silent: the provider answers 401 and `email_log` says so.
 */
export const DEFAULT_HTTP_MAIL_PROVIDER = 'resend';

/** A read-only call that answers "is this key real?" without sending anything. */
export const HTTP_MAIL_VERIFY_URLS = {
  resend: 'https://api.resend.com/domains',
  brevo: 'https://api.brevo.com/v3/account',
};

/** The variable each provider's key is normally kept in. */
export const HTTP_MAIL_KEY_ENV = { resend: 'RESEND_API_KEY', brevo: 'BREVO_API_KEY' };

export const HTTP_MAIL_PROVIDERS = Object.keys(HTTP_MAIL_ENDPOINTS);

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

  const invalid = [];
  if (user && !isValidEmail(user)) invalid.push('SMTP_USER');
  if (fromParsed.address && !isValidEmail(fromParsed.address)) invalid.push('MAIL_FROM');

  /* ---- the HTTPS route ---- */
  const providerRaw = raw('MAIL_HTTP_PROVIDER').toLowerCase();
  if (providerRaw && !HTTP_MAIL_PROVIDERS.includes(providerRaw)) invalid.push('MAIL_HTTP_PROVIDER');
  // The provider is inferred from whichever key is present, so a deployment
  // only has to get one variable right.
  const provider = HTTP_MAIL_PROVIDERS.includes(providerRaw) ? providerRaw
    : (raw('RESEND_API_KEY') ? 'resend'
      : (raw('BREVO_API_KEY') ? 'brevo'
        : (raw('MAIL_HTTP_API_KEY') ? DEFAULT_HTTP_MAIL_PROVIDER : '')));
  const apiKey = raw('MAIL_HTTP_API_KEY') || (provider ? raw(HTTP_MAIL_KEY_ENV[provider]) : '');

  const http = {
    enabled: !!provider && !!apiKey,
    provider: provider || null,
    apiKey,
    endpoint: raw('MAIL_HTTP_ENDPOINT') || (provider ? HTTP_MAIL_ENDPOINTS[provider] : null),
  };

  const smtpMissing = [];
  // SMTP_HOST has a default, so it is only "missing" in the sense that a
  // deployment with no mailbox at all is missing the two credentials that
  // matter. The host is reported only when there is nothing to send with.
  if (!user) smtpMissing.push('SMTP_USER');
  if (!pass) smtpMissing.push('SMTP_PASSWORD');
  const httpMissing = http.enabled ? []
    : (provider ? [HTTP_MAIL_KEY_ENV[provider]] : ['MAIL_HTTP_API_KEY']);

  const portRaw = raw('SMTP_PORT');
  const port = intOr(portRaw, DEFAULT_SMTP_PORT);
  if (portRaw && (port < 1 || port > 65535)) invalid.push('SMTP_PORT');

  const secure = boolOr(env.SMTP_SECURE, port === 465);

  /* Which way mail leaves. HTTPS is preferred when both are configured: it is
     the one that works on a host whose SMTP ports are blocked, and choosing it
     here keeps that decision in one place instead of in every caller. Anything
     invalid at all means no transport, because a bad MAIL_FROM breaks both. */
  const transport = invalid.length ? null
    : (http.enabled ? 'http' : (smtpMissing.length === 0 ? 'smtp' : null));
  // Names the variables that would make either route work, so a half-set-up
  // deployment says exactly what is absent rather than just "email is off".
  const missing = transport ? [] : [...httpMissing, ...smtpMissing];

  // A critical device alert nobody owns still has to reach Afriinnox, so the
  // ops list falls back to the mailbox itself rather than to silence.
  const opsTo = parseAddressList(raw('MAIL_OPS_TO'));
  const resolvedOpsTo = opsTo.length ? opsTo : (isValidEmail(fromParsed.address) ? [fromParsed.address] : []);

  const appBaseUrl = (raw('APP_BASE_URL') || raw('MAIL_APP_BASE_URL') || DEFAULT_APP_BASE_URL).replace(/\/+$/, '');

  return {
    enabled: !!transport,
    transport,
    http,
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
    transport: config.transport || null,
    http_provider: config.http?.provider || null,
    http_endpoint: config.http?.endpoint || null,
    http_key_set: !!config.http?.apiKey,
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
 * The request one HTTPS provider wants, built from this module's message shape.
 *
 * Exported so a test can assert the exact URL, headers and body without a
 * network — and so a third provider is a branch here rather than a change to
 * the send path.
 */
export function httpMailRequest(config, { to, subject, text, html, replyTo } = {}) {
  const http = config.http || {};
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);

  if (http.provider === 'brevo') {
    // Brevo takes the sender as an object and names each body by its format.
    return {
      url: http.endpoint,
      headers: { 'api-key': http.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: {
        sender: { email: config.from, name: config.fromName || undefined },
        to: recipients.map((address) => ({ email: address })),
        subject: String(subject),
        textContent: text || undefined,
        htmlContent: html || undefined,
        replyTo: (replyTo || config.replyTo) ? { email: replyTo || config.replyTo } : undefined,
      },
    };
  }

  // Resend.
  return {
    url: http.endpoint,
    headers: { Authorization: `Bearer ${http.apiKey}`, 'content-type': 'application/json' },
    body: {
      from: config.displayFrom || config.from,
      to: recipients,
      subject: String(subject),
      text: text || undefined,
      html: html || undefined,
      reply_to: replyTo || config.replyTo || undefined,
    },
  };
}

/**
 * An API error as one line for `email_log`: the provider's own words, so
 * "domain is not verified" reaches whoever reads the log. The key is never in
 * a provider's response, and nothing here adds it.
 */
export function providerMailError(status, payload) {
  const said = payload && (payload.message || payload.error || payload.detail);
  const detail = said ? String(said) : 'the provider refused the request';
  const code = payload && payload.name && payload.name !== 'application_error' ? ` (${payload.name})` : '';
  return `HTTP ${status}: ${detail}${code}`.slice(0, 300);
}

/**
 * A mailer bound to one configuration.
 *
 * `send({ to, subject, text, html, replyTo })` always resolves — never throws —
 * with `{ ok, id, skipped, reason, error }`. Pass `transport` to inject an SMTP
 * fake, or `fetchImpl` to stand in for the HTTPS provider: that is how the
 * tests cover both routes without a network.
 */
export function createMailer(config, { transport = null, fetchImpl = null } = {}) {
  let resolved = transport;
  let loading = null;
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);

  const timeout = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout
    ? AbortSignal.timeout(config.timeoutMs)
    : undefined);

  async function getTransport() {
    if (resolved) return resolved;
    // Only the SMTP route needs a socket; the HTTPS one is a plain fetch.
    if (config.http?.enabled || !config.enabled) return null;
    if (!loading) {
      loading = createSmtpTransport(config).then(
        (t) => { resolved = t; return t; },
        (err) => { loading = null; throw err; }
      );
    }
    return loading;
  }

  /** One POST to the provider, over HTTPS on 443. Never throws. */
  async function sendOverHttp({ recipients, subject, text, html, replyTo }) {
    if (!doFetch) {
      return { ok: false, error: 'This runtime has no fetch, so the HTTPS mail provider cannot be reached.' };
    }
    const request = httpMailRequest(config, { to: recipients, subject, text, html, replyTo });
    const res = await doFetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: timeout(),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: providerMailError(res.status, payload) };
    return { ok: true, id: (payload && (payload.id || payload.messageId)) || null };
  }

  /** Read-only: is this key real, and can it see the sending domain? Nothing is sent. */
  async function verifyHttp() {
    if (!doFetch) return { ok: false, error: 'This runtime has no fetch.' };
    const url = HTTP_MAIL_VERIFY_URLS[config.http.provider] || config.http.endpoint;
    try {
      const res = await doFetch(url, {
        method: 'GET',
        headers: config.http.provider === 'brevo'
          ? { 'api-key': config.http.apiKey, accept: 'application/json' }
          : { Authorization: `Bearer ${config.http.apiKey}` },
        signal: timeout(),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        return { ok: false, error: providerMailError(res.status, payload) };
      }
      return { ok: true, provider: config.http.provider, endpoint: config.http.endpoint, from: config.from };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
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
      // HTTPS first: a host that blocks SMTP egress cannot use the mailbox at
      // all, so a configured provider key is the only route that leaves.
      if (config.http?.enabled) {
        const out = await sendOverHttp({ recipients, subject, text, html, replyTo });
        return { ...out, recipients };
      }
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
      if (config.http?.enabled) return verifyHttp();
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
