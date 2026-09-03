import { isAuthorized } from '../../../lib/auth.js';
import { ok, options, unauthorized } from '../../../lib/http.js';
import { ensureReady } from '../../../lib/server.js';

/**
 * GET /api/alerts?deviceId=...&limit=200 — newest first.
 * Alerts are raised by the MQTT bridge on firmware flag transitions:
 * device.locked/unlocked, failsafe.engaged/cleared, sensor.fault/recovered,
 * sensor.mismatch, device.offline.
 */
export async function GET(request) {
  if (!isAuthorized(request)) return unauthorized();
  const { store } = await ensureReady();

  const url = new URL(request.url);
  const deviceId = url.searchParams.get('deviceId');
  const rawLimit = parseInt(url.searchParams.get('limit') || '200', 10);
  const limit = Math.max(1, Math.min(Number.isNaN(rawLimit) ? 200 : rawLimit, 1000));

  const alerts = await store.listAlerts(deviceId, limit);
  return ok({ count: alerts.length, alerts });
}

export async function OPTIONS() {
  return options();
}
