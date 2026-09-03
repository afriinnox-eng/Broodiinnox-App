import { isAuthorized } from '../../../../../lib/auth.js';
import {
  badRequest, notFound, ok, options, unauthorized,
} from '../../../../../lib/http.js';
import { ensureReady } from '../../../../../lib/server.js';

/** GET /api/devices/:id/readings?from=ISO&to=ISO&limit=300  (newest first) */
export async function GET(request, ctx) {
  if (!isAuthorized(request)) return unauthorized();
  const params = await ctx.params;
  const { id: deviceId } = params;
  const { store } = await ensureReady();

  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const rawLimit = parseInt(url.searchParams.get('limit') || '300', 10);

  for (const [name, v] of [['from', from], ['to', to]]) {
    if (v !== null && Number.isNaN(new Date(v).getTime())) {
      return badRequest(`${name} must be an ISO-8601 date/time`);
    }
  }
  if (Number.isNaN(rawLimit)) return badRequest('limit must be an integer');

  const device = await store.getDevice(deviceId);
  if (!device) return notFound(`Unknown device "${deviceId}".`);

  const limit = Math.max(1, Math.min(rawLimit || 300, 5000));
  const readings = await store.getReadings(deviceId, { from, to, limit });

  return ok({
    device_id: deviceId,
    count: readings.length,
    order: 'newest-first',
    readings,
  });
}

export async function OPTIONS() {
  return options();
}
