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
| `EKOPAY_API_KEY` | *(empty)* | **Ekorana** API key. Sent as the `apiKey` query parameter on every gateway call. |
| `EKOPAY_TRANSFER_PHONE` | *(empty)* | Your merchant MTN number — where the collected money is transferred to. |
| `EKOPAY_BASE_URL` | `https://api.payment.ekorana.com/api/v1` | Gateway host. |
| `EKOPAY_CALLBACK_URL` | this deployment's `…/api/payments/ekopay/callback` | Where Ekorana posts the verdict. The gateway requires one on every request; the app polls as well. |
| `EKOPAY_CURRENCY` | `RWF` | The currency the gateway collects in. |
| `EKOPAY_COUNTRY_CODE` | `250` | Used to normalize the payer's and the merchant number to MSISDNs. |
| `EKOPAY_MIN_AMOUNT` | `50` | The gateway's own floor; a smaller request is refused before it is sent. |
| `EKOPAY_TIMEOUT_MS` | `8000` | Per-request timeout towards Ekorana — kept under its 10 s callback budget. |

> **Payments need the Ekorana API key and merchant number.** Without them the
> server still serves everything else; `POST /api/payments` answers `503` naming
> what is still to be set and `GET /api/health` reports `ekopay.enabled: false`
> with the same list — so a half-configured deployment is never mistaken for a
> working one.

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
| `POST /api/payments` | Request a MoMo collection through Ekorana: `{ device_id, amount, phone, farmer_id?, plan_id?, band_id?, currency? }` → a prompt on the payer's phone. |
| `GET /api/payments?deviceId&farmerId&limit` | Payment history, newest first. |
| `GET /api/payments/:id` | One payment; a pending one is re-checked with the gateway on the way. |
| `POST /api/payments/:id/refresh` | Ask Ekorana for this payment's status **now** (the farmer pressing "check status"). |
| `POST /api/payments/ekopay/callback[/:reference]` | Ekorana's payment notification. No API key (the gateway cannot send one) — and trusted for nothing. |

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

## Payments — MTN Mobile Money, through the Ekorana gateway (Ekopay)

A farmer pays for a subscription with MTN MoMo. The money never passes through
this server: the **Ekorana Payment Gateway** collects from the payer's wallet
and transfers it to your merchant MTN number; this server only *places* the
collection and *verifies* it. The API documentation is
`ekopay Payment Gateway API Documentation.pdf` in the repo root.

```
farmer taps "Request MoMo payment"
        │  POST /api/payments  { device_id, amount, phone }
        ▼
broodiinnox-api ── 1. POST /payment/initiate?apiKey=… → 201 (prompt sent)
        ▼                        referenceId = our own payment id
Ekorana ── prompts 250788…, the farmer approves with their MoMo PIN,
        │   and transfers the money to EKOPAY_TRANSFER_PHONE
        │
        ├── Ekorana posts the verdict to EKOPAY_CALLBACK_URL
        │   (it retries at 30 s, 60 s and 120 s without a 200 in 10 s)
        └── 2. GET /payment/status/<referenceId>?apiKey=… → pending | success | failed
        ▼
broodiinnox-api records the verdict · on success it unlocks the unit
(device_active=ACTIVE) and the app extends the subscription
```

### The one rule everything here obeys

**A payment is confirmed only by the gateway's own answer, and only when the
amount it collected is the amount requested.** Concretely:

* `provider_confirmed` is set in exactly one place — `applyProviderStatus()`, fed
  by `GET /payment/status/<referenceId>`. No request body, no callback payload
  and no dashboard call can set it. A `success` for RWF 100 against a RWF 12,000
  request is recorded `FAILED` with `AMOUNT_MISMATCH` — and so is a `success`
  sitting next to a non-200 `statusCode`.
* The callback is re-verified: `POST /api/payments/ekopay/callback` looks the
  payment up by the `referenceId` Ekorana echoes back, asks the gateway itself,
  and applies *that*. A forged notification is a no-op, and a duplicate — the
  gateway retries when we are slower than ten seconds — changes nothing.
