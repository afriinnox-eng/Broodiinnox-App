/**
 * The account and login-code invariants.
 *
 * These are the properties that must hold for EVERY input, not for one happy
 * path — the whole point of a code being single-use, expiring and
 * attempt-limited is that the failures are the feature:
 *
 *   1. a password is never stored or compared in the clear
 *   2. a login code is bound to its challenge, spent once, and dies on expiry
 *   3. a challenge cannot be guessed at: every wrong code costs an attempt
 *   4. nothing here reveals whether an address has an account
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../lib/store.js';
import {
  LOGIN_CODE_MAX_ATTEMPTS,
  hashLoginCode,
  hashPassword,
  issueLoginCode,
  newLoginCode,
  normalizeIdentifier,
  verifyLoginCode,
  verifyPassword,
} from '../lib/credentials.js';

const AT = '2026-01-01T10:00:00.000Z';
const LATER = '2026-01-01T10:30:00.000Z';

async function freshStore() {
  const s = new MemoryStore();
  await s.init();
  return s;
}

/* ------------------------------------------------------------------ */
/* 1. passwords                                                        */
/* ------------------------------------------------------------------ */

test('a password is never stored as itself, and never twice the same way', async () => {
  const a = await hashPassword('Correct-Horse-9');
  const b = await hashPassword('Correct-Horse-9');
  assert.ok(!a.includes('Correct-Horse-9'), 'the password must not appear in the hash');
  assert.notEqual(a, b, 'a salt per hash, so two of the same password differ');
  assert.match(a, /^scrypt\$32768\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
});

test('verification accepts the right password and refuses everything else', async () => {
  const stored = await hashPassword('Correct-Horse-9');
  assert.equal(await verifyPassword('Correct-Horse-9', stored), true);
  for (const wrong of ['', 'correct-horse-9', 'Correct-Horse-9 ', 'nope', null, undefined]) {
    assert.equal(await verifyPassword(wrong, stored), false, `must refuse ${JSON.stringify(wrong)}`);
  }
});

test('a malformed stored hash is a miss, not a crash', async () => {
  for (const bad of ['', 'plaintext', 'scrypt$32768$deadbeef', 'scrypt$x$salt$00', null, undefined, 42]) {
    assert.equal(await verifyPassword('anything', bad), false, `must refuse a stored value of ${JSON.stringify(bad)}`);
  }
});

/* ------------------------------------------------------------------ */
/* 2. identifiers                                                      */
/* ------------------------------------------------------------------ */

test('every shape of phone number is the same account', () => {
  const forms = ['0788123456', '0788 123 456', '0788-123-456', '+250788123456', '250788123456'];
  const normalized = forms.map((f) => normalizeIdentifier(f));
  for (const n of normalized) assert.equal(n.kind, 'phone');
  assert.equal(new Set(normalized.map((n) => n.value)).size, 1, 'all forms must reduce to one value');
});

test('an email is an email, and anything empty is neither', () => {
  assert.equal(normalizeIdentifier(' Jean@Farm.RW ').kind, 'email');
  assert.equal(normalizeIdentifier(' Jean@Farm.RW ').value, 'jean@farm.rw');
  for (const empty of ['', '   ', null, undefined, '+']) {
    assert.equal(normalizeIdentifier(empty).kind, 'none', `${JSON.stringify(empty)} is no identifier`);
  }
});

/* ------------------------------------------------------------------ */
/* 3. login codes                                                      */
/* ------------------------------------------------------------------ */

test('a code is six digits, and the raw value is never what gets stored', async () => {
  const store = await freshStore();
  const out = await issueLoginCode({ store, email: 'jean@farm.rw', now: AT });
  assert.equal(out.ok, true);
  assert.match(out.code, /^\d{6}$/);

  const row = await store.getLoginCode(out.challengeId);
  assert.notEqual(row.code_hash, out.code);
  assert.equal(row.code_hash, hashLoginCode(out.challengeId, out.code));
  assert.equal(row.attempts, 0);
  assert.equal(row.used_at, null);
});

test('a correct code works exactly once', async () => {
  const store = await freshStore();
  const { challengeId, code } = await issueLoginCode({ store, email: 'jean@farm.rw', now: AT });

  const first = await verifyLoginCode({ store, challengeId, code, now: AT });
  assert.equal(first.ok, true);
  assert.equal(first.email, 'jean@farm.rw');

  const second = await verifyLoginCode({ store, challengeId, code, now: AT });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'used', 'a code must never be replayable');
});

