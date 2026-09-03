import { isAuthorized } from '../../../../../lib/auth.js';
import { notFound, ok, options, unauthorized } from '../../../../../lib/http.js';
import { ensureReady } from '../../../../../lib/server.js';

/** GET /api/devices/:id/audit?limit=100 — every command ever sent to this unit */
export async function GET(request, ctx) {
  if (!isAuthorized(request)) return unauthorized();
  const params = await ctx.params;
  const { id: deviceId } = params;
  const { store } = await ensureReady();

  const url = new URL(request.url);
  const rawLimit = parseInt(url.searchParams.get('limit') || '100', 10);
  const limit = Math.max(1, Math.min(Number.isNaN(rawLimit) ? 100 : rawLimit, 500));

  const device = await store.getDevice(deviceId);
  if (!device) return notFound(`Unknown device "${deviceId}".`);

  const audit = await store.listAudit(deviceId, limit);
  return ok({ device_id: deviceId, count: audit.length, audit });
}

export async function OPTIONS() {
  return options();
}