* An amount below the gateway's floor of 50 RWF is refused before it is sent.
* A provider error (timeout, 500, unreachable) leaves the payment `PENDING`, never
  failed: a network hiccup is not a failed payment.
* Two taps while a prompt is live reuse the same payment (no second prompt, no
  second charge).
* Only a confirmed payment unlocks hardware, and only a unit that is actually
  locked — see `unlockDeviceAfterPayment()`.

### Going live

1. Ask Ekorana for your **API key**, and confirm the **merchant MTN number** the
   money has to land on. Set `EKOPAY_API_KEY` and `EKOPAY_TRANSFER_PHONE` — both
   are required, and this server refuses to place a collection without either.
2. Leave `EKOPAY_BASE_URL` at `https://api.payment.ekorana.com/api/v1` unless
   Ekorana gives you another host, and set `EKOPAY_CALLBACK_URL` if this server
   is not the one at `broodiinnox-api.onrender.com`. The gateway requires a
   callback URL on every request; the app polls every few seconds anyway, so a
   callback that cannot reach a sleeping free-tier service delays nothing
   permanently.
3. Confirm the variables landed: `GET /api/health` → `ekopay.enabled: true`,
   `missing: []`, `invalid: []`. That says the server is *configured* — it
   cannot say whether Ekorana accepts the key.
4. Confirm Ekorana accepts it: `node scripts/ekopay-check.mjs` → `OK (status)`.
   Exit 0 means the key works and the gateway answers a status read for a
   reference that cannot exist; exit 1 means it rejected the key (the message
   says whether it is invalid or simply not activated) and exit 2 names the
   variables still to be set. Run it before telling a farmer to pay —
   `/api/health` cannot tell a working key from an expired one.

On Render these go in the **broodiinnox-api** service → *Environment*, then
restart (or redeploy). Nothing about payments is compiled into the dashboard:
the browser only ever talks to this server.

## Layout

```
app/api/                     Next.js route handlers (the REST surface)
lib/commands.js              command building/validation (pure — mirrors firmware)
lib/ingest.js                MQTT payload → normalized events (pure)
lib/constants.js             protocol constants copied from the firmware
lib/store.js                 CockroachDB store + in-memory fallback
lib/bridge.js                MQTT client: subscribe, ingest, persist, alert, publish
lib/server.js                process-wide singletons (store + bridge)
lib/ekopay.js                 Ekorana gateway client + env config (the API key stays here)
lib/payments.js              payment records, validation and the rules that confirm them
lib/paymentFlow.js           request / status / callback — the flow the routes call
sql/schema.sql               CockroachDB DDL (server self-provisions too)
test/                        node:test invariant suites (no external deps)
scripts/verify.mjs           one-command syntax + invariant check
scripts/ekopay-check.mjs     ask Ekorana itself whether the key in the env works
```

Test files: `test/commands.test.js`, `test/ingest.test.js`, `test/store.test.js`,
`test/ekopay.test.js` (the gateway client against a fake gateway),
`test/ekopay-check.test.js` (the CLI's exit codes), `test/payments.test.js` (the
money rules) and `test/payment-flow.test.js` (the whole journey against the
in-memory store). `scripts/smoke-api.mjs` boots the production server with a
stub Ekorana gateway and drives a real payment over HTTP: request → pending →
wrong amount refused → confirmed → unit unlocked → forged callback refused.

## Integration with the dashboard

The dashboard (Vite SPA, this repo's parent folder) currently simulates the
device layer in `src/lib/services.js`. To go live: point the dashboard's
service layer at `http://localhost:3001` (deployed: the API origin) and swap
each store call for these endpoints — the device JSON fields (`day`,
`ave_temp`, `relay_state`, `device_locked`, `failsafe_mode`, …) already match
what the farmer/admin pages render.
