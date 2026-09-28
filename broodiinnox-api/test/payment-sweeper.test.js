/**
 * The autonomous half of the payment flow — the part that means nobody has to
 * be watching for a paid unit to unlock itself.
 *
 *   INVARIANT   only the gateway's answer settles a payment and only a
 *               confirmed payment unlocks a unit; a lock commanded after a
 *               payment is never undone; a lapsed period stays locked.
 *   BEHAVIOURAL a payment the gateway had already collected is settled by a
 *               sweep — with no callback and nobody pressing anything — and the
 *               unit goes ACTIVE; an unlock that never landed is re-delivered,
 *               but not on every tick.
 *   FUNCTIONAL  the loop really runs on its own and is one per process.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../lib/store.js';
import {
  RECENT_COMMANDS, SWEEP_MAX_AGE_MS, UNLOCK_WINDOW_MS, createPaymentSweeper, lastLockCommandAt,
  newestConfirmedPayment, paymentSweeperReport, startPaymentSweeper, stopPaymentSweeper, unlockDue,
  unsettledPayments,
} from '../lib/paymentSweeper.js';

const ENV = {
  EKOPAY_API_KEY: 'ekopay-key',
  EKOPAY_TRANSFER_PHONE: '0788765432',
  EKOPAY_BASE_URL: 'https://ekopay.test/api/v1',
  EKOPAY_CURRENCY: 'RWF',
};
const DEVICE = 'BROODIINNOX-002';
const NOW = Date.parse('2026-09-20T12:00:00.000Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

/** A fake Ekorana gateway: only the status endpoint matters to a sweep. */
function fakeEkopay({ verify = { status: 'pending' }, status } = {}) {
  const calls = { status: 0 };
  const fetchImpl = async (url) => {
    const u = new URL(String(url), 'https://ekopay.test');
    if (u.pathname.includes('/payment/status/')) {
      calls.status += 1;
      calls.ref = decodeURIComponent(u.pathname.split('/').pop());
      const payload = typeof verify === 'function' ? verify() : verify;
      return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
    }
    return { ok: true, status: 200, text: async () => '{}' };
  };
  fetchImpl.calls = calls;
  if (status !== undefined) fetchImpl.status = status;
  return fetchImpl;
}

function fakeBridge() {
  const published = [];
  return { published, async publish(topic, payload) { published.push({ topic, payload }); } };
}

/** A store with one registered unit that reports itself LOCKED. */
async function lockedStore() {
  const store = new MemoryStore();
  await store.registerDevice({ device_id: DEVICE, name: 'Main Farm', farmer_id: 'f1' });
  await store.upsertState(DEVICE, { deviceId: DEVICE, locked: true, minTemp: 35, maxTemp: 37, lastSeenAt: NOW });
  return store;
}

/** A payment row, at whatever stage of its life the test needs. */
async function putPayment(store, { id = 'pay_1', status = 'pending', providerRef = id, confirmedAt = null, createdAt = iso(10_000), reason = null, amount = 12_000 } = {}) {
  return store.createPayment({
    id,
    device_id: DEVICE,
    farmer_id: 'f1',
    plan_id: 't30d',
    amount,
    currency: 'RWF',
    phone: '250788123456',
    method: 'MTN MoMo',
    status,
    provider_confirmed: status === 'successful',
    provider_ref: providerRef,
    financial_tx_id: status === 'successful' ? 'EK-TX-1' : null,
    reason,
    created_at: createdAt,
    updated_at: createdAt,
    confirmed_at: confirmedAt,
    status_checked_at: null,
  });
}

/** Record a lock the server actually commanded (the command ledger). */
async function commandedLock(store) {
  return store.logCommand({
    device_id: DEVICE, command: 'device_active', value: 'LOCKED',
    topic: `BROODIINNOX/${DEVICE}/control/device_active`, payload: 'LOCKED', published: true,
  });
}

/* ------------------------------------------------------------------ */
/* INVARIANT: what a sweep may look at                                 */
/* ------------------------------------------------------------------ */

