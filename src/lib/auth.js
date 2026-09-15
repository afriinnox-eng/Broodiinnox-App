/**
 * Sign-in against broodiinnox-api — the whole of it, as the screen needs it.
 *
 *   login            step one: identifier + password -> a code is emailed
 *   verifyCode       step two: the six digits -> who it was
 *   forgotPassword   the "Forgot password?" request (always the same answer)
 *   resetPassword    what the emailed link leads to: a new password
 *
 * Three deliberate properties:
 *
 *   1. NOTHING HERE THROWS. Every call resolves to a tagged outcome —
 *      `code-sent`, `verified`, `refused`, `unavailable` — so the screen never
 *      has to know what HTTP is, and a dead server cannot leave a spinner
 *      spinning. A fetch that rejects is `unavailable`, not an exception.
 *   2. IT NEVER DECIDES WHO IS RIGHT. This module does not compare codes, check
 *      passwords or look anything up against the seed; the server does that and
 *      this only carries what the person typed. A client that "checks" a code
 *      locally is a client that can be told it passed.
 *   3. WITH NO API CONFIGURED IT IS `null`, not a client that fails when called.
 *      The sign-in screen branches on that and keeps its previous way in, so an
 *      app built without VITE_IOT_API_URL still signs people in.
 *
 * Honest limit, stated here because it is a property of the app rather than of
 * this file: the API establishes "knows the password" and "controls the
 * mailbox", but who someone IS still comes from the app's own registered
 * records, and the dashboard's other calls still go out under the shared API
 * key. Accounts move server-side — with it, authorization — before that limit
 * closes.
 */
import { resolveIotConfig } from './iot.js';

/** Digits in a login code. Mirrors broodiinnox-api's LOGIN_CODE_LENGTH. */
export const CODE_LENGTH = 6;

/** Shortest password the API will record. Mirrors MIN_PASSWORD_LENGTH. */
export const MIN_PASSWORD_LENGTH = 8;

/* ------------------------------------------------------------------ */
/* What someone typed                                                  */
/* ------------------------------------------------------------------ */

/**
 * The canonical digits of a phone number — country code and trunk zero removed
 * — so every way a Rwandan number gets written collapses to one string:
 *
 *   0788123456 · 0788 123 456 · 0788-123-456 · +250788123456  ->  788123456
 *
 * Byte-for-byte the same rule as `phoneKey` in broodiinnox-api/lib/credentials.js.
 * It has to be: this is what decides whether the number a farmer types is the
 * number they were registered with.
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
 * Returns `{ kind: 'email' | 'phone' | 'none', value }`.
 */
export function normalizeIdentifier(raw) {
  const typed = typeof raw === 'string' ? raw.trim() : '';
  if (!typed) return { kind: 'none', value: '' };
  if (typed.includes('@')) return { kind: 'email', value: typed.toLowerCase() };
  const digits = phoneKey(typed);
  return { kind: digits ? 'phone' : 'none', value: digits };
}

/**
 * Is this a well-formed code? Spaces are tolerated because people paste codes
 * with them, anything else is not: `{ ok, value }` with the digits, or the
 * reason it is not one.
 */
export function validateCode(raw) {
  const typed = typeof raw === 'string' ? raw.replace(/\s/g, '') : '';
  if (!typed) return { ok: false, reason: 'empty', value: '' };
  if (!/^\d+$/.test(typed)) return { ok: false, reason: 'not-digits', value: '' };
  if (typed.length !== CODE_LENGTH) return { ok: false, reason: 'wrong-length', value: '' };
  return { ok: true, reason: null, value: typed };
}

/**
 * `jean@farm.rw` -> `j•••@farm.rw`: enough to recognise which mailbox the code
 * went to, not enough to hand out an address. Mirrors the API's `maskEmail`, so
 * the screen says the same thing whether the mask came from here or from there.
 */
export function maskEmail(address) {
  const [name, domain] = String(address || '').split('@');
  if (!domain) return '•••';
  const head = name.slice(0, 1);
  return `${head}${'•'.repeat(Math.max(1, Math.min(4, name.length - 1)))}@${domain}`;
}

/* ------------------------------------------------------------------ */
/* The emailed link                                                    */
/* ------------------------------------------------------------------ */

/** Marks the route the reset link points at. */
export const RESET_ROUTE = '/reset-password';

