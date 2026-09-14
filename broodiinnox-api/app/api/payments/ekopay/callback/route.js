import { json, options } from '../../../../../lib/http.js';
import { ensureReady } from '../../../../../lib/server.js';
import { handleEkopayCallback } from '../../../../../lib/paymentFlow.js';

/**
 * POST /api/payments/ekopay/callback[/:reference] — the Ekorana payment
 * notification (the `callbackUrl` sent on every initiate request, see
 * EKOPAY_CALLBACK_URL). The gateway is documented to retry three times — at
 * 30 s, 60 s and 120 s — when this does not answer 200 within ten seconds, so
 * this route answers as soon as it has a verdict, and a retry is harmless.
 *
 * Deliberately NOT behind the API key: Ekorana cannot send one. It is safe
 * because it trusts the payload for nothing — the payment is looked up by the
 * referenceId the gateway echoes back, then the gateway itself is asked for the
 * verdict, and only that answer changes anything. A forged callback can
 * therefore never confirm a payment or unlock a unit.
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

  const out = await handleEkopayCallback({
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
