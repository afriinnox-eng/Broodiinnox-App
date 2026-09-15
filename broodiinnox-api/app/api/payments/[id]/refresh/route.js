import { isAuthorized } from '../../../../../lib/auth.js';
import { json, options, unauthorized } from '../../../../../lib/http.js';
import { ensureReady, getMailer } from '../../../../../lib/server.js';
import { refreshPayment } from '../../../../../lib/paymentFlow.js';

/**
 * POST /api/payments/:id/refresh — ask the Ekorana gateway for this payment's
 * status NOW (the farmer pressing "check status", not waiting for the next poll).
 */
export async function POST(request, ctx) {
  if (!isAuthorized(request)) return unauthorized();
  const { id } = await ctx.params;
  const { store, bridge } = await ensureReady();
  const out = await refreshPayment({ store, bridge, paymentId: id, force: true, mailer: getMailer() });
  return json(out.body, out.status);
}

export async function OPTIONS() {
  return options();
}