test('unsettledPayments: everything the gateway still owes an answer for, and nothing else', () => {
  const rows = [
    { id: 'a', status: 'pending', provider_ref: 'a', created_at: iso(60_000) },
    { id: 'b', status: 'failed', provider_confirmed: false, reason: 'TIMEOUT', provider_ref: 'b', created_at: iso(120_000) },
    { id: 'c', status: 'failed', provider_confirmed: false, reason: 'NETWORK', provider_ref: 'c', created_at: iso(90_000) },
    // settled — history, never re-opened
    { id: 'd', status: 'successful', provider_confirmed: true, provider_ref: 'd', created_at: iso(30_000) },
    // the gateway itself refused it: nothing was collected, it is decided
    { id: 'e', status: 'failed', provider_confirmed: false, reason: 'INVALID_PHONE', provider_ref: 'e', created_at: iso(30_000) },
    // no reference to ask about
    { id: 'f', status: 'pending', provider_ref: null, created_at: iso(30_000) },
    // older than the window
    { id: 'g', status: 'pending', provider_ref: 'g', created_at: new Date(NOW - SWEEP_MAX_AGE_MS - 1).toISOString() },
  ];

  const ids = unsettledPayments(rows, { now: NOW }).map((p) => p.id);
  assert.deepEqual(ids, ['b', 'c', 'a'], 'oldest first, so the farmer who has waited longest is asked about first');
  assert.deepEqual(unsettledPayments([], { now: NOW }), []);
  assert.deepEqual(unsettledPayments(null, { now: NOW }), []);
});

test('unlockDue: a confirmed payment unlocks, unless somebody locked the unit after it', () => {
  const confirmed = { status: 'successful', provider_confirmed: true, confirmed_at: iso(60_000) };

  assert.equal(unlockDue({ payment: confirmed, now: NOW }), true, 'paid, locked, nothing else said: unlock');
  assert.equal(unlockDue({ payment: confirmed, lockedAt: NOW - 300_000, now: NOW }), true, 'a lock that PREDATES the payment is what the payment buys out');
  assert.equal(unlockDue({ payment: confirmed, lockedAt: NOW - 1_000, now: NOW }), false, 'a lock commanded AFTER the payment is a decision — the money does not overrule it');
  assert.equal(unlockDue({ payment: { ...confirmed, status: 'pending', provider_confirmed: false }, now: NOW }), false, 'unconfirmed unlocks nothing');
  assert.equal(unlockDue({ payment: { ...confirmed, confirmed_at: null }, now: NOW }), false, 'no confirmation instant is no entitlement');
  assert.equal(unlockDue({ payment: null, now: NOW }), false);
  assert.equal(
    unlockDue({ payment: { ...confirmed, confirmed_at: new Date(NOW - UNLOCK_WINDOW_MS - 1).toISOString() }, now: NOW }),
    false,
    'cover that ran out long ago stays locked — only a NEW payment unlocks'
  );
});

test('newestConfirmedPayment and lastLockCommandAt read the newest of each, whatever order they arrive in', () => {
  const older = { device_id: DEVICE, status: 'successful', provider_confirmed: true, confirmed_at: iso(600_000) };
  const newer = { device_id: DEVICE, status: 'successful', provider_confirmed: true, confirmed_at: iso(60_000) };
  const other = { device_id: 'BRD-OTHER', status: 'successful', provider_confirmed: true, confirmed_at: iso(1_000) };
  assert.equal(newestConfirmedPayment([older, newer, other], DEVICE), newer);
  assert.equal(newestConfirmedPayment([{ device_id: DEVICE, status: 'pending', provider_confirmed: false }], DEVICE), null);
  assert.equal(newestConfirmedPayment([], DEVICE), null);

  const lock = { command: 'device_active', value: 'LOCKED', ts: iso(120_000) };
  const olderLock = { command: 'device_active', value: 'LOCKED', ts: iso(600_000) };
  assert.equal(lastLockCommandAt([olderLock, lock]), NOW - 120_000, 'order-independent');
  assert.equal(lastLockCommandAt([{ command: 'device_active', value: 'ACTIVE', ts: iso(1_000) }]), 0, 'an unlock is not a lock');
  assert.equal(lastLockCommandAt([{ command: 'relay', value: 'OFF', ts: iso(1_000) }]), 0);
  assert.equal(lastLockCommandAt([]), 0);
});

