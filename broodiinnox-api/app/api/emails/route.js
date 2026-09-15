import { isAuthorized } from '../../../lib/auth.js';
import { ok, options, unauthorized } from '../../../lib/http.js';
import { ensureReady } from '../../../lib/server.js';

/**
 * GET /api/emails?deviceId&paymentId&status&to&limit
 *
 * Every send attempt this server has made, newest first — including the ones
 * that were skipped because the mailbox is not configured, and the ones that
 * failed at SMTP. This is how "did the farmer get the email?" is answered from
 * the database instead of by opening the mailbox and hoping.
 */
export async function GET(request) {
  if (!isAuthorized(request)) return unauthorized();
  const { store } = await ensureReady();
  const url = new URL(request.url);
  const parsed = Number.parseInt(url.searchParams.get('limit') || '100', 10);

  const emails = await store.listEmails({
    deviceId: url.searchParams.get('deviceId') || undefined,
    paymentId: url.searchParams.get('paymentId') || undefined,
    status: url.searchParams.get('status') || undefined,
    to: url.searchParams.get('to') || undefined,
    limit: Number.isFinite(parsed) ? parsed : 100,
  });
  return ok({ count: emails.length, emails });
}

export async function OPTIONS() {
  return options();
}
