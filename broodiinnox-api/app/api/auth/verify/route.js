import { badRequest, json, options } from '../../../../lib/http.js';
import { ensureReady } from '../../../../lib/server.js';
import { verifyLoginCode } from '../../../../lib/credentials.js';

/**
 * POST /api/auth/verify
 * Body: { challengeId, code }
 *
 * Step two of signing in: the digits that were just emailed, against the
 * challenge the login step handed back. Nothing else is accepted — no
 * identifier, because the challenge already knows which address it was minted
 * for, and letting the caller restate it would only create a way to point one
 * account's code at another account.
 *
 * A correct code is spent here, once, atomically. A wrong one burns an attempt
 * and the answer says how many are left; after the limit the challenge is dead
 * and a fresh sign-in is needed. Expired, used, unknown and wrong all come back
 * as a plain 400, so a caller cannot learn anything about a challenge they do
 * not hold.
 *
 * WHAT THIS DOES NOT DO — and it matters: it does not mint a session, and this
 * API has no per-user tokens. It answers "this person knows the password and
 * controls the mailbox the account was registered with", and hands back who
 * that was. The dashboard keeps its own session, exactly as it does today, so
 * a verified sign-in still does not authorise API calls per user. That is the
 * next phase, and it needs accounts to be the source of truth first.
 *
 * 200 verified · 400 refused · 503 no store
 */
export async function POST(request) {
  const { store } = await ensureReady();

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('Body must be JSON: { challengeId, code }');
  }

  const out = await verifyLoginCode({
    store,
    challengeId: body?.challengeId ?? body?.challenge_id,
    code: body?.code,
  });

  if (!out.ok) {
    return json({
      error: out.error || 'That code is not valid.',
      reason: out.reason,
      attemptsRemaining: out.attemptsRemaining,
    }, out.reason === 'no-store' ? 503 : 400);
  }

  const contact = await store.getContactByEmail(out.email);
  return json({
    verified: true,
    email: out.email,
    account: {
      contactId: out.contactId || contact?.id || null,
      name: contact?.name || '',
      role: contact?.role || 'farmer',
      farmerId: contact?.farmer_id || null,
      email: out.email,
      phone: contact?.phone || null,
    },
    session: null,
    notice: 'Sign-in verified. This API issues no per-user session yet, so the dashboard still '
      + 'keeps its own session — see the README.',
  });
}

export async function OPTIONS() {
  return options();
}
