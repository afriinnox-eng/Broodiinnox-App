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
| `EKOPAY_TIMEOUT_MS` | `20000` | How long to wait for Ekorana to answer. A timeout is not a refusal: the payment stays pending and the poll asks again. |
| `PAYMENT_SWEEP_INTERVAL_MS` | `15000` | How often the payment sweeper runs — the loop that settles a payment and unlocks its unit with nobody watching. See *The sweeper* below. |
| `PAYMENT_SWEEP_DISABLED` | *(empty)* | `1`/`true` turns the sweeper off. Only useful for debugging: with it off, a paid unit unlocks on Ekorana's callback or when somebody reads the payment. |
| `MAIL_HTTP_PROVIDER` | inferred from the key | `resend` or `brevo` — the HTTPS route mail takes, and the preferred one whenever a key is present. |
| `MAIL_HTTP_API_KEY` | *(empty)* | The provider's API key. `RESEND_API_KEY` / `BREVO_API_KEY` work too; a bare `MAIL_HTTP_API_KEY` is taken as Resend. |
| `SMTP_HOST` | `mail.privateemail.com` | The mailbox used when no provider key is set. |
| `SMTP_PORT` / `SMTP_SECURE` | `465` / `true` | Implicit SSL. `587` with `SMTP_SECURE=false` is STARTTLS. |
| `SMTP_USER` / `SMTP_PASSWORD` | *(empty)* | The full mailbox address, and its password. |
| `MAIL_FROM` / `MAIL_FROM_NAME` | the mailbox / `Broodiinnox` | The `From` header. With an HTTPS provider this must be on a domain verified **at that provider**. |
| `MAIL_OPS_TO` | the `From` address | Where alerts about a unit nobody owns are sent. |
| `APP_BASE_URL` | `https://broodiinnox-app.onrender.com` | The app a password-reset link points at. |
| `MAIL_TIMEOUT_MS` | `15000` | How long one send may take before it is abandoned. |

> **Email needs a mailbox or a provider key — and on Render's free instance type
> it needs the key.** Free Render web services block outbound traffic to SMTP
> ports `25`, `465` and `587`, so a perfectly correct mailbox with correct
> credentials still times out, and nothing in the logs says "blocked" — it says
> `Connection timeout`. A provider key sends over HTTPS on 443 and is unaffected.
> Which route is live is reported as `mail.transport` by `GET /api/health`, and
> every attempt — sent, skipped or failed, with the provider's own reason — is in
> `email_log`, readable through `GET /api/emails`. A send that could not leave is
> recorded there as `skipped`/`failed`, never as a success.

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
| `GET /api/health` | Service, MQTT, storage, gateway and **payment-sweeper** status. |
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

> **A locked unit unlocks itself once it has paid — nobody presses anything.**
> `device_active=ACTIVE` is sent by the payment flow the moment the gateway
> confirms the money (see *The sweeper* below), and by nothing else — a second
> admin command is the only thing that deliberately stands, until a new payment
> arrives.

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
* **Only the gateway may fail a payment.** A 4xx from it, or our own validation
  stopping the request before it was sent, is a refusal: nothing can have been
  collected, so the attempt is recorded `FAILED`. A timeout, a network error or
  a 5xx is *not* a refusal — the collection may exist and the farmer may already
  have paid it — so the payment stays `PENDING`, keeps the reference the gateway
  knows, and the poll keeps asking until it answers. A payment failed for want of
  an answer is still settled by a later verdict (`awaitsProvider`); only the
  gateway's own answer is final.
* A provider error (timeout, 500, unreachable) leaves the payment `PENDING`, never
  failed: a network hiccup is not a failed payment.
* Two taps while a prompt is live reuse the same payment (no second prompt, no
  second charge).
* Only a confirmed payment unlocks hardware, and only a unit that is actually
  locked — see `unlockDeviceAfterPayment()`.

