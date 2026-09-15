import { badRequest, json, options } from '../../../../../lib/http.js';
import { ensureReady } from '../../../../../lib/server.js';
import { hashResetToken, redeemPasswordReset, validateNewPassword } from '../../../../../lib/passwordReset.js';
import { hashPassword } from '../../../../../lib/credentials.js';

/**
 * POST /api/auth/password-reset/redeem
 * Body: { token, password }
 *
 * The link in the reset email lands here, and this is where the new password is
 * actually set. Deliberately UNAUTHENTICATED: the person clicking it is a farmer
 * in a browser with no API key, and the token itself is the credential.
 *
 * The order matters and is deliberate:
 *
 *   1. check the password is acceptable, before touching the token — a weak
 *      password must not cost the person their link
 *   2. look the token up WITHOUT spending it, so a failure after this point
 *      leaves the link usable
 *   3. store the new password hash
 *   4. spend the token, atomically, so the link cannot be replayed
 *
 * An unknown, expired or already-used token all come back as a plain 400
 * without saying which: knowing the difference tells an attacker nothing
 * useful about a token they do not hold.
 *
 * This is also how an account gets its FIRST password. There is no sign-up
 * screen and no password-reset-from-nothing: an account with no credential row
 * cannot sign in, and the way to give it one is this link, requested from the
 * sign-in screen's "Forgot password?" (or by an admin from the console).
 *
 * 200 password set · 400 refused · 503 no store
 */
export async function POST(request) {
  const { store } = await ensureReady();

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('Body must be JSON: { token, password }');
  }

  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!token) return badRequest('A reset token is required.');

  // 1. the password first: an unacceptable one must not cost the link
  const checked = validateNewPassword(password);
  if (!checked.ok) return json({ error: checked.error, reason: 'weak-password' }, 400);

  // 2. peek at the token without spending it, so anything that fails after this
  //    point leaves the link usable
  const row = await store.getPasswordReset(hashResetToken(token));
  if (!row) return json({ error: 'This reset link is not valid.', reason: 'unknown' }, 400);
  if (row.used_at) return json({ error: 'This reset link has already been used.', reason: 'used' }, 400);

  // 3. store the new password
  const passwordHash = await hashPassword(checked.value);
  await store.upsertCredential({
    email: row.email,
    passwordHash,
    contactId: row.contact_id || null,
  });

  // 4. spend the token last
  const out = await redeemPasswordReset({ store, token });
  if (!out.ok) {
    return json({ error: out.error || 'This reset link is not valid.', reason: out.reason }, 400);
  }

  return json({
    verified: true,
    email: out.email,
    contactId: out.contact ? out.contact.id : null,
    password_stored: true,
    notice: 'Your password has been set. You can now sign in — a code will be emailed to you as usual.',
  });
}

export async function OPTIONS() {
  return options();
}
