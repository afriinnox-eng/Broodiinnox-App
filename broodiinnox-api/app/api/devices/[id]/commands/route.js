import { isAuthorized } from '../../../../../lib/auth.js';
import {
  badRequest, locked, notFound, ok, options, serviceUnavailable, unauthorized, withLiveness,
} from '../../../../../lib/http.js';

import { ensureReady } from '../../../../../lib/server.js';
import { buildControlMessage } from '../../../../../lib/commands.js';
import { COMMANDS_BLOCKED_WHEN_LOCKED, DEFAULT_TOPIC_PREFIX } from '../../../../../lib/constants.js';

/**
 * POST /api/devices/:id/commands
 * Body: { command: "relay" | "max_temp" | ... | "set_time", value: ... }
 * Validates against the EXACT firmware rules, audits every attempt, and
 * publishes to BROODIINNOX/<id>/control/<command> over MQTT.
 */
export async function POST(request, ctx) {
  if (!isAuthorized(request)) return unauthorized();
  const params = await ctx.params;
  const { id: deviceId } = params;

  const { store, bridge } = await ensureReady();
  const device = withLiveness(await store.getDevice(deviceId));
  if (!device) return notFound(`No device "${deviceId}" — register it first (POST /api/devices).`);

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('Body must be JSON: { command, value }');
  }
  const command = typeof body?.command === 'string' ? body.command : '';
  const value = body?.value ?? '';

  const msg = buildControlMessage(deviceId, command, value, {
    prefix: process.env.MQTT_TOPIC_PREFIX || DEFAULT_TOPIC_PREFIX,
    locked: !!device.device_locked,
    minTemp: device.min_temp,
    maxTemp: device.max_temp,
  });

  if (!msg.ok) {
    const isLock = COMMANDS_BLOCKED_WHEN_LOCKED.has(command) && !!device.device_locked;
    const res = isLock ? locked(msg.error) : badRequest(msg.error);
    // audit the refusal too, so support can see what was attempted & why
    await store.logCommand({
      device_id: deviceId,
      command,
      value: typeof value === 'object' ? JSON.stringify(value) : String(value),
      topic: '',
      payload: '',
      published: false,
      error: msg.error,
    });
    return res;
  }

  let published = false;
  let publishError = null;
  try {
    await bridge.publish(msg.topic, msg.payload);
    published = true;
  } catch (err) {
    publishError = err.message;
  }

  await store.logCommand({
    device_id: deviceId,
    command,
    value: typeof value === 'object' ? JSON.stringify(value) : String(value),
    topic: msg.topic,
    payload: msg.payload,
    published,
    error: publishError,
  });

  if (!published) {
    return serviceUnavailable(`Command accepted but NOT published: ${publishError}`);
  }
  return ok({
    accepted: true,
    device_id: deviceId,
    command,
    topic: msg.topic,
    payload: msg.payload,
  });
}

export async function OPTIONS() {
  return options();
}
