/**
 * WebSocket hub — process-wide broadcast of live events to connected
 * dashboards. One hub per server process (globalThis singleton) so route
 * handlers and the custom server share it.
 *
 * Events (all JSON):
 *   { type: 'hello',  service, auth }
 *   { type: 'telemetry', device_id, ts, ave_temp, temp1..4, relay_state, ... }
 *   { type: 'status', device_id, online, locked, ts }
 *   { type: 'alert',  device_id, severity, kind, message, ts }
 */
const g = globalThis;

export function getWsHub() {
  if (!g.__broodiinnoxWsHub) {
    const clients = new Set();
    g.__broodiinnoxWsHub = {
      clients,
      subscribe(client) {
        clients.add(client);
        return () => clients.delete(client);
      },
      publish(event) {
        const payload = JSON.stringify(event);
        for (const c of [...clients]) {
          if (c.readyState === 1) {
            try {
              c.send(payload);
            } catch {
              /* client is gone; the close handler removes it */
            }
          }
        }
      },
      count() {
        return clients.size;
      },
    };
  }
  return g.__broodiinnoxWsHub;
}
