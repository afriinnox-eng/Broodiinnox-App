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

## Deploy (Render)

`render.yaml` deploys a **static site** from `main` (`npm ci && npm run build`,
`staticPublishPath: dist`) with an SPA rewrite of `/*` → `/index.html`.

## Brand

- Blue `#1c3a96` — primary / navigation
- Green `#3d5d30` — success / growth
- Black `#000000`, White `#ffffff` — text and surfaces
