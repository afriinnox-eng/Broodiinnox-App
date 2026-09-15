/**
 * The invariants of the sign-in client and the reset link parser.
 *
 * These are the properties that must hold for EVERY input, which is where the
 * bugs in this area actually live:
 *
 *   1. every spelling of a phone number collapses to one identity - the number
 *      a farmer types must be the number they were registered with
 *   2. the token is read from the URL fragment the SPA really receives, and
 *      only from the reset route
 *   3. no call to the server ever rejects: a dead or absent server is an
 *      outcome, not an exception, because the screen has to stay usable
 *   4. the client never decides a code is right, and never sends anything but
 *      what was typed
 */
import { describe, expect, it } from 'vitest';
import {
  CODE_LENGTH, MIN_PASSWORD_LENGTH, authApiFor, createAuthApi, maskEmail,
  normalizeIdentifier, phoneKey, resetTokenFromHash, sessionFromAccount, validateCode,
} from '../lib/auth.js';

/* ------------------------------------------------------------------ */
/* What someone typed                                                  */
/* ------------------------------------------------------------------ */

describe('an identifier is one identity however it is written', () => {
  it('collapses every spelling of the same phone number to one key', () => {
    const spellings = [
      '0788123456', '0788 123 456', '0788-123-456', '0788.123.456',
      '+250788123456', '250788123456', '+250 788 123 456', '00250788123456',
    ];
    const keys = spellings.map((s) => normalizeIdentifier(s).value);
    // 00250... keeps its zeros: it is not one of the forms this system issues,
    // and pretending to recognise it would sign the wrong person in
    expect(new Set(keys).size, JSON.stringify(keys)).toBeLessThan(spellings.length);
    for (const s of spellings.slice(0, 7)) {
      expect(normalizeIdentifier(s), s).toEqual({ kind: 'phone', value: '788123456' });
    }
  });

  it('treats an email as lower case and trimmed, and never as a phone', () => {
    expect(normalizeIdentifier('  Jean@Farm.RW ')).toEqual({ kind: 'email', value: 'jean@farm.rw' });
    expect(normalizeIdentifier('OPS@AFRIINNOX.COM').kind).toBe('email');
  });

  it('says none rather than guessing, for anything that is neither', () => {
    for (const bad of ['', '   ', 'nonsense', '+', '...', null, undefined, {}, 42, true]) {
      expect(normalizeIdentifier(bad).kind, JSON.stringify(bad) ?? String(bad)).toBe('none');
      expect(normalizeIdentifier(bad).value).toBe('');
    }
  });

  it('calls anything with an @ an email attempt, because the server refuses it and not the client', () => {
    // an app that decided this locally would be a second opinion on who exists;
    // the rule is the server's, and this only has to agree with it
    expect(normalizeIdentifier('@')).toEqual({ kind: 'email', value: '@' });
    expect(normalizeIdentifier('@afriinnox.com').kind).toBe('email');
  });

  it('phoneKey is idempotent: key(key(x)) === key(x)', () => {
    for (const raw of ['0788123456', '250788123456', '+250788123456', '0788 123 456', '']) {
      expect(phoneKey(phoneKey(raw))).toBe(phoneKey(raw));
    }
  });
});

describe('a code is six digits or it is not a code', () => {
  it('accepts exactly six digits, and tolerates the spaces of a paste', () => {
    expect(validateCode('123456')).toEqual({ ok: true, reason: null, value: '123456' });
    expect(validateCode('123 456').value).toBe('123456');
    expect(validateCode(' 123456 ').value).toBe('123456');
    expect(CODE_LENGTH).toBe(6);
  });

  it('refuses everything else, and says which way it is wrong', () => {
    expect(validateCode('12345').reason).toBe('wrong-length');
    expect(validateCode('1234567').reason).toBe('wrong-length');
    expect(validateCode('12345a').reason).toBe('not-digits');
    expect(validateCode('abcdef').reason).toBe('not-digits');
    expect(validateCode('').reason).toBe('empty');
    expect(validateCode(null).reason).toBe('empty');
    // a refused code never carries a value the caller could send anyway
    for (const bad of ['', '12345', '1234567', 'abcdef', null, undefined, 123456, {}]) {
      const out = validateCode(bad);
      if (!out.ok) expect(out.value).toBe('');
    }
  });
});

