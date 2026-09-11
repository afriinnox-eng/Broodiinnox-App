# Broodiinnox App

**Broodiinnox Remote Monitoring & Control** — a web-based IoT platform that connects
Broodiinnox automated brooding systems to farmers and the Afriinnox management team.

Built from the product spec in
`Broodiinnox Remote Control And Monitoring App Description.pdf` (31 pages, 42 sections),
referencing the user manual, the AFRIINNOX brand colours (`#1c3a96` blue, `#3d5d30` green,
black, white) and the Afriinnox–Hanga 2026 business documentation.

## Two dashboards, one platform

| Area | Farmer App | Afriinnox Admin |
|---|---|---|
| Focus | "How are my chicks doing right now?" | Every system, farmer, subscription, payment, device |
| Monitoring | System cards, sensors, live temperature, history | Live grid, map view, device health, firmware |
| Control | Targets, restart, time sync (with confirmations) | Register/assign/lock/restart devices remotely |
| Business | Subscriptions, MTN MoMo payments, alerts | Plans, payments, revenue, reports, audit log |
| Support | Help & support tickets | Ticket queue, bulk messaging, admin roles |
| Extras | Brooding tips, onboarding checklist, language toggle | Maintenance, spare-parts inventory, churn risk, CSV export |

## Demo accounts (mock backend)

- **Farmer** — phone `0788123456`, any password (quick button on the login page)
- **Admin** — email `admin@afriinnox.com`, any password (quick button on the login page)

The app ships with seeded demo data: 6 farmers, 8 Broodiinnox systems, active/expired
subscriptions, payments, alerts, tickets, maintenance records and inventory.

> **Mock IoT backend.** There is no physical device or server in this build. A service
> layer (`src/lib/services.js`) implements the business logic — temperature hysteresis,
> weekly age-based step-down, batch-day calculation, subscription locking, MoMo payment
> verification ("never unlock because the frontend says paid"), alert generation and the
> audit log — and the store simulates live telemetry every 5 s with random-walk sensor
> readings. The service functions are pure and unit-tested; the UI talks to the store the
> same way it would talk to a real API, so the mock layer can be swapped for a live
> backend/MQTT bridge without rewriting the UI.

## Development

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production build → dist/
npm run preview   # serve the production build
npm test          # vitest (service invariants + component + functional render tests)
npm run check     # build + tests
```

## Live IoT mode (hardware backend)

The same folder contains `broodiinnox-api/` — the Next.js + CockroachDB + MQTT
backend that speaks the firmware's protocol (see its README), and
`src/lib/iot.js` is this SPA's ready-to-use client + adapters for it. When no
API is configured the app runs its built-in simulation, so the demo never
breaks; set the env vars below and the pages can read real device state, send
firmware-validated commands and reconcile subscription locks.

```bash
# .env (or build env vars)
VITE_IOT_API_URL=http://localhost:3001   # broodiinnox-api base URL
VITE_IOT_API_KEY=                        # matches API_KEYS on the server
VITE_IOT_TIMEOUT_MS=8000
```

```js
import { createIotApi, resolveIotConfig, apiDeviceToVm, targetsToCommands, reconcileLockPlan } from './src/lib/iot.js';

const cfg = resolveIotConfig(import.meta.env);
const api = cfg.enabled ? createIotApi(cfg) : null;

// live state of every unit seen by the backend
const { devices } = await api.listDevices();
const vm = devices.map(apiDeviceToVm);   // API row -> dashboard device model

// farmer saves targets 32..36 -> validated firmware commands
const { commands, errors } = targetsToCommands({ min: 32, max: 36 });
for (const c of commands) await api.sendCommand('BROODIINNOX-002', c.command, c.value);