/* ------------------------------------------------------------------ */
/* BEHAVIOURAL: what one sweep does                                    */
/* ------------------------------------------------------------------ */

test('a sweep settles a payment the gateway had collected — no callback, nobody asked', async () => {
  const store = await lockedStore();
  const bridge = fakeBridge();
  await putPayment(store);

  const sweeper = createPaymentSweeper({
    store, bridge, env: ENV, now: () => new Date(NOW).toISOString(),
    fetchImpl: fakeEkopay({ verify: { status: 'success', statusCode: 200, amount: 12_000 } }),
    log: { log() {}, warn() {}, error() {} },
  });

  const out = await sweeper.run();

  assert.equal(out.checked, 1);
  assert.equal(out.settled, 1);
  assert.equal(out.confirmed, 1);
  assert.equal(out.unlocked, 1);
  assert.equal(out.errors, 0);

  const stored = await store.getPayment('pay_1');
  assert.equal(stored.status, 'successful');
  assert.equal(stored.provider_confirmed, true);
  assert.ok(stored.confirmed_at, 'the confirmation is stamped');

  assert.deepEqual(bridge.published, [{
    topic: `BROODIINNOX/${DEVICE}/control/device_active`, payload: 'ACTIVE',
  }], 'the locked unit is told to unlock');

  const audit = await store.listAudit(DEVICE, 10);
  assert.equal(audit[0].command, 'device_active');
  assert.equal(audit[0].value, 'ACTIVE');
  assert.equal(audit[0].published, true);

  // ... and a second sweep changes nothing and re-sends nothing: the unit's
  // own report is what stops the loop, and a settled payment is history.
  await store.upsertState(DEVICE, { deviceId: DEVICE, locked: false, lastSeenAt: NOW });
  const again = await sweeper.run();
  assert.equal(again.settled, 0);
  assert.equal(again.unlocked, 0);
  assert.equal(bridge.published.length, 1);
});

test('a gateway that will not answer leaves the payment pending and unlocks nothing', async () => {
  const store = await lockedStore();
  const bridge = fakeBridge();
  await putPayment(store);

  const broken = async () => ({ ok: false, status: 503, text: async () => JSON.stringify({ error: 'down' }) });
  const sweeper = createPaymentSweeper({
    store, bridge, env: ENV, now: () => new Date(NOW).toISOString(), fetchImpl: broken,
    log: { log() {}, warn() {}, error() {} },
  });

  const out = await sweeper.run();
  assert.equal(out.checked, 1);
  assert.equal(out.settled, 0);
  assert.equal(out.errors, 0, 'a gateway that is down is not a sweep failure');
  assert.equal((await store.getPayment('pay_1')).status, 'pending');
  assert.equal(bridge.published.length, 0);
});

