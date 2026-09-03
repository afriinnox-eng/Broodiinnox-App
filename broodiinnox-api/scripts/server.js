/**
 * Custom Next.js server — hosts the REST API AND the live WebSocket endpoint.
 *
 *   ws(s)://<host>/ws            realtime device feed (see lib/wsHub.js)
 *
 * The dashboard opens a WebSocket instead of polling MQTT: the server keeps
 * the single device-side MQTT connection (the firmware speaks MQTT over GSM)
 * and streams every telemetry/status/alert event to dashboards over WS.
 *
 * Start: node scripts/server.js [--dev]
 */
import { createServer } from 'node:http';
import next from 'next';
import { WebSocketServer } from 'ws';
import { getWsHub } from '../lib/wsHub.js';
import { getBridge, getStore } from '../lib/server.js';
import { authorizeToken } from '../lib/auth.js';

// dev only when asked with --dev (or NODE_ENV=development); everything else is prod
const dev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
if (dev) process.env.NODE_ENV = 'development';
else if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';
const port = Number(process.env.PORT || 3001);
const hostname = '0.0.0.0';

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

const store = await getStore();
const bridge = await getBridge();
const hub = getWsHub();

const server = createServer((req, res) => handle(req, res));
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

function tokenFrom(req) {
  const url = new URL(req.url, 'http://localhost');
  return url.searchParams.get('api_key') || '';
}

wss.on('connection', (ws, req) => {
  const keyRequired = !!process.env.API_KEYS;
  const unsub = hub.subscribe(ws);
  ws.isAlive = true;

  ws.send(JSON.stringify({
    type: 'hello',
    service: 'broodiinnox-api',
    storage: store.mode,
    mqtt: bridge.connected,
    auth: !keyRequired ? 'open' : 'required',
  }));

  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    } else if (msg.type === 'auth') {
      if (authorizeToken(String(msg.api_key || ''))) {
        ws.authed = true;
        ws.send(JSON.stringify({ type: 'auth_ok' }));
      } else {
        ws.send(JSON.stringify({ type: 'auth_error' }));
        ws.close(4003, 'bad api key');
      }
    }
  });
  ws.on('close', unsub);
  ws.on('error', () => {});

  if (keyRequired) {
    // either an api_key query param at connect time, or an auth message
    if (authorizeToken(tokenFrom(req))) {
      ws.authed = true;
      ws.send(JSON.stringify({ type: 'auth_ok' }));
    } else {
      const t = setTimeout(() => {
        if (!ws.authed) ws.close(4001, 'auth required');
      }, 5000);
      ws.on('close', () => clearTimeout(t));
    }
  }
});

// heartbeat: drop clients that stopped answering pings
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);
wss.on('close', () => clearInterval(heartbeat));

server.listen(port, hostname, () => {
  console.log(`[broodiinnox-api] ready on http://${hostname}:${port} (${dev ? 'dev' : 'prod'}, storage=${store.mode}, ws=/ws)`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n[broodiinnox-api] ${sig} — shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
