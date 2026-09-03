import { isAuthorized } from '../../../../lib/auth.js';
import {
  notFound, ok, options, unauthorized, withLiveness,
} from '../../../../lib/http.js';
import { ensureReady } from '../../../../lib/server.js';

export async function GET(request, ctx) {
  if (!isAuthorized(request)) return unauthorized();
  const params = await ctx.params;
  const { id: deviceId } = params;
  const { store } = await ensureReady();

  const device = withLiveness(await store.getDevice(deviceId));
  if (!device) return notFound(`No device "${deviceId}" — register it first (POST /api/devices) or wait for its first MQTT message.`);

  // bridge memory may know more (state seen after the last DB write) — merge
  const mem = globalThis.__broodiinnoxBridge?.getDeviceState(deviceId);
  return ok({ device: mem ? { ...device, ...mem, online: mem.online } : device });
}

export async function OPTIONS() {
  return options();
}
