/**
 * Process-wide singletons: one store, one MQTT bridge, started lazily on the
 * first API request and reused for the life of the Next.js server process.
 * globalThis survives dev-mode module reloads, so a hot reload never spawns a
 * second bridge / second connection.
 */
import { createStore } from './store.js';
import { Bridge } from './bridge.js';
import { getWsHub } from './wsHub.js';
import { DEFAULT_TOPIC_PREFIX } from './constants.js';

const g = globalThis;

export async function getStore() {
  if (!g.__broodiinnoxStore) g.__broodiinnoxStore = await createStore();
  return g.__broodiinnoxStore;
}

export async function getBridge() {
  if (!g.__broodiinnoxBridge) {
    const store = await getStore();
    const bridge = new Bridge({
      url: process.env.MQTT_URL || 'mqtt://broker.hivemq.com:1883',
      prefix: process.env.MQTT_TOPIC_PREFIX || DEFAULT_TOPIC_PREFIX,
      username: process.env.MQTT_USERNAME,
      password: process.env.MQTT_PASSWORD,
      store,
    });
    // every ingest event is pushed to WebSocket subscribers
    bridge.onEvent = (ev) => getWsHub().publish(ev);
    g.__broodiinnoxBridge = bridge;
    // Fire-and-forget: start() resolves after connect or a 15 s timeout and
    // the API keeps working either way (commands fail cleanly when offline).
    bridge.start().catch((err) => console.error(`[bridge] start error: ${err.message}`));
  }
  return g.__broodiinnoxBridge;
}

export async function ensureReady() {
  const store = await getStore();
  const bridge = await getBridge();
  // do NOT await the broker handshake here: the API must answer immediately
  // even when the broker is unreachable (commands then fail with 503).
  return { store, bridge };
}
