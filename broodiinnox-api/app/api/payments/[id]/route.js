import { isAuthorized } from '../../../../lib/auth.js';
import { json, options, unauthorized } from '../../../../lib/http.js';
import { ensureReady } from '../../../../lib/server.js';
import { refreshPayment } from '../../../../lib/paymentFlow.js';

/**
 * GET /api/payments/:id — one payment.
 *
 * A pending payment is re-checked with MTN MoMo on the way (throttled to one
 * check every few seconds), so simply reading a payment is enough for the
 * dashboard to learn that it was approved — and a confirmed payment unlocks the
 * unit that it paid for.
 */
export async function GET(request, ctx) {
  if (!isAuthorized(request)) return unauthorized();
  const { id } = await ctx.params;
  const { store, bridge } = await ensureReady();
  const out = await refreshPayment({ store, bridge, paymentId: id });
  return json(out.body, out.status);
}

export async function OPTIONS() {
  return options();
}