test('a code minted for one challenge cannot be spent on another', async () => {
  const store = await freshStore();
  const a = await issueLoginCode({ store, email: 'jean@farm.rw', now: AT });
  const b = await issueLoginCode({ store, email: 'ops@afriinnox.com', now: AT });

  // the right digits, the wrong challenge
  const crossed = await verifyLoginCode({ store, challengeId: b.challengeId, code: a.code, now: AT });
  assert.equal(crossed.ok, false);
  assert.equal(crossed.reason, 'wrong');

  // and the challenge it WAS minted for still works
  const own = await verifyLoginCode({ store, challengeId: a.challengeId, code: a.code, now: AT });
  assert.equal(own.ok, true);
});

test('an expired code is refused however right it is', async () => {
  const store = await freshStore();
  const { challengeId, code } = await issueLoginCode({ store, email: 'jean@farm.rw', now: AT, ttlMinutes: 10 });
  const out = await verifyLoginCode({ store, challengeId, code, now: LATER });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'expired');
});

test('every wrong code costs an attempt, and then the challenge is dead', async () => {
  const store = await freshStore();
  const { challengeId, code } = await issueLoginCode({ store, email: 'jean@farm.rw', now: AT });
  const wrong = code === '000000' ? '111111' : '000000';

  for (let i = 1; i <= LOGIN_CODE_MAX_ATTEMPTS; i += 1) {
    const out = await verifyLoginCode({ store, challengeId, code: wrong, now: AT });
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'wrong');
    assert.equal(out.attemptsRemaining, LOGIN_CODE_MAX_ATTEMPTS - i);
  }

  // even the correct code cannot revive a challenge that was guessed at
  const spent = await verifyLoginCode({ store, challengeId, code, now: AT });
  assert.equal(spent.ok, false);
  assert.equal(spent.reason, 'too-many-attempts');
});

test('an unknown challenge and an empty attempt are refused without detail', async () => {
  const store = await freshStore();
  for (const attempt of [
    { challengeId: 'nope', code: '123456' },
    { challengeId: 'nope', code: '' },
    { challengeId: '', code: '123456' },
    { challengeId: null, code: null },
  ]) {
    const out = await verifyLoginCode({ store, ...attempt, now: AT });
    assert.equal(out.ok, false);
    assert.ok(['unknown', 'used', 'wrong'].includes(out.reason), `unexpected reason ${out.reason}`);
    assert.equal(out.email, undefined, 'a refusal must never name an account');
  }
});

test('a fresh code is different every time', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) seen.add(newLoginCode());
  assert.ok(seen.size > 190, `codes should not repeat across 200 draws, saw ${seen.size} distinct`);
  for (const c of seen) assert.match(c, /^\d{6}$/);
});

/* ------------------------------------------------------------------ */
/* 4. credentials in the store                                         */
/* ------------------------------------------------------------------ */

test('a credential round-trips, keyed by a normalised email', async () => {
  const store = await freshStore();
  assert.equal(await store.getCredentialByEmail('jean@farm.rw'), null, 'no password until one is set');

  const hash = await hashPassword('Correct-Horse-9');
  await store.upsertCredential({ email: ' Jean@Farm.RW ', passwordHash: hash, contactId: 'c1' });

  const found = await store.getCredentialByEmail('jean@farm.rw');
  assert.equal(found.email, 'jean@farm.rw');
  assert.equal(found.contact_id, 'c1');
  assert.equal(await verifyPassword('Correct-Horse-9', found.password_hash), true);

  // setting it again replaces the hash and keeps the contact
  const second = await hashPassword('Another-Pass-7');
  await store.upsertCredential({ email: 'jean@farm.rw', passwordHash: second });
  const after = await store.getCredentialByEmail('jean@farm.rw');
  assert.equal(after.contact_id, 'c1', 'the contact survives a password change');
  assert.equal(await verifyPassword('Correct-Horse-9', after.password_hash), false, 'the old password stops working');
  assert.equal(await verifyPassword('Another-Pass-7', after.password_hash), true);
});
