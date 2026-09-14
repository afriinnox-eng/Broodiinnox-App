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
| `MOMO_SUBSCRIPTION_KEY` | *(empty)* | **MTN MoMo Collections** subscription key (`Ocp-Apim-Subscription-Key`). |
| `MOMO_API_USER` | *(empty)* | MoMo API user (UUID) created for this app. |
| `MOMO_API_KEY` | *(empty)* | That API user's key. |
| `MOMO_TARGET_ENVIRONMENT` | `sandbox` | `sandbox`, or the live environment MTN Rwanda onboards you into (`mtnrwanda`). |
| `MOMO_BASE_URL` | `https://sandbox.momodeveloper.mtn.com` | Provider host. |
| `MOMO_CURRENCY` | `RWF` | Currency each collection is requested in. |
| `MOMO_COUNTRY_CODE` | `250` | Used to normalize the payer's number to an MSISDN. |
| `MOMO_CALLBACK_URL` | *(empty)* | Optional public https URL for MTN's payment notification, e.g. `https://broodiinnox-api.onrender.com/api/payments/momo/callback`. |
| `MOMO_TIMEOUT_MS` | `15000` | Per-request timeout towards MTN. |

> **Payments need the three MoMo credentials.** Without them the server still
> serves everything else; `POST /api/payments` answers `503` naming the missing
> variables and `GET /api/health` reports `momo.enabled: false` with the same
> list — so a half-configured deployment is never mistaken for a working one.

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
| `POST /api/payments` | Request a MoMo collection: `{ device_id, amount, phone, farmer_id?, plan_id?, band_id?, currency? }` → a prompt on the payer's phone. |
| `GET /api/payments?deviceId&farmerId&limit` | Payment history, newest first. |
| `GET /api/payments/:id` | One payment; a pending one is re-checked with MTN MoMo on the way. |
| `POST /api/payments/:id/refresh` | Ask MoMo for this payment's status **now** (the farmer pressing "check status"). |
| `POST /api/payments/momo/callback[/:reference]` | MTN's payment notification. No API key (MTN cannot send one) — and trusted for nothing. |

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

## Payments — MTN Mobile Money (Collections)

A farmer pays for a subscription with MTN MoMo. The money never passes through
this server: MoMo collects from the payer's wallet, this server only *asks* for
the collection and *verifies* it.

```
farmer taps "Request MoMo payment"
        │  POST /api/payments  { device_id, amount, phone }
        ▼
broodiinnox-api ── 1. POST /collection/token/            → access token
        │         2. POST /collection/v1_0/requesttopay → 202 (prompt sent)
        ▼                                               X-Reference-Id = ours
MTN MoMo ── prompts 250788…, the farmer approves with their MoMo PIN
        │
        ├── MTN posts the verdict to MOMO_CALLBACK_URL (if configured)
        └── 3. GET /collection/v1_0/requesttopay/<reference> → PENDING | SUCCESSFUL | FAILED
        ▼
broodiinnox-api records the verdict · on SUCCESSFUL it unlocks the unit
(device_active=ACTIVE) and the app extends the subscription
```

### The one rule everything here obeys

**A payment is confirmed only by MTN's own answer, and only when the amount and
currency it collected are the ones requested.** Concretely:

* `provider_confirmed` is set in exactly one place — `applyProviderStatus()`, fed
  by `GET /collection/v1_0/requesttopay/<reference>`. No request body, no
  callback payload and no dashboard call can set it. A `SUCCESSFUL` for RWF 100
  against a RWF 12,000 request is recorded `FAILED` with `AMOUNT_MISMATCH`.
* The callback is re-verified: `POST /api/payments/momo/callback` looks the
  payment up, asks MoMo itself, and applies *that*. A forged notification is a
  no-op.
* A provider error (timeout, 500, unreachable) leaves the payment `PENDING`, never
  failed: a network hiccup is not a failed payment.
* Two taps while a prompt is live reuse the same payment (no second prompt, no
  second charge).
* Only a confirmed payment unlocks hardware, and only a unit that is actually
  locked — see `unlockDeviceAfterPayment()`.

### Going live

1. Sandbox: on <https://momodeveloper.mtn.com> subscribe to **Collections**,
   create an API user (`POST /v1_0/apiuser`) and an API key
   (`POST /v1_0/apiuser/<id>/apikey`), and set `MOMO_SUBSCRIPTION_KEY`,
   `MOMO_API_USER`, `MOMO_API_KEY`. Keep `MOMO_TARGET_ENVIRONMENT=sandbox`.
2. Live: MTN Rwanda issues the same three values for a production environment;
   set `MOMO_TARGET_ENVIRONMENT` and `MOMO_BASE_URL` to the live ones.
3. Set `MOMO_CALLBACK_URL` to this server's public
   `…/api/payments/momo/callback` if you want instant notifications (the app
   polls every few seconds anyway, so a callback that cannot reach a sleeping
   free-tier service delays nothing permanently).
4. Confirm the variables landed: `GET /api/health` → `momo.enabled: true`,
   `missing: []`. That says the server is *configured* — it cannot say whether
   MTN accepts the key.
5. Confirm MTN accepts them: `node scripts/momo-check.mjs` → `OK (collections)`.
   Exit 0 means the three credentials work and the Collections product answers
   for them; exit 1 means MTN rejected them and the message names which one to
   look at; exit 2 names the variables that are not set. Run it before telling
   a farmer to pay — an expired key, a key for another product and a key for
   the other environment all look exactly like a working one to `/api/health`.

On Render these go in the **broodiinnox-api** service → *Environment*, then
restart (or redeploy). Nothing about MoMo is compiled into the dashboard: the
browser only ever talks to this server.

## Layout

```
app/api/                     Next.js route handlers (the REST surface)
lib/commands.js              command building/validation (pure — mirrors firmware)
lib/ingest.js                MQTT payload → normalized events (pure)
lib/constants.js             protocol constants copied from the firmware
lib/store.js                 CockroachDB store + in-memory fallback
lib/bridge.js                MQTT client: subscribe, ingest, persist, alert, publish
lib/server.js                process-wide singletons (store + bridge)
lib/momo.js                  MTN MoMo Collections client + env config (secrets stay here)
lib/payments.js              payment records, validation and the rules that confirm them
lib/paymentFlow.js           request / status / callback — the flow the routes call
sql/schema.sql               CockroachDB DDL (server self-provisions too)
test/                        node:test invariant suites (no external deps)
scripts/verify.mjs           one-command syntax + invariant check
scripts/momo-check.mjs       ask MTN itself whether the credentials in the env work
```

Test files: `test/commands.test.js`, `test/ingest.test.js`, `test/store.test.js`,
`test/momo.test.js` (the MoMo client against a fake provider),
`test/payments.test.js` (the money rules) and `test/payment-flow.test.js` (the
whole journey against the in-memory store). `scripts/smoke-api.mjs` boots the
production server with a stub MoMo and drives a real payment over HTTP:
request → pending → wrong amount refused → confirmed → unit unlocked → forged
callback refused.

## Integration with the dashboard

The dashboard (Vite SPA, this repo's parent folder) currently simulates the
device layer in `src/lib/services.js`. To go live: point the dashboard's
service layer at `http://localhost:3001` (deployed: the API origin) and swap
each store call for these endpoints — the device JSON fields (`day`,
`ave_temp`, `relay_state`, `device_locked`, `failsafe_mode`, …) already match
what the farmer/admin pages render.