test('an unlock that never landed is re-delivered — and not on every tick', async () => {
  const store = await lockedStore();
  const bridge = fakeBridge();
  // Confirmed 10 minutes ago, and the unit still reports LOCKED: the publish
  // that should have unlocked it never arrived (bridge down, unit offline).
  await putPayment(store, { status: 'successful', confirmedAt: iso(600_000) });

  let clock = NOW;
  const sweeper = createPaymentSweeper({
    store, bridge, env: ENV, fetchImpl: fakeEkopay(), now: () => new Date(clock).toISOString(),
    log: { log() {}, warn() {}, error() {} },
  });

  const first = await sweeper.run();
  assert.equal(first.unlocked, 1);
  assert.equal(bridge.published.length, 1);

  // 15 s later the unit STILL reports locked (a GSM unit that is out of
  // coverage drops the command): the sweep does not hammer it.
  clock += 15_000;
  const second = await sweeper.run();
  assert.equal(second.unlocked, 0);
  assert.equal(bridge.published.length, 1, 'throttled per unit');

  // Once the throttle has passed, it tries again — until the hardware reports
  // the unlock, at which point it stops for good.
  clock += 5 * 60_000;
  const third = await sweeper.run();
  assert.equal(third.unlocked, 1);
  assert.equal(bridge.published.length, 2);

  await store.upsertState(DEVICE, { deviceId: DEVICE, locked: false, lastSeenAt: clock });
  clock += 5 * 60_000;
  const done = await sweeper.run();
  assert.equal(done.unlocked, 0);
  assert.equal(bridge.published.length, 2, 'the unit reports ACTIVE: nothing more is sent');
});

test('a unit locked by command after the payment is left alone', async () => {
  const store = await lockedStore();
  const bridge = fakeBridge();
  await putPayment(store, { status: 'successful', confirmedAt: iso(600_000) });
  // Somebody decided to lock this unit after the farmer paid — an admin
  // withdrawing a system, not a lapsed subscription. The money does not
  // overrule that, and the sweeper must not undo the console behind its back.
  await commandedLock(store);

  const sweeper = createPaymentSweeper({
    store, bridge, env: ENV, fetchImpl: fakeEkopay(), now: () => new Date(NOW).toISOString(),
    log: { log() {}, warn() {}, error() {} },
  });

  const out = await sweeper.run();
  assert.equal(out.unlocked, 0);
  assert.equal(bridge.published.length, 0);
  assert.equal((await store.listAudit(DEVICE, RECENT_COMMANDS)).length, 1, 'only the lock itself is in the ledger');
});

test('a payment older than the delivery window does not unlock a locked unit', async () => {
  const store = await lockedStore();
  const bridge = fakeBridge();
  await putPayment(store, {
    status: 'successful',
    confirmedAt: new Date(NOW - UNLOCK_WINDOW_MS - 60_000).toISOString(),
  });

  const sweeper = createPaymentSweeper({
    store, bridge, env: ENV, fetchImpl: fakeEkopay(), now: () => new Date(NOW).toISOString(),
    log: { log() {}, warn() {}, error() {} },
  });

  const out = await sweeper.run();
  assert.equal(out.unlocked, 0);
  assert.equal(bridge.published.length, 0, 'the paid period has run out: only a new payment unlocks');
});

test('a device that is not locked, or has never paid, is never touched', async () => {
  const store = new MemoryStore();
  await store.registerDevice({ device_id: DEVICE, name: 'Main Farm', farmer_id: 'f1' });
  await store.upsertState(DEVICE, { deviceId: DEVICE, locked: false, lastSeenAt: NOW });
  const bridge = fakeBridge();

  const sweeper = createPaymentSweeper({
    store, bridge, env: ENV, fetchImpl: fakeEkopay(), now: () => new Date(NOW).toISOString(),
    log: { log() {}, warn() {}, error() {} },
  });

  // unlocked unit with a confirmed payment
  await putPayment(store, { status: 'successful', confirmedAt: iso(60_000) });
  assert.equal((await sweeper.run()).unlocked, 0);

  // locked unit that has never paid
  await store.upsertState(DEVICE, { deviceId: DEVICE, locked: true, lastSeenAt: NOW });
  await store.updatePayment('pay_1', { status: 'pending', provider_confirmed: false, confirmed_at: null });
  assert.equal((await sweeper.run()).unlocked, 0);
  assert.equal(bridge.published.length, 0);
});