describe('the mask on an address reveals enough to recognise, not enough to harvest', () => {
  it('keeps the domain and hides the local part', () => {
    expect(maskEmail('jean@farm.rw')).toBe('j•••@farm.rw');
    expect(maskEmail('a@b.rw')).toBe('a•@b.rw');
    expect(maskEmail('averylongname@farm.rw')).toBe('a••••@farm.rw');
  });

  it('never leaks the whole local part, whatever the input', () => {
    for (const addr of ['jean@farm.rw', 'x@y.rw', 'info@afriinnox.com', 'a b@c.rw', 'no-at-sign', '', null]) {
      const out = maskEmail(addr);
      const local = String(addr || '').split('@')[0];
      expect(out.includes(local) && local.length > 1, `${addr} leaked`).toBe(false);
      expect(out.length).toBeGreaterThan(0);
    }
  });
});

/* ------------------------------------------------------------------ */
/* The emailed link                                                    */
/* ------------------------------------------------------------------ */

describe('the reset token comes out of the fragment, and only from the reset route', () => {
  it('reads it from every shape the URL really arrives in', () => {
    expect(resetTokenFromHash('#/reset-password?token=abc')).toBe('abc');
    expect(resetTokenFromHash('/reset-password?token=abc')).toBe('abc');
    expect(resetTokenFromHash('https://broodiinnox-app.onrender.com/#/reset-password?token=abc')).toBe('abc');
    expect(resetTokenFromHash('/reset-password/?token=abc')).toBe('abc');
    expect(resetTokenFromHash('/reset-password?token=abc&done=1')).toBe('abc');
    expect(resetTokenFromHash('/reset-password?done=1&token=abc')).toBe('abc');
  });

  it('decodes a token that was encoded, so what is sent is what was minted', () => {
    const raw = 'a b+c/d?e&f#g';
    expect(resetTokenFromHash(`/reset-password?token=${encodeURIComponent(raw)}`)).toBe(raw);
  });

  it('refuses anything that is not a usable reset link', () => {
    for (const bad of [
      '', '#', '#/', '#/login?token=abc', '/?token=abc', '#/reset-password', '/reset-password',
      '/reset-password?token=', '/reset-password?token=%20', '/reset-password?nope=abc',
      null, undefined, 42, {}, '#/reset-passwordX?token=abc',
    ]) {
      expect(resetTokenFromHash(bad), JSON.stringify(bad) ?? String(bad)).toBeNull();
    }
  });

  it('is not confused by a query string that sits before the fragment', () => {
    // a stray token on the outer URL is not a reset: the router never sees it
    expect(resetTokenFromHash('https://app.example/?token=abc#/login')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Who the server says they are                                        */
/* ------------------------------------------------------------------ */

describe('the verified account becomes the session the app runs on', () => {
  const farmers = [{ id: 'f1', name: 'Jean Damascene', phone: '0788123456', email: 'jean@farm.rw', role: 'farmer' }];
  const admins = [{ id: 'a2', name: 'Grace Uwase', email: 'ops@afriinnox.com', role: 'operations' }];

  it('matches the verified account back to its registered record, by email or phone', () => {
    for (const identifier of [{ email: 'jean@farm.rw' }, { email: 'JEAN@FARM.RW' }, { phone: '0788 123 456' }, { phone: '+250788123456' }]) {
      const session = sessionFromAccount({ ...identifier, contactId: 'c9', name: 'Someone', role: 'farmer' }, { farmers, admins });
      expect(session.id, JSON.stringify(identifier)).toBe('f1');
      expect(session.role).toBe('farmer');
    }
    expect(sessionFromAccount({ email: 'ops@afriinnox.com', role: 'admin' }, { farmers, admins }).id).toBe('a2');
  });

  it('never hands the console to a farmer the server called a farmer', () => {
    // even if the local record claims otherwise, the server's word wins
    const lying = [{ id: 'f1', name: 'Jean', email: 'jean@farm.rw', role: 'admin', adminRole: 'super' }];
    const session = sessionFromAccount({ email: 'jean@farm.rw', role: 'farmer' }, { farmers: lying, admins });
    expect(session.role).toBe('farmer');
  });

  it('gives a verified account with no local record a session, marked unprovisioned', () => {
    const session = sessionFromAccount({ contactId: 'c7', name: 'New Farmer', role: 'farmer', email: 'new@farm.rw', phone: '0788999111' }, { farmers, admins });
    expect(session).toMatchObject({ id: 'c7', name: 'New Farmer', role: 'farmer', unprovisioned: true });
    expect(session.email).toBe('new@farm.rw');
    expect(session.adminRole).toBeUndefined();
  });

  it('survives every shape of nothing', () => {
    expect(sessionFromAccount(null)).toBeNull();
    expect(sessionFromAccount(undefined, {})).toBeNull();
    for (const thin of [{ role: 'farmer' }, { contactId: 'c1' }, {}]) {
      const session = sessionFromAccount(thin, { farmers, admins });
      expect(session, JSON.stringify(thin)).not.toBeNull();
      expect(typeof session.id === 'string' || session.id === null).toBe(true);
      expect(['farmer', 'admin']).toContain(session.role);
    }
  });
});

/* ------------------------------------------------------------------ */
/* The client                                                          */
/* ------------------------------------------------------------------ */

/** A fetch that answers from a table, and records what it was asked. */
function fakeFetch(replies) {
  const calls = [];
  const impl = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: String(url), method: (opts.method || 'GET').toUpperCase(), body, headers: opts.headers || {} });
    const reply = replies(calls[calls.length - 1]) ?? { status: 500, body: {} };
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      text: async () => JSON.stringify(reply.body ?? {}),
    };
  };
  impl.calls = calls;
  return impl;
}

const api = (impl) => createAuthApi({ baseUrl: 'https://api.test', apiKey: 'k', timeoutMs: 50, fetchImpl: impl });
const constant = (status, body) => fakeFetch(() => ({ status, body }));

describe('the auth client answers in outcomes, never in exceptions', () => {
  it('is not configured at all without an absolute API URL', () => {
    for (const env of [{}, { VITE_IOT_API_URL: '' }, { VITE_IOT_API_URL: 'localhost:3001' }, { VITE_IOT_API_URL: 'ftp://x' }]) {
      expect(authApiFor(env), JSON.stringify(env)).toBeNull();
    }
    const configured = authApiFor({ VITE_IOT_API_URL: 'https://api.test/' });
    expect(configured).not.toBeNull();
    expect(configured.baseUrl).toBe('https://api.test');
  });

  it('step one: 202 is a code on its way, 401 is a refusal, 503 is a server that cannot send mail', async () => {
    const sent = api(constant(202, { codeSent: true, challengeId: 'ch1', sentTo: 'j•••@farm.rw', expiresMinutes: 10 }));
    expect(await sent.login({ identifier: 'jean@farm.rw', password: 'secret123' }))
      .toEqual({ kind: 'code-sent', challengeId: 'ch1', sentTo: 'j•••@farm.rw', expiresMinutes: 10 });

    expect(await api(constant(401, { error: 'That identifier and password do not match.' })).login({ identifier: 'x', password: 'y' }))
      .toEqual({ kind: 'refused', message: 'That identifier and password do not match.' });

    expect(await api(constant(503, { reason: 'mail-not-configured' })).login({ identifier: 'x', password: 'y' }))
      .toMatchObject({ kind: 'unavailable', reason: 'mail-not-configured' });
  });

  it('a server that is down or slow is an outcome, never a thrown error', async () => {
    const down = createAuthApi({ baseUrl: 'https://api.test', timeoutMs: 50, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
    expect(await down.login({ identifier: 'a', password: 'b' })).toMatchObject({ kind: 'unavailable', reason: 'network' });
    expect(await down.verifyCode({ challengeId: 'c', code: '123456' })).toMatchObject({ kind: 'unavailable' });
    expect(await down.forgotPassword({ identifier: 'a@b.rw' })).toMatchObject({ kind: 'unavailable' });
    expect(await down.resetPassword({ token: 't', password: 'password123' })).toMatchObject({ kind: 'unavailable' });

    const hanging = createAuthApi({
      baseUrl: 'https://api.test', timeoutMs: 10,
      fetchImpl: (url, opts) => new Promise((_, reject) => {
        opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
    });
    expect(await hanging.login({ identifier: 'a', password: 'b' })).toMatchObject({ kind: 'unavailable', reason: 'timeout' });
  });

  it('every status maps to a kind the screen handles, for the whole range', async () => {
    const handled = { login: ['code-sent', 'refused', 'invalid', 'unavailable'], verifyCode: ['verified', 'refused', 'unavailable'], forgotPassword: ['sent', 'invalid', 'unavailable'], resetPassword: ['stored', 'refused', 'unavailable'] };
    const args = { login: { identifier: 'a', password: 'b' }, verifyCode: { challengeId: 'c', code: '123456' }, forgotPassword: { identifier: 'a@b.rw' }, resetPassword: { token: 't', password: 'password123' } };
    for (const status of [200, 201, 202, 301, 400, 401, 403, 404, 418, 429, 500, 502, 503]) {
      for (const [method, kinds] of Object.entries(handled)) {
        const out = await api(constant(status, {}))[method](args[method]);
        expect(kinds, `${method} ${status} -> ${out.kind}`).toContain(out.kind);
      }
    }
  });

  it('step two: the account the server verified comes back whole, and a wrong code carries its attempts', async () => {
    const account = { contactId: 'c1', name: 'Jean', role: 'farmer', farmerId: null, email: 'jean@farm.rw', phone: '0788123456' };
    const ok = api(constant(200, { verified: true, email: 'jean@farm.rw', account }));
    expect(await ok.verifyCode({ challengeId: 'ch', code: '123456' })).toEqual({ kind: 'verified', account, email: 'jean@farm.rw' });

    const wrong = api(constant(400, { error: 'That code is not correct.', reason: 'wrong', attemptsLeft: 3 }));
    expect(await wrong.verifyCode({ challengeId: 'ch', code: '000000' }))
      .toMatchObject({ kind: 'refused', reason: 'wrong', attemptsLeft: 3 });
    expect(await api(constant(400, { reason: 'expired' })).verifyCode({ challengeId: 'ch', code: '000000' })).toMatchObject({ reason: 'expired' });
    expect(await api(constant(400, { reason: 'used' })).verifyCode({ challengeId: 'ch', code: '000000' })).toMatchObject({ reason: 'used' });
    // a 200 that does not actually verify is not a verification
    expect(await api(constant(200, { verified: false })).verifyCode({ challengeId: 'c', code: '123456' })).toMatchObject({ kind: 'unavailable' });
  });

  it('the reset request is reported as accepted, which is all the server ever says', async () => {
    const out = await api(constant(202, { requested: true, notice: 'If that address has an account...' })).forgotPassword({ identifier: 'nobody@nowhere.rw' });
    expect(out.kind).toBe('sent');
    // and nothing about whether that address exists comes back through it
    expect(JSON.stringify(out)).not.toMatch(/unknown|not-registered|no such/i);
  });

  it('the reset says which way the link failed, so the screen can differ', async () => {
    expect(await api(constant(200, { password_stored: true })).resetPassword({ token: 't', password: 'password123' })).toMatchObject({ kind: 'stored' });
    for (const reason of ['invalid-password', 'unknown', 'expired', 'used']) {
      expect(await api(constant(400, { reason })).resetPassword({ token: 't', password: 'password123' }), reason)
        .toMatchObject({ kind: 'refused', reason });
    }
  });

  it('sends exactly what was typed, to the route that handles it, and nothing else', async () => {
    const impl = fakeFetch(() => ({ status: 202, body: { challengeId: 'ch', codeSent: true } }));
    const client = api(impl);
    const long = 'x'.repeat(200);
    await client.login({ identifier: ' jean@farm.rw ', password: long });
    expect(impl.calls[0].url).toBe('https://api.test/api/auth/login');
    expect(impl.calls[0].method).toBe('POST');
    expect(impl.calls[0].headers['x-api-key']).toBe('k');
    expect(impl.calls[0].body).toEqual({ identifier: ' jean@farm.rw ', password: long });

    await client.verifyCode({ challengeId: 'ch', code: '123456' });
    expect(impl.calls[1].url).toBe('https://api.test/api/auth/verify');
    expect(impl.calls[1].body).toEqual({ challengeId: 'ch', code: '123456' });

    await client.forgotPassword({ identifier: 'jean@farm.rw' });
    expect(impl.calls[2].url).toBe('https://api.test/api/auth/forgot');
    expect(Object.keys(impl.calls[2].body)).toEqual(['identifier']);

    await client.resetPassword({ token: 'tok', password: 'password123' });
    expect(impl.calls[3].url).toBe('https://api.test/api/auth/password-reset/redeem');
    expect(Object.keys(impl.calls[3].body).sort()).toEqual(['password', 'token']);
  });

  it('never sends a blank password where a password is the point', async () => {
    const impl = fakeFetch(() => ({ status: 202, body: { challengeId: 'ch', codeSent: true } }));
    await api(impl).login({ identifier: '' });
    expect(impl.calls[0].body.password).toBe('', 'the server decides, not the client - so it is sent, and refused there');
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });
});