/**
 * The reset token out of a URL, or `null`.
 *
 * This SPA is hash-routed — a static host serves only `/` — so the link the API
 * emails is `{app}/#/reset-password?token=…` and the token lives INSIDE the
 * fragment, where a server never sees it and a plain `location.search` never
 * finds it. It is read here from either shape (a bare `#/…` fragment or a whole
 * href) so the screen cannot get this subtly wrong, and it refuses to hand back
 * a token from a different route — a stray `?token=` on the sign-in page is not
 * a reset.
 */
export function resetTokenFromHash(url) {
  const raw = String(url ?? '');
  const hashAt = raw.indexOf('#');
  const fragment = hashAt === -1 ? raw : raw.slice(hashAt + 1);
  const queryAt = fragment.indexOf('?');
  if (queryAt === -1) return null;

  const path = fragment.slice(0, queryAt).replace(/\/+$/, '');
  if (path !== RESET_ROUTE) return null;

  const params = new URLSearchParams(fragment.slice(queryAt + 1));
  const token = (params.get('token') || '').trim();
  return token || null;
}

/* ------------------------------------------------------------------ */
/* Who the server says they are                                        */
/* ------------------------------------------------------------------ */

/**
 * Turn the account the API verified into the session this app runs on.
 *
 * The dashboard's pages read their data from the app's own records, so an
 * account the server knows is matched back to the registered farmer or admin it
 * belongs to, by email first and then by phone — and that record decides the
 * shell, exactly as it does today. A verified account with no local record gets
 * a minimal session rather than nothing, so it is visible that verification
 * worked and the account is only half-provisioned.
 *
 * The role is never taken from the client's own record when the server has
 * spoken: a contact the server calls a farmer cannot arrive as an admin.
 */
export function sessionFromAccount(account, { farmers = [], admins = [] } = {}) {
  const a = account && typeof account === 'object' ? account : null;
  if (!a) return null;

  const email = String(a.email || '').toLowerCase();
  const phone = phoneKey(a.phone);
  const byEmail = (list) => list.find((p) => email && String(p.email || '').toLowerCase() === email);
  const local = byEmail(farmers) || (phone ? farmers.find((f) => phoneKey(f.phone) === phone) : null)
    || byEmail(admins) || (phone ? admins.find((x) => phoneKey(x.phone) === phone) : null);

  const serverRole = a.role === 'admin' || a.role === 'super' ? 'admin' : 'farmer';
  if (local) {
    // A farmer the server verified must not be handed the console, whatever the
    // local list happens to say.
    const role = serverRole === 'farmer' ? 'farmer' : local.role === 'admin' || local.role === 'super' || local.adminRole ? 'admin' : 'farmer';
    return { ...local, role, ...(role === 'admin' && !local.adminRole && a.role ? { adminRole: a.role } : {}) };
  }

  return {
    id: a.contactId || a.farmerId || a.email || a.phone || null,
    name: a.name || a.email || a.phone || 'Account',
    role: serverRole,
    ...(serverRole === 'admin' ? { adminRole: a.role || 'support' } : {}),
    ...(a.email ? { email: a.email } : {}),
    ...(a.phone ? { phone: a.phone } : {}),
    // flagged so the UI can say the account exists on the server but has no
    // records in this app yet, instead of rendering empty pages silently
    unprovisioned: true,
  };
}

/* ------------------------------------------------------------------ */
/* The client                                                          */
/* ------------------------------------------------------------------ */

/**
 * A client for the four auth routes, or `null` when no API is configured.
 * Every method resolves to `{ kind, ... }` — see the kinds on each one — and
 * never rejects.
 */