test('a sweep never throws, whatever the store does', async () => {
  const store = {
    async listPayments() { throw new Error('database on fire'); },
    async listDevices() { return []; },
  };
  const errors = [];
  const sweeper = createPaymentSweeper({
    store, bridge: fakeBridge(), env: ENV, fetchImpl: fakeEkopay(),
    log: { log() {}, warn() {}, error: (m) => errors.push(m) },
  });

  const out = await sweeper.run();
  assert.equal(out.errors, 1);
  assert.equal(sweeper.status.last_error, 'database on fire');
  assert.equal(sweeper.status.runs, 1);
  assert.equal(errors.length, 1, 'and it says so in the log');
});

/* ------------------------------------------------------------------ */
/* FUNCTIONAL: the loop runs by itself, once per process               */
/* ------------------------------------------------------------------ */

test('the sweeper runs on its own interval and there is only ever one of it', async (t) => {
  const store = await lockedStore();
  const bridge = fakeBridge();
  // The real clock, because this test waits on a real timer: status reads are
  // throttled, so the payment has to be older than a few seconds already.
  await putPayment(store, { createdAt: new Date(Date.now() - 10_000).toISOString() });

  const sweeper = createPaymentSweeper({
    store, bridge, env: ENV, intervalMs: 20,
    fetchImpl: fakeEkopay({ verify: { status: 'success', statusCode: 200, amount: 12_000 } }),
    log: { log() {}, warn() {}, error() {} },
  });
  t.after(() => sweeper.stop());

  assert.equal(sweeper.running, false, 'nothing runs until it is started');
  sweeper.start();
  assert.equal(sweeper.running, true);

  // Nobody calls run(): the timer does, and the payment is settled and the unit
  // unlocked on it. This is the whole point — no human, no dashboard, no call.
  await new Promise((r) => setTimeout(r, 400));

  assert.equal((await store.getPayment('pay_1')).status, 'successful');
  assert.deepEqual(bridge.published, [{
    topic: `BROODIINNOX/${DEVICE}/control/device_active`, payload: 'ACTIVE',
  }]);
  assert.equal(sweeper.status.runs >= 1, true);
  assert.equal(sweeper.status.enabled, true);
  assert.equal(sweeper.status.interval_ms, 20);

  sweeper.stop();
  assert.equal(sweeper.running, false);
});

test('startPaymentSweeper is one per process, stoppable, and reported on /api/health', async (t) => {
  stopPaymentSweeper();
  t.after(() => stopPaymentSweeper());

  const store = await lockedStore();
  const bridge = fakeBridge();
  await putPayment(store, { createdAt: new Date(Date.now() - 10_000).toISOString() });

  assert.deepEqual(paymentSweeperReport().enabled, false, 'a service with no sweeper says so');

  const first = startPaymentSweeper({
    store, bridge, env: ENV, intervalMs: 20,
    fetchImpl: fakeEkopay({ verify: { status: 'success', statusCode: 200, amount: 12_000 } }),
    log: { log() {}, warn() {}, error() {} },
  });
  const second = startPaymentSweeper({ store, bridge: fakeBridge(), env: ENV });

  assert.equal(first, second, 'a second start returns the sweeper that is already running');
  assert.equal(second.running, true);

  const report = paymentSweeperReport();
  assert.equal(report.enabled, true);
  assert.equal(report.running, true);
  assert.equal(report.interval_ms, 20);
  assert.equal(report.errors, 0);

  await new Promise((r) => setTimeout(r, 400));
  assert.equal((await store.getPayment('pay_1')).status, 'successful');
  assert.equal(paymentSweeperReport().settled >= 1, true);

  stopPaymentSweeper();
  assert.equal(paymentSweeperReport().runs, 0, 'the report is honest about having nothing running');
});

test('PAYMENT_SWEEP_DISABLED turns it off, and says why', () => {
  stopPaymentSweeper();
  const sweeper = createPaymentSweeper({ store: new MemoryStore(), env: { ...ENV, PAYMENT_SWEEP_DISABLED: '1' } });
  sweeper.start();
  assert.equal(sweeper.running, false);
  assert.equal(sweeper.status.enabled, false);
  assert.match(sweeper.status.disabled_reason, /PAYMENT_SWEEP_DISABLED/);
  stopPaymentSweeper();
});