### The sweeper — a paid unit unlocks with nobody watching

A confirmed payment unlocks its unit on three occasions: Ekorana's callback, a
read of the payment (the farmer opening the app), and the **payment sweeper**.
The first two need something else to happen first — the callback has to arrive
(the gateway retries at 30 s, 60 s and 120 s and then stops), and a read only
happens while somebody has the dashboard open. The sweeper, started once per
process in `scripts/server.js` (`lib/paymentSweeper.js`), is what makes the
unlock a guarantee instead of a hope:

* **it settles** every payment the gateway still owes an answer for — pending,
  or failed for want of an answer — by asking `/payment/status/…` again and
  applying what it says. Nothing else can confirm a payment and this changes
  nothing about that: the sweeper asks, the gateway decides.
* **it unlocks** any unit that reports itself `LOCKED` and is owed an unlock — a
  confirmed payment newer than the last `device_active=LOCKED` command on
  record, inside a 24-hour delivery window — by sending `device_active=ACTIVE`
  again. That covers the cases that used to leave a paying farmer locked out: a
  bridge that was down when the payment was confirmed, a GSM unit that was
  offline at the time (this hardware keeps `device_locked` in NVS, so it comes
  back locked), or a free instance that was asleep.

The lines it will not cross, all of them tested in `test/payment-sweeper.test.js`:

* a lock **commanded after** the payment is a decision, not an accident — an
  admin's Lock is never undone behind their back (the last
  `device_active=LOCKED` in the command ledger wins over an older payment);
* a paid period that has **run out** stays locked; only a *new* payment unlocks
  it, which is what keeps the kill-switch meaningful;
* a unit that reports itself unlocked is never sent anything, and a unit whose
  unlock has not landed yet is re-tried at most once every five minutes rather
  than every 15 seconds;
* a gateway that will not answer leaves the payment exactly where it was.

Each sweep writes a line to the log only when there was something to say
(`[payments] sweep checked=… settled=… unlocked=…`), and `GET /api/health`
reports `payment_sweeper` — `running`, `last_run_at`, and what it has settled
and unlocked since boot. That field, not an inference, is how "did the sweeper
run?" is answered.

> **On Render's free instance type the service is stopped when idle, so the
> sweeper only runs while it is awake.** An incoming callback wakes it, and the
> first sweep after boot settles whatever it slept through — but a payment whose
> callback never arrives and whose service never wakes still waits for the next
> request. A paid instance type (or any keep-alive that touches the service) is
> what makes the loop continuous.

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
lib/paymentSweeper.js        the autonomous half: settle, then unlock, with nobody watching
sql/schema.sql               CockroachDB DDL (server self-provisions too)
test/                        node:test invariant suites (no external deps)
scripts/verify.mjs           one-command syntax + invariant check
scripts/ekopay-check.mjs     ask Ekorana itself whether the key in the env works
```

Test files: `test/commands.test.js`, `test/ingest.test.js`, `test/store.test.js`,
`test/ekopay.test.js` (the gateway client against a fake gateway),
`test/ekopay-check.test.js` (the CLI's exit codes), `test/payments.test.js` (the
money rules), `test/payment-flow.test.js` (the whole journey against the
in-memory store) and `test/payment-sweeper.test.js` (the same journey with
everybody's back turned). `scripts/smoke-api.mjs` boots the production server with a
stub Ekorana gateway and drives a real payment over HTTP: request → pending →
wrong amount refused → confirmed → unit unlocked → forged callback refused.

## Integration with the dashboard

The dashboard (Vite SPA, this repo's parent folder) currently simulates the
device layer in `src/lib/services.js`. To go live: point the dashboard's
service layer at `http://localhost:3001` (deployed: the API origin) and swap
each store call for these endpoints — the device JSON fields (`day`,
`ave_temp`, `relay_state`, `device_locked`, `failsafe_mode`, …) already match
what the farmer/admin pages render.
