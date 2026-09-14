import { isAuthorized } from '../../../lib/auth.js';
import { ok, unauthorized, options } from '../../../lib/http.js';
import { ensureReady } from '../../../lib/server.js';
import { DEFAULT_TOPIC_PREFIX } from '../../../lib/constants.js';
import { describeMomoConfig, resolveMomoConfig } from '../../../lib/momo.js';

export async function GET() {
  const { store, bridge } = await ensureReady();
  const uptime = process.uptime();
  return ok({
    ok: true,
    service: 'broodiinnox-api',
    version: '0.1.0',
    time: new Date().toISOString(),
    uptime_s: Math.round(uptime),
    mqtt: {
      broker: process.env.MQTT_URL || 'mqtt://broker.hivemq.com:1883',
      topic_prefix: process.env.MQTT_TOPIC_PREFIX || DEFAULT_TOPIC_PREFIX,
      connected: bridge.connected,
      last_error: bridge.lastError,
    },
    storage: {
      mode: store.mode, // 'cockroach' | 'memory'
    },
    // Whether farmers can pay right now, and which env vars are still missing —
    // the names only, never a value. `enabled: false` here is the answer to
    // "why did the app say MTN MoMo is not configured?".
    momo: describeMomoConfig(resolveMomoConfig(process.env)),
  });
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorized();
  return options();
}
