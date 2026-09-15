/**
 * Accounts: the password, and the code that proves the mailbox.
 *
 * Until now the dashboard decided who you were from its own browser state — the
 * identifier you typed was matched against a list held in localStorage, and the
 * password field was accepted without ever being checked. That is not
 * authentication. This module is the first half of making it one:
 *
 *   hashPassword / verifyPassword      a password that is salted, hashed and
 *                                      checked on the server, in constant time
 *   issueLoginCode / verifyLoginCode   one six-digit code, emailed, hashed at
 *                                      rest, single-use, expiring, attempt-limited
 *
 * The two are separate on purpose. The password is what you know; the code is
 * what proves you still hold the mailbox the account was registered with. A
 * login needs both, so a leaked password alone does not open a farm's controls.
 *
 * What is stored is never the secret. A password is stored as
 * `scrypt$<N>$<salt>$<key>`; a login code is stored as the SHA-256 of the
 * challenge id and the code together, so a dump of the database cannot be
 * replayed into a login, and a code lifted from one challenge cannot be spent
 * on another — the hash only matches against the challenge it was minted for.
 *
 * Errors are returned, never thrown, and the refusals an unauthenticated caller
 * can provoke are deliberately coarse: `verifyLoginCode` reports `wrong`,
 * `expired`, `used`, `too-many-attempts` or `unknown`, and the route above it
 * decides what to say out loud. Nothing here tells a caller whether an address
 * has an account — that is the caller's job, and it must not.
 *
 * Honest limit: nothing in this file decides which shell someone lands in, or
 * what they may do once there. It establishes "knows the password" and
 * "controls the mailbox". Authorization still comes from the app's own records
 * until accounts move server-side.
 */
import { randomInt, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

/** scrypt cost. 2^15 with r=8, p=1 is ~100ms on the API's class of machine. */
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

/**
 * scrypt needs `128 * N * r` bytes to run, which at N=32768 with r=8 is exactly
 * 32 MiB — precisely Node's default `maxmem`, and the default is a cap the
 * parameters must stay UNDER, so the call is rejected outright unless the
 * budget is stated. Twice the requirement leaves room to raise N later.
 */
const scryptMemory = (N) => 128 * N * SCRYPT_R * 2;

/** How long an emailed login code stays usable. */
export const LOGIN_CODE_TTL_MINUTES = 10;

/** How many wrong digits a single challenge tolerates before it is dead. */
export const LOGIN_CODE_MAX_ATTEMPTS = 5;

/** Digits in a login code. */
export const LOGIN_CODE_LENGTH = 6;

/**
 * The canonical digits of a phone number: the country code and the trunk zero
 * removed, so every way a Rwandan number gets written collapses to one string.
 *
 *   0788123456 · 0788 123 456 · 0788-123-456 · +250788123456 · 250788123456
 *      -> 788123456
 *
 * Getting this wrong is not cosmetic: it is the difference between recognising
 * a farmer's own number and telling them their account does not exist.
 */
export function phoneKey(raw) {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('250')) digits = digits.slice(3);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

/**
 * Split whatever someone typed into the two kinds of identifier this system
 * issues: an email address, or a phone number.
 */
export function normalizeIdentifier(raw) {
  const typed = typeof raw === 'string' ? raw.trim() : '';
  if (!typed) return { kind: 'none', value: '', phone: '' };
  if (typed.includes('@')) return { kind: 'email', value: typed.toLowerCase(), phone: '' };
  const digits = phoneKey(typed);
  return { kind: digits ? 'phone' : 'none', value: digits, phone: digits };
}

/** `scrypt$N$salt$key`, all hex where it is not a number. */
export async function hashPassword(password) {
  const value = typeof password === 'string' ? password : '';
  const salt = randomUUID().replace(/-/g, '');
  const key = await scryptAsync(value, salt, KEY_LENGTH, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: scryptMemory(SCRYPT_N),
  });
  return `scrypt$${SCRYPT_N}$${salt}$${key.toString('hex')}`;
}

/**
 * Does this password match the stored hash?
 *
 * Always does the scrypt work and always compares with `timingSafeEqual`, so a
 * wrong password and a wrong *format* take the same time and cannot be told
 * apart by a stopwatch. Anything unparseable is simply a miss.
 */
