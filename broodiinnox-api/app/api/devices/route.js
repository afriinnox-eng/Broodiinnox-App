import { isAuthorized } from '../../../lib/auth.js';
import {
  badRequest, created, notFound, ok, options, unauthorized, withLiveness,
} from '../../../lib/http.js';
import { ensureReady } from '../../../lib/server.js';
import { DEVICE_ID_RE } from '../../../lib/constants.js';

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorized();
  const { store } = await ensureReady();
  const devices = (await store.listDevices()).map(withLiveness);
  return ok({ count: devices.length, devices });
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorized();
  const { store } = await ensureReady();

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('Body must be JSON: { device_id, name?, farmer_id?, location? }');
  }

  const deviceId = typeof body?.device_id === 'string' ? body.device_id.trim() : '';
  if (!DEVICE_ID_RE.test(deviceId)) {
    return badRequest(`Invalid device_id "${deviceId}" — must match /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/`);
  }

  const dev = await store.registerDevice({
    device_id: deviceId,
    name: typeof body?.name === 'string' ? body.name.slice(0, 120) : '',
    farmer_id: typeof body?.farmer_id === 'string' ? body.farmer_id.slice(0, 120) : null,
    location: typeof body?.location === 'string' ? body.location.slice(0, 250) : null,
  });
  if (!dev) return notFound('Failed to register device');
  return created({ device: withLiveness(dev) });
}

export async function OPTIONS() {
  return options();
}
