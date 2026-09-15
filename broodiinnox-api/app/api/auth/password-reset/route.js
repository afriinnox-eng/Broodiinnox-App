import { isAuthorized } from '../../../../lib/auth.js';
import { badRequest, json, options, unauthorized } from '../../../../lib/http.js';
import { ensureReady, getMailer } from '../../../../lib/server.js';
import { requestPasswordReset } from '../../../../lib/passwordReset.js';

/**
 * POST /api/auth/password-reset
 * Body: { email, name?, farmerId?, deviceId? }
 *
 * Ask for a reset link to be emailed. This is the endpoint the admin console's
 * "Reset password" buttons call, which is why it requires the dashboard API
 * key: it says who the email is going to.
 *
 * The response deliberately never contains the token — only the fact that it
 * was minted and how the send went, so an admin can see whether mail actually
 * left the building (`delivery.sent`) or the mailbox is unconfigured
 * (`delivery.configured === false`, with the reason).
 *
 * 202 sent · 400 bad address · 404 no contact for that address
 * 503 this server has no store for reset tokens
 */
export async function POST(request) {
  if (!isAuthorized(request)) return unauthorized();
  const { store } = await ensureReady();

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('Body must be JSON: { email, name?, farmerId?, deviceId? }');
  }

  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const out = await requestPasswordReset({
    store,
    mailer: getMailer(),
    email,
    name: typeof body?.name === 'string' ? body.name.slice(0, 120) : null,
    farmerId: body?.farmerId ?? body?.farmer_id ?? null,
    deviceId: body?.deviceId ?? body?.device_id ?? null,
  });

  if (!out.ok) {
    const status = out.reason === 'invalid-email' ? 400 : out.reason === 'unknown-email' ? 404 : 503;
    return json({ error: out.error, reason: out.reason }, status);
  }

  const d = out.delivery || {};
  return json({
    requested: true,
    email: out.email,
    contactId: out.contactId,
    expiresAt: out.expiresAt,
    expiresMinutes: out.expiresMinutes,
    delivery: {
      configured: !!d.configured,
      sent: d.sent || 0,
      skipped: d.skipped || 0,
      failed: d.failed || 0,
      results: d.results || [],
    },
  }, 202);
}

export async function OPTIONS() {
  return options();
}
