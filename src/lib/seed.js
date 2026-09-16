/**
 * The app's real starting state — and nothing else.
 *
 * This file used to seed six farmers and eight systems so the platform looked
 * live on first open. None of it was real: no unit sat behind BRD001..BRD008 and
 * the farmers were invented for the demonstration. The demonstration fleet has
 * been removed from the app; it survives only as a test fixture
 * (src/tests/fixtures/demoFleet.js), which nothing here imports and which
 * therefore never reaches the shipped bundle.
 *
 * What is left is what is true:
 *
 *   - one console account — the Afriinnox Super Admin, who registers every
 *     other account from inside the console;
 *   - the one farmer the live database has assigned to a REAL system;
 *   - the approved price sheet and the five plans on it, which are Afriinnox's
 *     published prices rather than demonstration data.
 *
 * No systems are seeded at all, and none should be. A real unit arrives from
 * broodiinnox-api on the live poll: LIVE_SYNC in store.jsx overlays every device
 * the API reports and adds any the app has not seen, which is the only place a
 * real system can come from. A seeded one would be a system with no hardware
 * behind it, which is exactly what was removed.
 *
 * SEED_VERSION is what carries the removal to a browser that has already used
 * the app. A saved state is keyed to the version that wrote it, and loadState()
 * (store.jsx) rebuilds from here when the version it finds is older — that is
 * what clears the fleet out of localStorage, where the app cannot reach it
 * otherwise. Bump it whenever the shape of this starting state changes.
 */
import { approvedPlans, publishedSheet } from './subscriptions.js';

export const SEED_VERSION = 2;

/** Dates relative to "now", so a fresh install does not look a year stale. */
function iso(daysFromNow, hour = 9) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, 15, 0, 0);
  return d.toISOString();
}

/**
 * The one console account. The four that used to sit beside it — ops@, tech@,
 * finance@ and support@ — were demo staff, and every one of them signed in
 * without a password ever being checked. That is not something to leave in an
 * app real farmers use, so the console has one account: the Super Admin, who
 * registers everyone else from inside it. There are no others, and adding one
 * back here would put a second way into the console.
 */
export const ADMINS = [
  { id: 'a1', name: 'Afriinnox', email: 'afriinnox@gmail.com', role: 'super', status: 'active', createdAt: iso(-300) },
];

/**
 * The one farmer record, and the reason it is here rather than removed with the
 * rest: the live database has assigned the real unit BROODIINNOX-001 to
 * `farmer_id: 'f1'` (devices table, broodiinnox-api). The id is what the API
 * binds to, so deleting this would not remove a demonstration farmer — it would
 * orphan a real system, and the console would show it as unassigned.
 *
 * Its name, phone and email are still the placeholders this file always
 * carried: they were never checked against the real owner, and nothing in the
 * code says who that is. Putting the real details here (and the matching contact
 * row in broodiinnox-api) is what lets that farmer sign in as themselves — the
 * one part of this cleanup that has to come from Afriinnox rather than the code.
 */
export const FARMERS = [
  { id: 'f1', name: 'Jean Damascene', phone: '0788123456', email: 'jean@farm.rw', district: 'Kigali', sector: 'Gasabo', status: 'active', createdAt: iso(-160), lastActiveBatchEnd: iso(-2) },
];

/** The five plans the platform sells. A plan is a duration; the farm size prices it. */
export const PLANS = approvedPlans();

/**
 * A fresh install: the console account, the real owner, the published price
 * list, and empty everything else. The empty collections are not placeholders —
 * they are the truth on a new browser, and each one fills from the real thing:
 * devices from the API poll, payments from the payment flow, alerts from the
 * rules in services.js, tickets and registrations from the console.
 */
export function buildSeed() {
  return {
    version: SEED_VERSION,
    farmers: FARMERS,
    devices: [],
    plans: PLANS,
    // The admin console edits this; it starts as the approved sheet.
    sheet: publishedSheet(),
    payments: [],
    alerts: [],
    tickets: [],
    admins: ADMINS,
    maintenance: [],
    inventory: [],
    messages: [],
    audit: [],
    notifications: [],
  };
}