export function createAuthApi({ baseUrl, apiKey = '', timeoutMs = 8000, fetchImpl } = {}) {
  if (!/^https?:\/\/[^/]+/.test(String(baseUrl || ''))) {
    throw new Error('auth API is not configured (set VITE_IOT_API_URL)');
  }
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('no fetch implementation available');

  /** One request. Resolves `{ status, data }`, or `{ status: 0, failure }` if it never arrived. */
  async function call(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(apiKey ? { 'x-api-key': apiKey } : {}) },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      let data = null;
      if (text) { try { data = JSON.parse(text); } catch { data = { error: text }; } }
      return { status: res.status, data: data && typeof data === 'object' ? data : {} };
    } catch (err) { clearTimeout(timer); return { status: 0, failure: err?.name === 'AbortError' ? 'timeout' : 'network' }; }
    finally { clearTimeout(timer); }
  }

  const message = (data, fallback) => (typeof data?.error === 'string' && data.error) || fallback;

  return {
    baseUrl,
    timeoutMs,

    /**
     * Step one. `{ identifier, password }`.
     *   code-sent    202 — a code is on its way to `sentTo`, send it back with
     *                     `challengeId`
     *   refused      401 — the identifier and password do not match, and the
     *                     answer is identical whether or not the account exists
     *   unavailable  503 (mail is not configured) or the server was not reached
     *   invalid      400 — nothing to work with
     */
    async login({ identifier, password } = {}) {
      const out = await call('/api/auth/login', { identifier: String(identifier ?? ''), password: String(password ?? '') });
      if (out.status === 202 && out.data.challengeId) {
        return {
          kind: 'code-sent',
          challengeId: out.data.challengeId,
          sentTo: out.data.sentTo || '',
          expiresMinutes: Number(out.data.expiresMinutes) || 10,
        };
      }
      if (out.status === 401) return { kind: 'refused', message: message(out.data, 'That identifier and password do not match.') };
      if (out.status === 503) {
        return { kind: 'unavailable', reason: out.data.reason || 'mail-not-configured', message: message(out.data, 'The server cannot send email right now.') };
      }
      if (out.status === 400) return { kind: 'invalid', message: message(out.data, 'An identifier and a password are required.') };
      if (!out.status) return { kind: 'unavailable', reason: out.failure, message: 'The server could not be reached.' };
      return { kind: 'unavailable', reason: `http-${out.status}`, message: message(out.data, `HTTP ${out.status}`) };
    },

    /**
     * Step two. `{ challengeId, code }`.
     *   verified     200 — `account` is who the server says it is
     *   refused      400 — wrong, expired, used or out of attempts; `reason`
     *                      says which (the copy is the caller's job)
     *   unavailable  the server was not reached
     */
    async verifyCode({ challengeId, code } = {}) {
      const out = await call('/api/auth/verify', { challengeId: String(challengeId ?? ''), code: String(code ?? '') });
      if (out.status === 200 && out.data.verified) return { kind: 'verified', account: out.data.account || null, email: out.data.email || null };
      if (out.status === 400) {
        return {
          kind: 'refused',
          reason: out.data.reason || 'wrong',
          attemptsLeft: Number.isFinite(Number(out.data.attemptsLeft)) ? Number(out.data.attemptsLeft) : null,
          message: message(out.data, 'That code is not correct.'),
        };
      }
      if (!out.status) return { kind: 'unavailable', reason: out.failure, message: 'The server could not be reached.' };
      return { kind: 'unavailable', reason: `http-${out.status}`, message: message(out.data, `HTTP ${out.status}`) };
    },

    /**
     * The "Forgot password?" request. `{ identifier }` — an email or a phone
     * number; the server resolves a phone to the mailbox registered against it.
     *
     * `sent` means the request was accepted, NOT that an account exists: the
     * server answers identically either way, on purpose, so this cannot be used
     * to discover which addresses are registered. The copy must not imply more.
     */
    async forgotPassword({ identifier } = {}) {
      const out = await call('/api/auth/forgot', { identifier: String(identifier ?? '') });
      if (out.status === 202) return { kind: 'sent', notice: out.data.notice || '' };
      if (out.status === 400) return { kind: 'invalid', message: message(out.data, 'An email address is required.') };
      if (!out.status) return { kind: 'unavailable', reason: out.failure, message: 'The server could not be reached.' };
      return { kind: 'unavailable', reason: `http-${out.status}`, message: message(out.data, `HTTP ${out.status}`) };
    },

    /**
     * What the emailed link leads to. `{ token, password }`.
     *   stored    200 — the password is recorded; the link is now spent
     *   refused   400 — `reason` is one of `invalid-password | unknown |
     *                    expired | used`, so the screen can say which
     */
    async resetPassword({ token, password } = {}) {
      const out = await call('/api/auth/password-reset/redeem', { token: String(token ?? ''), password: String(password ?? '') });
      if (out.status === 200) return { kind: 'stored', email: out.data.email || null };
      if (out.status === 400) return { kind: 'refused', reason: out.data.reason || 'unknown', message: message(out.data, 'This reset link is not valid.') };
      if (!out.status) return { kind: 'unavailable', reason: out.failure, message: 'The server could not be reached.' };
      return { kind: 'unavailable', reason: `http-${out.status}`, message: message(out.data, `HTTP ${out.status}`) };
    },
  };
}

/** The configured client, or `null` — the sign-in screen's switch. `env` is injectable for tests. */
export function authApiFor(env, fetchImpl) {
  const cfg = resolveIotConfig(env);
  if (!cfg.enabled) return null;
  return createAuthApi({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, timeoutMs: cfg.timeoutMs, fetchImpl });
}
