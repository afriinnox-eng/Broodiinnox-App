# Broodiinnox API (Next.js + CockroachDB + MQTT)

The server half of the Broodiinnox platform. It sits **between the physical
devices and the dashboard**:

```
┌─────────────────┐   MQTT (cellular)   ┌──────────────────────┐   REST/JSON   ┌──────────────────┐
│  BROODIINNOX_V11 │ ────────────────▶  │  broodiinnox-api      │ ───────────▶ │  dashboard (SPA)  │
│  ESP32 firmware  │ ◀────────────────  │  Next.js + CockroachDB│ ◀─────────── │  farmer + admin   │
│  (BROODIINNOX-002│  control/<cmd>     └──────────────────────┘               └──────────────────┘
│   … the field)   │
└─────────────────┘
```

* **Ingest** — subscribes to `BROODIINNOX/+/data` and `BROODIINNOX/+/status`,
  understands the exact JSON snapshots, heartbeats and the retained
  `"offline"` LWT published by the firmware in `BROODIINNOX_V11.ino`.
* **Store** — persists readings, live device state, alerts and a command
  audit trail in **CockroachDB** (Postgres wire protocol). With no
  `DATABASE_URL` set it falls back to an in-memory store so you can try the
  API immediately — same interface, nothing persisted.
* **Control** — exposes REST endpoints the dashboard calls; every command is
  validated against the *firmware's own rules* (bounds, sensor selectors,
  presets, subscription lock) and published to
  `BROODIINNOX/<device_id>/control/<command>`.
* **Alerts** — the bridge raises events on firmware flag transitions
  (lock/unlock, failsafe engage/clear, sensor fault/recovery, mismatch,
  offline).

## Run it

```bash
cd broodiinnox-api
cp .env.example .env      # then set DATABASE_URL etc (all optional except prod)
npm install
npm run dev               # http://localhost:3001
```

For production: `npm run build && npm run start`.

Tests run with zero external dependencies (`node scripts/verify.mjs` parses
every source file and runs the node:test invariant suites):

```bash
npm test
```

After `npm run build`, a functional smoke test boots the production server
and asserts on real HTTP output (health, device register/list/get, firmware
command validation, audit trail, alerts):

```bash
node scripts/smoke-api.mjs
```

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | *(empty)* | CockroachDB connection string, e.g. `postgresql://user:pass@host:26257/defaultdb?sslmode=verify-full`. Empty ⇒ in-memory store (dev). |
| `MQTT_URL` | `mqtt://broker.hivemq.com:1883` | Broker — **must match what the firmware was flashed with**. |
| `MQTT_TOPIC_PREFIX` | `BROODIINNOX` | Topic namespace, matches firmware `DEVICE_ID` prefix. |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | *(empty)* | Broker credentials. |
| `API_KEYS` | *(empty)* | Comma-separated keys; empty = open (dev). Dashboard sends `X-API-Key`. |

> ⚠️ **Public brokers are unsafe for real deployments.** The stock firmware
> points at the public HiveMQ broker with no auth and predictable topics
> (`BROODIINNOX/<id>/control/relay` …), so **anyone** who knows a device id
> can command it. Before field deployment, point the firmware AND this server
> at a private broker (HiveMQ Cloud / EMQX / Mosquitto on a VPS) and set
> credentials on both sides.

## Endpoints

All responses are JSON. `X-API-Key` header required once `API_KEYS` is set.

| Method & path | Purpose |
|---|---|
| `GET /api/health` | Service, MQTT and storage status. |
| `GET /api/devices` | Every known unit with live state + online/offline liveness. |
| `POST /api/devices` | Register a unit: `{ device_id, name?, farmer_id?, location? }`. |
| `GET /api/devices/:id` | One unit: registry + latest state, `online`/`stale`. |
| `GET /api/devices/:id/readings?from&to&limit` | Sensor history, newest first (default 300, max 5000). |
| `POST /api/devices/:id/commands` | Send a control command (see table below). |
| `GET /api/devices/:id/audit` | Every command ever sent to that unit (incl. refusals). |
| `GET /api/alerts?deviceId&limit` | Alert feed from firmware flag transitions. |

### Commands — validated exactly as the firmware validates

Body: `{ "command": "<cmd>", "value": <value> }` →
`BROODIINNOX/<device_id>/control/<cmd>`.

| command | value | firmware rule (BROODIINNOX_V11.ino) |
|---|---|---|
| `relay` | `"ON" | "OFF" | "AUTO"` | manual on/off or return to automatic hysteresis |
| `max_temp` | integer | `> min_temp` and `<= 50` |
| `min_temp` | integer | `>= 10` and `< max_temp` |
| `total_days` | integer | `1..365` |
| `sensor` | `"DS1:ON"` … `"DS4:OFF"` | enable/disable a probe |
| `factory_reset` | `"RESET"` | wipe NVS, apply default preset, reboot |
| `animal_preset` | `"Chicken" | "Pig" | "Turkey" | "Duck"` | apply that preset’s profile |
| `device_active` | `"LOCKED" | "ACTIVE"` | subscription kill-switch (never blocked) |
| `set_time` | epoch secs, `"now"`, or `"YYYY-MM-DD HH:MM:SS"` | set the device RTC |

While a device is **LOCKED**, every firmware-guarded command is refused with
`423 Locked` (audited) — only `device_active=ACTIVE` is accepted, matching
`mqtt_callback()` in the firmware.

```bash
# examples
curl -X POST localhost:3001/api/devices -H 'content-type: application/json' \
  -d '{"device_id":"BROODIINNOX-002","name":"Main Farm","farmer_id":"f1","location":"Kigali"}'

curl 'localhost:3001/api/devices/BROODIINNOX-002' | jq .device

curl -X POST localhost:3001/api/devices/BROODIINNOX-002/commands \
  -H 'content-type: application/json' -d '{"command":"max_temp","value":36}'

curl -X POST localhost:3001/api/devices/BROODIINNOX-002/commands \
  -H 'content-type: application/json' -d '{"command":"device_active","value":"LOCKED"}'

curl 'localhost:3001/api/devices/BROODIINNOX-002/readings?limit=5' | jq '.readings[0]'
```

## Layout

```
app/api/                     Next.js route handlers (the REST surface)
lib/commands.js              command building/validation (pure — mirrors firmware)
lib/ingest.js                MQTT payload → normalized events (pure)
lib/constants.js             protocol constants copied from the firmware
lib/store.js                 CockroachDB store + in-memory fallback
lib/bridge.js                MQTT client: subscribe, ingest, persist, alert, publish
lib/server.js                process-wide singletons (store + bridge)
sql/schema.sql               CockroachDB DDL (server self-provisions too)
test/                        node:test invariant suites (no external deps)
scripts/verify.mjs           one-command syntax + invariant check
```

## Integration with the dashboard (next step)

The dashboard (Vite SPA, this repo's parent folder) currently simulates the
device layer in `src/lib/services.js`. To go live: point the dashboard's
service layer at `http://localhost:3001` (deployed: the API origin) and swap
each store call for these endpoints — the device JSON fields (`day`,
`ave_temp`, `relay_state`, `device_locked`, `failsafe_mode`, …) already match
what the farmer/admin pages render.
