/**
 * Password reset — the token half of it.
 *
 * A reset is two steps, and this module owns both:
 *
 *   requestPasswordReset   mint a single-use token, store only its SHA-256, email the link
 *   redeemPasswordReset    check the token, spend it, hand back the contact
 *
 * What is stored is the HASH, never the token: a dump of the database cannot be
 * turned back into working reset links, and a token that leaks from a log or a
 * screenshot is useless once spent.
 *
 * The token is spent by a single conditional UPDATE (`used_at IS NULL`), so two
 * simultaneous redemptions of the same link cannot both win — the second gets
 * no row back and is refused. That matters because a reset link is the one
 * thing that must never be replayable.
 *
 * IMPORTANT — what this deliberately does NOT do: there is no account system in
 * this API. There is no `password_hash` anywhere and no login endpoint, because
 * the dashboard authenticates with a shared API key rather than per-user
 * accounts. So `redeem` verifies the token and reports who it belonged to; it
 * does not set a password, because there is nowhere to put one. Wiring that up
 * means building accounts first — see README's "Email notifications" section.
 */
import { createHash, randomBytes } from 'node:crypto';
import { isValidEmail } from './mail.js';
import { sendTemplate } from './notify.js';

/** How long a reset link stays usable. */
export const RESET_TOKEN_TTL_MINUTES = 60;

/** Shortest password this API is willing to record. */
export const MIN_PASSWORD_LENGTH = 8;

/** SHA-256, hex. The only form of a token that is ever persisted. */
export function hashResetToken(raw) {
  return createHash('sha256').update(String(raw || ''), 'utf8').digest('hex');
}

/** A fresh token: the raw value goes in the email, the hash goes in the database. */
export function newResetToken() {
  const token = randomBytes(32).toString('hex');
  return { token, tokenHash: hashResetToken(token) };
}

/**
 * The link a person clicks. `baseUrl` is the app, not this API.
 *
 * The app is a single-page app on a static host, so the route lives in the URL
 * FRAGMENT: `{app}/#/reset-password?token=...`. It has to. The old shape -
 * `{app}/reset-password?token=...` - made the host serve the site's index.html,
 * the hash router stayed on the home screen, and the token was ignored: the
 * person was told a link had been sent and then landed on a sign-in form with
 * no way to use it.
 *
 * A fragment also never reaches the server, so the token is not written into
 * any access log on the way in.
 */
export function resetUrlFor(baseUrl, token) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return `${base}/#/reset-password?token=${encodeURIComponent(token)}`;
}