// subscription expired? drive the physical unit's lock to match business state
for (const step of reconcileLockPlan([{ deviceId: 'BROODIINNOX-002', currentLocked: false, wantLocked: true }])) {
  if (step.command) await api.sendCommand(step.deviceId, step.command.command, step.command.value);
}
```

Adapters and client are invariant-tested in `src/tests/iot.test.js`. Wiring
individual pages (Systems, Live, SystemDetail) to live mode is the next step
and should be done against a real broker + device so it can be verified
end-to-end.

### AUT / MAN, and the master ON/OFF switch

Every system carries two controls, because they answer two different questions:

| Control | Firmware payload | What the unit does |
|---|---|---|
| **AUT** | `relay AUTO` | its thermostat drives the heater from the temperature against the target band |
| **MAN**, switch ON | `relay ON` | the operator holds the heater on, whatever the temperature |
| **MAN**, switch OFF | `relay OFF` | the operator holds the heater off; the unit keeps reporting |

AUT means the system switches the heater itself, so the ON/OFF switch is
disabled there — the mode is not the operator's to make. MAN hands the heater
over: the switch is enabled and holds the state the operator sets.

The unit reports the pair back as `manual_control` (the mode) and `relay_state`
(the heater inside MAN) — `src/lib/live.js` reads both, so no control ever shows
a state the hardware is not in. A flip of the switch never changes the selected
mode (an ON used to send `relay AUTO`, which silently put a switched-off system
back under thermostat control), and a selection the unit has not confirmed is
re-sent, throttled and capped: `manual_relay_control` lives in RAM only, so a
reboot drops it. `_mode_probe.mjs` drives the real unit through all three
payloads and restores the state it found.

### Subscriptions: farm size -> plan -> price, paid per batch

The price list is the approved sheet (`Broodiinnox_Prices_Subscription.pdf`,
"Prices Based on Farm Sizes — Subscription Plan"), kept as data in
`src/lib/subscriptions.js`:

- **36 farm-size bands**, from "up to 599 chicks" to "15,000–15,999 chicks".
  16,000 and above is quoted individually ("Customized") and cannot be bought
  in the app.
- **five plans**: 15-Day, 30-Day, 40-Day, 6-Month, 1-Year. The sheet prints the
  15-Day price per band, and the other four are exact multiples of it — x1.6,
  x1.8, x5, x8 — in every band. `src/tests/subscriptions.test.js` reproduces all
  180 published prices band by band, so the app cannot quote a price the sheet
  does not.

A device is registered **with its farm size** — the maximum number of chicks
brooded at once — and that is what decides what every plan costs for it. The
farmer's page therefore shows the plans priced for their own farm size first,
and one button ("View all subscription plans") opens the whole published list so
other sizes can be compared. A system whose farm size is not recorded yet cannot
be priced at all, so its page opens that whole list by itself rather than hiding
the plans behind a button. The farm size is Afriinnox's to set, in the admin
console: a farmer must never be able to lower their own bill.

A subscription is bought **per batch**. A plan pays for the batch running when
it is bought and, when it is longer, for the cycles after it; a plan shorter
than one batch has to be extended before the cycle ends or the unit locks with
the animals still in the house. `coverageFor()` in `src/lib/subscriptions.js`
answers everything the screens show about that — whether the plan reaches the
last day of the batch (and by how many days it misses), how many whole cycles it
pays for (8 x 21 days for a 6-Month plan), how much cover is spent, and how many
days fall outside a whole batch. Renewing **extends** cover instead of replacing
it, so days already paid for are never thrown away, and the price paid and the
band it was bought for stay on the record as history.

Note: the farm size lives in the app's own data (with the rest of the
subscription and MoMo-payment layer, which is simulated end to end). A unit that
arrives only from the broodiinnox-api has no farm size until an admin sets one,
and the app says so rather than quoting it a price.

## Deploy (Render)

`render.yaml` deploys a **static site** from `main` (`npm ci && npm run build`,
`staticPublishPath: dist`) with an SPA rewrite of `/*` → `/index.html`.

## Brand

- Blue `#1c3a96` — primary / navigation
- Green `#3d5d30` — success / growth
- Black `#000000`, White `#ffffff` — text and surfaces
