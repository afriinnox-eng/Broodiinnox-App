import { badRequest, json, options } from '../../../../lib/http.js';
import { ensureReady, getMailer } from '../../../../lib/server.js';
import { issueLoginCode, normalizeIdentifier, phoneKey, verifyPassword } from '../../../../lib/credentials.js';
import { sendTemplate } from '../../../../lib/notify.js';

/**
 * POST /api/auth/login
 * Body: { identifier, password }
 *
 * Step one of signing in. `identifier` is whatever the account was registered
 * with — an email address, or a phone number — and the answer is always the
 * same shape: if the password is right, a six-digit code is emailed and the
 * caller gets a challenge to send it back against.
 *
 * Unauthenticated on purpose: this IS the sign-in endpoint, so there is no key
 * it could ask the browser for.
 *
 * Two things it refuses to say:
 *
 *   - whether the identifier exists. A wrong password and an unknown account
 *     return the same 401 with the same words, and an unknown account still
 *     pays for a scrypt verification (against a throwaway hash) so the two
 *     cannot be told apart by how long the answer took.
 *   - the code, or anything derived from it. The response carries the challenge
 *     id only; the code exists in the email and in the store as a hash.
 *
 * 202 code emailed · 400 malformed · 401 refused · 503 mail is not configured
 */
export async function POST(request) {
  const { store } = await ensureReady();

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('Body must be JSON: { identifier, password }');
  }

  const identifier = typeof body?.identifier === 'string' ? body.identifier : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const who = normalizeIdentifier(identifier);
  if (who.kind === 'none' || !password) {
    return badRequest('An identifier (email or phone) and a password are required.');
  }

  // Where the account is looked up: an email maps straight to a credential, a
  // phone has to go through the contact that holds it.
  const address = who.kind === 'email' ? who.value : await emailForPhone(store, who.phone);
  const credential = address ? await store.getCredentialByEmail(address) : null;

  // Always verify, even with nothing to verify against, so a known address and
  // an unknown one cost the same.
  const stored = credential?.password_hash
    || 'scrypt$32768$00000000000000000000000000000000$'
      + '0'.repeat(128); // a valid-shaped hash that can never match
  const ok = await verifyPassword(password, stored);
  if (!credential || !ok) {
    return json({ error: 'That identifier and password do not match.', reason: 'bad-credentials' }, 401);
  }

  const contact = await store.getContactByEmail(address);
  const issued = await issueLoginCode({ store, email: address, contactId: contact?.id || null });
  if (!issued.ok) return json({ error: issued.error, reason: issued.reason }, 503);

  const delivery = await sendTemplate({
    store,
    mailer: getMailer(),
    to: [{ email: address, name: contact?.name || '', contact }],
    template: 'login_code',
    data: { name: contact?.name || '', email: address, code: issued.code, expiresMinutes: issued.expiresMinutes },
    deviceId: contact?.device_id || null,
    event: 'auth.login.code',
    enforceOptOut: false,
  });

  // If mail cannot leave the building nobody can finish signing in, and saying
  // so beats a spinner that never resolves. This is a server-wide condition,
  // not an account-specific one, so it reveals nothing about the identifier.
  if (delivery && delivery.configured === false) {
    return json({
      error: 'This server cannot send email right now, so the sign-in code cannot be delivered.',
      reason: 'mail-not-configured',
    }, 503);
  }

  return json({
    codeSent: true,
    challengeId: issued.challengeId,
    sentTo: maskEmail(address),
    expiresMinutes: issued.expiresMinutes,
    delivery: {
      sent: delivery?.sent || 0,
      failed: delivery?.failed || 0,
    },
  }, 202);
}

export async function OPTIONS() {
  return options();
}

/** The email that belongs to a phone number, or null. Both sides through the same key. */
export async function emailForPhone(store, phone) {
  if (!phone) return null;
  if (typeof store.getContactByPhone === 'function') {
    const contact = await store.getContactByPhone(phone);
    return contact?.email || null;
  }
  const contacts = await store.listContacts({ limit: 500 });
  const hit = contacts.find((c) => phoneKey(c.phone) === phoneKey(phone));
  return hit?.email || null;
}

/** `jean@farm.rw` -> `j•••@farm.rw`: enough to recognise, not enough to harvest. */
export function maskEmail(address) {
  const [name, domain] = String(address || '').split('@');
  if (!domain) return '•••';
  const head = name.slice(0, 1);
  return `${head}${'•'.repeat(Math.max(1, Math.min(4, name.length - 1)))}@${domain}`;
}