/** Is this a password we are willing to accept? */
export function validateNewPassword(password) {
  const value = typeof password === 'string' ? password : '';
  if (value.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (value.length > 200) {
    return { ok: false, error: 'Password must be at most 200 characters.' };
  }
  return { ok: true, value };
}

/** ISO string `minutes` from `now`. */
function expiryFrom(now, minutes) {
  const base = now instanceof Date ? now.getTime() : Date.parse(now);
  const from = Number.isFinite(base) ? base : Date.now();
  return new Date(from + minutes * 60_000).toISOString();
}

/**
 * Mint a reset token and email the link.
 *
 * `requireContact` decides what happens when the address is unknown:
 *   true  (the default) — refuse, and say so. Used by the admin-triggered flow,
 *                         where the caller is trusted and a clear "no such
 *                         farmer" beats a silent no-op.
 *   false              — refuse the same way but without revealing which, for a
 *                         public "forgot password" form, where a distinguishable
 *                         answer would let anyone test whether an address has
 *                         an account.
 *
 * Returns `{ ok, reason, contact, email, expiresAt, delivery }` — never throws.
 */
export async function requestPasswordReset({
  store,
  mailer,
  email,
  name = null,
  farmerId = null,
  deviceId = null,
  contactId = null,
  now = new Date().toISOString(),
  ttlMinutes = RESET_TOKEN_TTL_MINUTES,
  baseUrl = null,
  requireContact = true,
} = {}) {
  const address = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!isValidEmail(address)) {
    return { ok: false, reason: 'invalid-email', error: 'A valid email address is required.' };
  }
  if (!store || typeof store.createPasswordReset !== 'function') {
    return { ok: false, reason: 'no-store', error: 'This server has no store for reset tokens.' };
  }

  // A contact row is created on demand when a name or a device is supplied,
  // so an admin resetting a farmer's password also records where to reach them
  // for every later notification.
  let contact = contactId ? await store.getContact(contactId) : await store.getContactByEmail(address);
  if (!contact && (name || farmerId || deviceId)) {
    contact = await store.upsertContact({ email: address, name, farmerId, deviceId, role: 'farmer' });
  }
  if (!contact) {
    return {
      ok: false,
      reason: 'unknown-email',
      error: requireContact
        ? `No contact is registered for ${address}. Add the farmer first (POST /api/contacts).`
        : 'If that address has an account, a reset link has been sent.',
    };
  }
  if (contact.opted_in === false) {
    // A reset is transactional: the opt-out does not silence it, but it is
    // worth reporting so an admin is not surprised.
  }

  const { token, tokenHash } = newResetToken();
  const expiresAt = expiryFrom(now, ttlMinutes);
  await store.createPasswordReset({
    token_hash: tokenHash,
    contact_id: contact.id,
    email: address,
    expires_at: expiresAt,
    created_at: now instanceof Date ? now.toISOString() : now,
  });

  const config = (mailer && mailer.config) || { appBaseUrl: baseUrl || '' };
  const appBase = baseUrl || config.appBaseUrl;
  const delivery = await sendTemplate({
    store,
    mailer,
    to: [{ email: address, name: contact.name || name || '', contact }],
    template: 'password_reset',
    data: {
      name: contact.name || name || '',
      email: address,
      resetUrl: resetUrlFor(appBase, token),
      expiresMinutes: ttlMinutes,
    },
    deviceId: contact.device_id || deviceId || null,
    event: 'password.reset.requested',
    enforceOptOut: false,
  });

  return {
    ok: true,
    reason: null,
    contactId: contact.id,
    email: address,
    expiresAt,
    expiresMinutes: ttlMinutes,
    delivery,
  };
}

/**
 * Check a token and spend it.
 *
 * Returns `{ ok: true, contact }` exactly once per token. Every later call —
 * or a call with an unknown or expired token — returns `{ ok: false, reason }`
 * where `reason` is one of `unknown | expired | used`.
 */
export async function redeemPasswordReset({ store, token, now = new Date().toISOString() } = {}) {
  const raw = typeof token === 'string' ? token.trim() : '';
  if (!raw) return { ok: false, reason: 'unknown', error: 'A reset token is required.' };
  if (!store || typeof store.getPasswordReset !== 'function') {
    return { ok: false, reason: 'no-store', error: 'This server has no store for reset tokens.' };
  }

  const tokenHash = hashResetToken(raw);
  const row = await store.getPasswordReset(tokenHash);
  if (!row) return { ok: false, reason: 'unknown', error: 'This reset link is not valid.' };

  const nowMs = Date.parse(now);
  const expiresMs = Date.parse(row.expires_at);
  if (Number.isFinite(expiresMs) && Number.isFinite(nowMs) && nowMs >= expiresMs) {
    return { ok: false, reason: 'expired', error: 'This reset link has expired. Request a new one.' };
  }

  // Spend it atomically: only one caller can flip `used_at` from null.
  const spent = await store.usePasswordReset(tokenHash, now instanceof Date ? now : new Date(now));
  if (!spent) {
    return { ok: false, reason: 'used', error: 'This reset link has already been used.' };
  }

  const contact = await store.getContact(spent.contact_id);
  return { ok: true, reason: null, contact, email: spent.email };
}
