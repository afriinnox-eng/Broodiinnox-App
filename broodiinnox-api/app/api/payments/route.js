import { isAuthorized } from '../../../lib/auth.js';
import { badRequest, json, ok, options, unauthorized } from '../../../lib/http.js';
import { ensureReady } from '../../../lib/server.js';
import { publicPayment } from '../../../lib/payments.js';
import { createPaymentRequest } from '../../../lib/paymentFlow.js';

/**
 * GET  /api/payments?deviceId&farmerId&limit — payment history (newest first).
 * POST /api/payments                          — request a payment (MTN MoMo,
 *                                               collected by the Ekorana gateway).
 *
 * POST body: { device_id, amount, phone, farmer_id?, plan_id?, band_id?, currency? }
 *
 * The amount is the price the app published for that farm size and plan; the
 * gateway is asked to collect exactly it, and a payment is confirmed only when
 * the gateway says the same amount arrived.
 *
 * 201 the prompt was sent · 200 a live prompt was reused (no second charge)
 * 400 the request is not payable · 404 unknown device · 502 the gateway refused it
 * 503 the Ekorana gateway is not configured on this server (the body names the
 *     env vars still to be set)
 */
export async function GET(request) {
  if (!isAuthorized(request)) return unauthorized();
  const { store } = await ensureReady();
  const url = new URL(request.url);
  const parsed = Number.parseInt(url.searchParams.get('limit') || '100', 10);

  const rows = await store.listPayments({
    deviceId: url.searchParams.get('deviceId') || undefined,
    farmerId: url.searchParams.get('farmerId') || undefined,
    limit: Number.isFinite(parsed) ? parsed : 100,
  });
  const payments = rows.map(publicPayment);
  return ok({ count: payments.length, payments });
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorized();
  const { store } = await ensureReady();

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('Body must be JSON: { device_id, amount, phone, farmer_id?, plan_id? }');
  }

  const out = await createPaymentRequest({ store, body });
  return json(out.body, out.status);
}

export async function OPTIONS() {
  return options();
}