export async function verifyPassword(password, stored) {
  const value = typeof password === 'string' ? password : '';
  const hash = typeof stored === 'string' ? stored : '';
  const parts = hash.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const salt = parts[2];
  const expected = Buffer.from(parts[3], 'hex');
  if (!Number.isFinite(N) || !salt || !expected.length) return false;
  const key = await scryptAsync(value, salt, expected.length, {
    N, r: SCRYPT_R, p: SCRYPT_P, maxmem: scryptMemory(N),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A six-digit code, uniformly random, always the full width. */
export function newLoginCode() {
  return String(randomInt(0, 10 ** LOGIN_CODE_LENGTH)).padStart(LOGIN_CODE_LENGTH, '0');
}

/** The only form of a login code that is ever persisted. Bound to its challenge. */
export function hashLoginCode(challengeId, code) {
  return createHash('sha256').update(`${challengeId}:${String(code || '')}`, 'utf8').digest('hex');
}

function expiryFrom(nowISO, minutes) {
  const base = Date.parse(nowISO);
  const from = Number.isFinite(base) ? base : Date.now();
  return new Date(from + minutes * 60_000).toISOString();
}

/**
 * Mint a code for an email address and hand back the raw value for the email
 * that is about to be sent. The store keeps only the hash.
 *
 * The challenge id is not a secret — it goes to the client so the client can
 * send it back with the code — which is why the code hash is bound to it.
 */
export async function issueLoginCode({
  store,
  email,
  contactId = null,
  now = new Date().toISOString(),
  ttlMinutes = LOGIN_CODE_TTL_MINUTES,
} = {}) {
  const address = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!address) return { ok: false, reason: 'invalid-email', error: 'An email address is required.' };
  if (!store || typeof store.createLoginCode !== 'function') {
    return { ok: false, reason: 'no-store', error: 'This server has no store for login codes.' };
  }

  const challengeId = randomUUID();
  const code = newLoginCode();
  const expiresAt = expiryFrom(now, ttlMinutes);
  await store.createLoginCode({
    challenge_id: challengeId,
    email: address,
    contact_id: contactId,
    code_hash: hashLoginCode(challengeId, code),
    expires_at: expiresAt,
    created_at: now,
  });

  return { ok: true, challengeId, email: address, code, expiresAt, expiresMinutes: ttlMinutes };
}

/**
 * Check a code against its challenge and spend it.
 *
 * Returns `{ ok: true, email, contactId }` exactly once per challenge. Every
 * later call, a wrong code, an expired one, or one whose challenge has been
 * guessed at too many times returns `{ ok: false, reason }`, where `reason` is
 * one of `unknown | expired | used | too-many-attempts | wrong`.
 */
export async function verifyLoginCode({
  store,
  challengeId,
  code,
  now = new Date().toISOString(),
} = {}) {
  const id = typeof challengeId === 'string' ? challengeId.trim() : '';
  const typed = typeof code === 'string' ? code.trim() : '';
  if (!id || !typed) return { ok: false, reason: 'unknown', error: 'A challenge and a code are required.' };
  if (!store || typeof store.getLoginCode !== 'function') {
    return { ok: false, reason: 'no-store', error: 'This server has no store for login codes.' };
  }

  const row = await store.getLoginCode(id);
  if (!row) return { ok: false, reason: 'unknown', error: 'This code is not valid.' };
  if (row.used_at) return { ok: false, reason: 'used', error: 'This code has already been used.' };

  const nowMs = Date.parse(now);
  const expiresMs = Date.parse(row.expires_at);
  if (Number.isFinite(expiresMs) && Number.isFinite(nowMs) && nowMs >= expiresMs) {
    return { ok: false, reason: 'expired', error: 'This code has expired. Ask for a new one.' };
  }

  const attempts = Number(row.attempts) || 0;
  if (attempts >= LOGIN_CODE_MAX_ATTEMPTS) {
    return { ok: false, reason: 'too-many-attempts', error: 'Too many wrong codes. Ask for a new one.' };
  }

  const expected = Buffer.from(row.code_hash || '', 'hex');
  const given = Buffer.from(hashLoginCode(id, typed), 'hex');
  const matches = expected.length === given.length && expected.length > 0 && timingSafeEqual(expected, given);

  if (!matches) {
    // Burn an attempt and report how many are left, but never whether the
    // address exists — a wrong code is a wrong code.
    const left = await store.bumpLoginCodeAttempts(id);
    const remaining = Math.max(0, LOGIN_CODE_MAX_ATTEMPTS - (Number(left?.attempts) || attempts + 1));
    return {
      ok: false,
      reason: 'wrong',
      attemptsRemaining: remaining,
      error: remaining > 0
        ? `That code is not right. ${remaining} ${remaining === 1 ? 'try' : 'tries'} left.`
        : 'Too many wrong codes. Ask for a new one.',
    };
  }

  // Spend it atomically: only one caller can flip `used_at` from null.
  const spent = await store.useLoginCode(id, now);
  if (!spent) return { ok: false, reason: 'used', error: 'This code has already been used.' };

  return { ok: true, reason: null, email: row.email, contactId: row.contact_id || null };
}
