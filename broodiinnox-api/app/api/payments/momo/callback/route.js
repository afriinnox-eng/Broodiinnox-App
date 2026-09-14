import { json, options } from '../../../../../lib/http.js';
import { ensureReady } from '../../../../../lib/server.js';
import { handleMomoCallback } from '../../../../../lib/paymentFlow.js';

/**
 * POST /api/payments/momo/callback[/:reference] — the MTN MoMo payment
 * notification (X-Callback-Url, see MOMO_CALLBACK_URL).
 *
 * Deliberately NOT behind the API key: MTN cannot send one. It is safe because
 * it trusts the payload for nothing — the payment is looked up, then MoMo
 * itself is asked for the verdict, and only that answer changes anything. A
 * forged callback can therefore never confirm a payment or unlock a unit.
 *
 * Always answers 2xx for a known reference so MTN does not keep retrying.
 */
export async function POST(request, ctx) {
  let body = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const params = ctx && ctx.params ? await ctx.params : {};
  const { store, bridge } = await ensureReady();

  const out = await handleMomoCallback({
    store,
    bridge,
    body,
    reference: params?.reference || null,
  });
  return json(out.body, out.status);
}

export async function OPTIONS() {
  return options();
}
