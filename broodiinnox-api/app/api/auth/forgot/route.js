import { badRequest, json, options } from '../../../../lib/http.js';
import { ensureReady, getMailer } from '../../../../lib/server.js';
import { normalizeIdentifier } from '../../../../lib/credentials.js';
import { requestPasswordReset } from '../../../../lib/passwordReset.js';
import { emailForPhone } from '../login/route.js';

/**
 * POST /api/auth/forgot
 * Body: { email }
 *
 * The "Forgot password?" button. Unauthenticated by design — the person asking
 * is locked out, so there is no key they could present — and deliberately
 * incurious: the answer is the same 202 whether or not that address has an
 * account, because a distinguishable answer turns this endpoint into a way to
 * test whether any given address is registered here. That is what
 * `requireContact: false` on the reset does: it refuses internally, in the same
 * words it would use for a real send, and tells the caller nothing.
 *
 * Unlike the admin-triggered endpoint this one refuses to create a contact: a
 * stranger must not be able to mint a contact row (and therefore an account) by
 * typing an address into a public form. An address with no contact here means
 * the farmers in question have not been registered on the server yet.
 *
 * 202 when the request was looked at · 400 not JSON · 503 the server has no
 * mailbox, so nothing could be delivered to anyone.
 *
 * That last one exists because its absence is what made this bug invisible: the
 * deployed API had no SMTP credentials, every send was recorded as "skipped",
 * and the screen still said a link was on its way. A server that cannot send an
 * email must say so rather than let someone wait for one.
 */
export async function POST(request) {
  const { store } = await ensureReady();

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('Body must be JSON: { identifier }');
  }

  /* An identifier, not just an address: someone who registered with a phone
     number types that, and it resolves here to the mailbox held against it -
     through the same phone key the sign-in route uses, so the number a farmer
     knows is the number that works. */
  const typed = typeof body?.identifier === 'string' ? body.identifier
    : (typeof body?.email === 'string' ? body.email : '');
  const who = normalizeIdentifier(typed);
  if (who.kind === 'none') return badRequest('An email address or phone number is required.');

  /* No mailbox means no reset link can reach anybody, whoever asks. Refusing
     here is a server-wide condition, not a fact about the address typed, so it
     keeps the promise this route makes: an address with an account and one
     without get the same answer. */
  const mailer = getMailer();
  if (!mailer.enabled) {
    return json({
      error: 'This server cannot send email right now, so the reset link cannot be delivered.',
      reason: 'mail-not-configured',
    }, 503);
  }

  const email = who.kind === 'email' ? who.value : await emailForPhone(store, who.phone);

  // A phone nobody registered resolves to nothing, and that is answered with
  // the same 202 as everything else - never "no such number".
  if (email) {
    await requestPasswordReset({
      store,
      mailer,
      email,
      requireContact: false, // never say whether this address is known
    });
  }

  // Nothing about what happened beyond "we looked at it" may reach the caller:
  // an unknown address, an unknown phone and a real send are one answer, because
  // anything else turns this endpoint into a way to test who is registered here.
  return json({
    requested: true,
    notice: 'If that address has an account, a reset link has been sent. The link works once and expires in 60 minutes.',
  }, 202);
}

export async function OPTIONS() {
  return options();
}
