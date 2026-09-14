/**
 * The payment flow against a real (in-memory) store and a fake Ekorana gateway
 * — the whole journey a farmer takes, plus the ways it can go wrong for them.
 *
 *   INVARIANT   nothing a client sends can confirm a payment: only a status
 *               answer from the gateway can, and only when the amount it
 *               collected matches what was requested. A unit is unlocked
 *               exactly once, and only for a confirmed payment.
 *   BEHAVIOURAL a request sends one prompt to the number the farmer typed, for
 *               the amount asked and to the merchant number on the server; a
 *               second tap reuses it instead of charging twice; a refused
 *               request is recorded with its reference and reports why.
 *   FUNCTIONAL  the flow runs end to end on the store the server really uses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../lib/store.js';
import { publicPayment } from '../lib/payments.js';
import { createPaymentRequest, handleEkopayCallback, refreshPayment } from '../lib/paymentFlow.js';

const ENV = {
  EKOPAY_API_KEY: 'ekopay-key',
  EKOPAY_TRANSFER_PHONE: '0788765432',
  EKOPAY_BASE_URL: 'https://ekopay.test/api/v1',
  EKOPAY_CURRENCY: 'RWF',
  EKOPAY_CALLBACK_URL: 'https://api.test/api/payments/ekopay/callback',
};
const DEVICE = 'BROODIINNOX-002';
const BODY = { device_id: DEVICE, farmer_id: 'f1', plan_id: 't30d', band_id: 'b5', amount: 12_000, phone: '0788123456' };

/** A fake Ekorana gateway. `verify` is what the status endpoint will answer. */
function fakeEkopay({ verify = { status: 'pending' }, payStatus = 201, initiate = 'ok' } = {}) {
  const calls = { pay: 0, status: 0 };
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(String(url), 'https://ekopay.test');
    const body = opts.body ? JSON.parse(opts.body) : null;
    const ok = (status, payload) => ({ ok: status < 300, status, text: async () => (payload === undefined ? '' : JSON.stringify(payload)) });

    if (u.pathname.endsWith('/payment/initiate')) {
      calls.pay += 1;
      calls.payBody = body;
      calls.payUrl = String(url);
      calls.payKey = u.searchParams.get('apiKey');
      // Silence, not a refusal: the client's own timeout aborts this one, and
      // the network error never reaches the gateway at all. Both are the case
      // that used to bury money that had in fact been collected.
      if (initiate === 'timeout') {
        return new Promise((_, reject) => {
          opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
      }
      if (initiate === 'network') throw new Error('getaddrinfo ENOTFOUND');
      if (payStatus >= 300) return ok(payStatus, { error: payStatus === 400 ? 'referenceId already exists' : 'nope' });
      return ok(201, {
        transaction: {
          amount: body.amount,
          referenceId: body.referenceId,
          phoneNumber: body.phoneNumber,
          transferPhone: body.transferPhone,
          transactionId: 'EK-TX-1',
          status: 'pending',
          callbackUrl: body.callbackUrl,
          createdAt: '2026-09-20T10:00:00Z',
        },
        message: 'Payment initiated successfully',
      });
    }
    if (u.pathname.includes('/payment/status/')) {
      calls.status += 1;
      calls.statusRef = decodeURIComponent(u.pathname.split('/').pop());
      return ok(200, typeof verify === 'function' ? verify() : verify);
    }
    return ok(404, { error: 'Transaction not found' });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

async function storeWithDevice() {
  const store = new MemoryStore();
  await store.registerDevice({ device_id: DEVICE, name: 'Main Farm', farmer_id: 'f1' });
  return store;
}

function fakeBridge() {
  const published = [];
  return { published, async publish(topic, payload) { published.push({ topic, payload }); } };
}

/**
 * A moment after a payment was created, for the calls that talk to the gateway.
 * Status checks are throttled, so a test that wants a check has to happen later
 * than the payment did — and it is measured from the payment itself, so the
 * machine's clock never matters.
 */
const laterThan = (payment, ms = 6_000) => new Date(Date.parse(payment.created_at) + ms).toISOString();

/* ------------------------------------------------------------------ */
/* Requesting a payment                                                */
/* ------------------------------------------------------------------ */

test('an unconfigured server says so, names the env vars, and charges nothing', async () => {
  const store = await storeWithDevice();
  const fetchImpl = fakeEkopay();
  const out = await createPaymentRequest({ store, body: BODY, env: {}, fetchImpl });

  assert.equal(out.status, 503);
  assert.match(out.body.error, /EKOPAY_API_KEY/);
  assert.equal(out.body.ekopay.enabled, false);
  assert.equal(fetchImpl.calls.pay + fetchImpl.calls.status, 0, 'no gateway call without credentials');
  assert.equal((await store.listPayments()).length, 0, 'no payment record without credentials');
});

test('an unpriced or unpayable request is refused before the gateway is touched', async () => {
  const store = await storeWithDevice();
  const fetchImpl = fakeEkopay();

  const noAmount = await createPaymentRequest({ store, body: { ...BODY, amount: 0 }, env: ENV, fetchImpl });
  assert.equal(noAmount.status, 400);
  assert.match(noAmount.body.error, /whole number/);

  // 49 RWF is under the gateway's own floor: refused here, not after a round trip
  const tooSmall = await createPaymentRequest({ store, body: { ...BODY, amount: 49 }, env: ENV, fetchImpl });
  assert.equal(tooSmall.status, 400);
  assert.match(tooSmall.body.error, /between 50 and/);

  const noPhone = await createPaymentRequest({ store, body: { ...BODY, phone: 'nope' }, env: ENV, fetchImpl });
  assert.equal(noPhone.status, 400);
  assert.match(noPhone.body.error, /valid MTN MoMo number/);

  const unknown = await createPaymentRequest({ store, body: { ...BODY, device_id: 'BRD-NOPE' }, env: ENV, fetchImpl });
  assert.equal(unknown.status, 404);

  assert.equal(fetchImpl.calls.pay, 0);
  assert.equal((await store.listPayments()).length, 0);
});

test('a payment request sends the gateway the normalized number and exactly the amount asked', async () => {
  const store = await storeWithDevice();
  const bridge = fakeBridge();
  const fetchImpl = fakeEkopay();

  const out = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl });
  assert.equal(out.status, 201);
  assert.equal(out.body.payment.status, 'pending');
  assert.equal(out.body.payment.provider_confirmed, false);
  assert.ok(out.body.payment.provider_ref);
  assert.equal(out.body.payment.amount, 12_000);
  assert.equal(out.body.payment.phone, '250788123456');
  // The gateway's referenceId is our own payment id, so a callback resolves by
  // looking the payment up — and Ekorana's transaction id is kept as evidence.
  assert.equal(out.body.payment.provider_ref, out.body.payment.id);
  assert.equal(out.body.payment.financial_transaction_id, 'EK-TX-1');

  // what actually reached Ekorana
  assert.equal(fetchImpl.calls.pay, 1);
  assert.equal(fetchImpl.calls.payKey, ENV.EKOPAY_API_KEY);
  assert.equal(fetchImpl.calls.payUrl.startsWith(`${ENV.EKOPAY_BASE_URL}/payment/initiate`), true);
  assert.equal(fetchImpl.calls.payBody.amount, 12_000);
  assert.equal(fetchImpl.calls.payBody.referenceId, out.body.payment.id);
  assert.equal(fetchImpl.calls.payBody.phoneNumber, '250788123456');
  assert.equal(fetchImpl.calls.payBody.transferPhone, '250788765432');
  assert.equal(fetchImpl.calls.payBody.callbackUrl, ENV.EKOPAY_CALLBACK_URL);
  assert.equal(fetchImpl.calls.payBody.currency, undefined, 'the gateway collects RWF and takes no currency field');

  // and what the app is told: pending, so nothing unlocks yet
  const refreshed = await refreshPayment({
    store, bridge, paymentId: out.body.payment.id, env: ENV, fetchImpl: fakeEkopay(),
    now: laterThan(out.body.payment),
  });
  assert.equal(refreshed.body.payment.status, 'pending');
  assert.equal(bridge.published.length, 0);
});

test('tapping pay twice reuses the live prompt instead of prompting twice', async () => {
  const store = await storeWithDevice();
  const fetchImpl = fakeEkopay();

  const first = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl });
  const second = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl });

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.body.reused, true);
  assert.equal(second.body.payment.id, first.body.payment.id);
  assert.equal(fetchImpl.calls.pay, 1, 'the farmer must not be prompted twice');
  assert.equal((await store.listPayments()).length, 1);
});

test('a request the gateway refuses is recorded as a failed attempt, with the reason', async () => {
  const store = await storeWithDevice();
  const out = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl: fakeEkopay({ payStatus: 400 }) });

  assert.equal(out.status, 502);
  assert.match(out.body.error, /already used/);
  assert.equal(out.body.payment.status, 'failed');
  assert.equal(out.body.payment.provider_confirmed, false);
  assert.equal(out.body.payment.reason, 'REFERENCE_EXISTS');
  assert.ok(out.body.payment.provider_ref, 'the reference is kept, so the attempt is traceable at Ekorana');

  const [row] = await store.listPayments();
  assert.equal(row.status, 'failed');
});

/* ------------------------------------------------------------------ */
/* INVARIANT: only the gateway's own answer decides. Silence does not.  */
/* ------------------------------------------------------------------ */

test('a request the gateway never answered leaves the payment PENDING, and the gateway still settles it', async () => {
  const store = await storeWithDevice();
  const bridge = fakeBridge();
  await store.upsertState(DEVICE, { deviceId: DEVICE, locked: true, lastSeenAt: Date.now() });
  const env = { ...ENV, EKOPAY_TIMEOUT_MS: '20' };

  const out = await createPaymentRequest({ store, body: BODY, env, fetchImpl: fakeEkopay({ initiate: 'timeout' }) });

  assert.equal(out.status, 202, 'accepted, but not confirmed');
  assert.equal(out.body.unconfirmed, true);
  assert.match(out.body.notice, /has not confirmed/);
  assert.equal(out.body.payment.status, 'pending', 'a timeout is not a refusal');
  assert.equal(out.body.payment.provider_confirmed, false);
  assert.equal(out.body.payment.reason, 'TIMEOUT');
  assert.ok(out.body.payment.provider_ref, 'the reference is kept, so the gateway can still be asked');
  assert.equal(bridge.published.length, 0, 'nothing unlocks on a request we did not hear about');

  // The gateway had it all along: the prompt went out, the farmer approved it.
  const confirmed = await refreshPayment({
    store, bridge, paymentId: out.body.payment.id, env, force: true, now: laterThan(out.body.payment),
    fetchImpl: fakeEkopay({ verify: { status: 'success', statusCode: 200, amount: 12_000 } }),
  });
  assert.equal(confirmed.body.confirmed, true);
  assert.equal(confirmed.body.payment.status, 'successful');
  assert.equal(confirmed.body.device_unlock.sent, true);
  assert.equal(bridge.published.length, 1, 'the farmer who paid is unlocked after all');
});

test('a gateway that breaks — 5xx — is not a refusal either', async () => {
  const store = await storeWithDevice();
  const out = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl: fakeEkopay({ payStatus: 503 }) });
  assert.equal(out.status, 202);
  assert.equal(out.body.payment.status, 'pending');
  assert.equal(out.body.payment.reason, 'REQUEST_FAILED');
});

test('a request that never reached the gateway is not a refusal either', async () => {
  const store = await storeWithDevice();
  const out = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl: fakeEkopay({ initiate: 'network' }) });
  assert.equal(out.status, 202);
  assert.equal(out.body.payment.status, 'pending');
  assert.equal(out.body.payment.reason, 'NETWORK');
});

test('a payment already recorded failed for want of an answer is still settled by the gateway', async () => {
  const store = await storeWithDevice();
  const bridge = fakeBridge();
  const created = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl: fakeEkopay() });
  const id = created.body.payment.id;

  // The shape of the RWF 25,000 payment collected on 14 Sept 2026 at 16:27 UTC:
  // recorded failed/TIMEOUT one second before the gateway created the
  // transaction, and never asked about again.
  await store.updatePayment(id, { status: 'failed', provider_confirmed: false, reason: 'TIMEOUT' });
  assert.equal((await store.getPayment(id)).status, 'failed');

  const out = await refreshPayment({
    store, bridge, paymentId: id, env: ENV, force: true, now: laterThan(created.body.payment),
    fetchImpl: fakeEkopay({ verify: { status: 'success', statusCode: 200, amount: 12_000 } }),
  });
  assert.equal(out.body.confirmed, true);
  assert.equal(out.body.payment.status, 'successful');
  assert.equal(out.body.device_unlock.sent, true);
});

test('a payment the gateway REFUSED is not re-opened by a later status read', async () => {
  const store = await storeWithDevice();
  const bridge = fakeBridge();
  const created = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl: fakeEkopay() });
  const id = created.body.payment.id;

  // The gateway itself said no — or our own validation stopped it before it
  // left. Either way nothing was collected, and it is history.
  await store.updatePayment(id, { status: 'failed', provider_confirmed: false, reason: 'INVALID_PHONE' });
  const forbidden = () => { throw new Error('a payment the gateway refused must not be re-checked'); };

  const out = await refreshPayment({ store, bridge, paymentId: id, env: ENV, force: true, fetchImpl: forbidden });
  assert.equal(out.body.refreshed, false);
  assert.equal(out.body.payment.status, 'failed');
  assert.equal(bridge.published.length, 0);
});

/* ------------------------------------------------------------------ */
/* INVARIANT: only the provider confirms, and only for the right amount */
/* ------------------------------------------------------------------ */

test('a confirmed payment activates and unlocks the unit exactly once', async () => {
  const store = await storeWithDevice();
  const bridge = fakeBridge();
  const created = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl: fakeEkopay() });
  const id = created.body.payment.id;

  // the device is locked (subscription lapsed) and reports so
  await store.upsertState(DEVICE, { deviceId: DEVICE, locked: true, lastSeenAt: Date.now() });

  const verified = await refreshPayment({
    store,
    bridge,
    paymentId: id,
    env: ENV,
    now: laterThan(created.body.payment),
    fetchImpl: fakeEkopay({ verify: { status: 'success', statusCode: 200, amount: 12_000 } }),
  });

  assert.equal(verified.status, 200);
  assert.equal(verified.body.confirmed, true);
  assert.equal(verified.body.payment.status, 'successful');
  assert.equal(verified.body.payment.provider_confirmed, true);
  assert.equal(verified.body.payment.financial_transaction_id, 'EK-TX-1');
  assert.equal(verified.body.payment.confirmed_at !== null, true);
  assert.equal(verified.body.device_unlock.sent, true);
  assert.deepEqual(bridge.published, [{ topic: `BROODIINNOX/${DEVICE}/control/device_active`, payload: 'ACTIVE' }]);

  // asking again changes nothing and sends nothing: a settled payment is history
  const forbiddenFetch = () => {
    throw new Error('a settled payment must not be re-checked with the gateway');
  };
  const again = await refreshPayment({
    store, bridge, paymentId: id, env: ENV, force: true, fetchImpl: forbiddenFetch,
  });
  assert.equal(again.body.refreshed, false);
  assert.equal(again.body.payment.status, 'successful');
  assert.equal(bridge.published.length, 1);
});

test('an amount that is not the amount asked for does not confirm and does not unlock', async () => {
  const store = await storeWithDevice();
  const bridge = fakeBridge();
  const created = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl: fakeEkopay() });

  const out = await refreshPayment({
    store, bridge, paymentId: created.body.payment.id, env: ENV, now: laterThan(created.body.payment),
    fetchImpl: fakeEkopay({ verify: { status: 'success', statusCode: 200, amount: 500 } }),
  });

  assert.equal(out.body.confirmed, false);
  assert.equal(out.body.payment.status, 'failed');
  assert.equal(out.body.payment.provider_confirmed, false);
  assert.equal(out.body.payment.reason, 'AMOUNT_MISMATCH');
  assert.equal(bridge.published.length, 0, 'the unit must stay locked');
});

test('a failed payment stays failed and unlocks nothing', async () => {
  const store = await storeWithDevice();
  const bridge = fakeBridge();
  const created = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl: fakeEkopay() });

  const out = await refreshPayment({
    store, bridge, paymentId: created.body.payment.id, env: ENV, now: laterThan(created.body.payment),
    fetchImpl: fakeEkopay({ verify: { status: 'failed', message: 'Payment failed' } }),
  });
  assert.equal(out.body.payment.status, 'failed');
  assert.equal(out.body.payment.reason, 'Payment failed');
  assert.equal(out.body.confirmed, false);
  assert.equal(bridge.published.length, 0);
});

test('status checks are throttled, and a farmer pressing "check" forces one', async () => {
  const store = await storeWithDevice();
  const created = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl: fakeEkopay() });
  const id = created.body.payment.id;
  const t0 = created.body.payment.created_at;
  const fetchImpl = fakeEkopay({ verify: { status: 'pending' } });

  const first = await refreshPayment({ store, paymentId: id, env: ENV, fetchImpl, now: laterThan({ created_at: t0 }, 6_000) });
  assert.equal(first.body.refreshed, true);
  assert.equal(fetchImpl.calls.status, 1);

  const soon = await refreshPayment({ store, paymentId: id, env: ENV, fetchImpl, now: laterThan({ created_at: t0 }, 7_000) });
  assert.equal(soon.body.refreshed, false);
  assert.equal(fetchImpl.calls.status, 1, 'the gateway is not hammered');

  const forced = await refreshPayment({ store, paymentId: id, env: ENV, fetchImpl, force: true, now: laterThan({ created_at: t0 }, 7_000) });
  assert.equal(forced.body.refreshed, true);
  assert.equal(fetchImpl.calls.status, 2);
});

test('a payment with no gateway reference yet cannot be polled', async () => {
  const store = await storeWithDevice();
  const row = await store.createPayment({
    id: 'pay_noref', device_id: DEVICE, amount: 12_000, currency: 'RWF', phone: '250788123456',
    status: 'pending', provider_confirmed: false, provider_ref: null, created_at: new Date().toISOString(),
  });
  const out = await refreshPayment({ store, paymentId: row.id, env: ENV, fetchImpl: fakeEkopay(), force: true });
  assert.equal(out.status, 409);
  assert.match(out.body.error, /no Ekorana reference/);
});

test('a gateway that cannot be reached leaves the payment pending, not failed', async () => {
  const store = await storeWithDevice();
  const created = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl: fakeEkopay() });
  const broken = async () => ({ ok: false, status: 503, text: async () => JSON.stringify({ error: 'down' }) });

  const out = await refreshPayment({ store, paymentId: created.body.payment.id, env: ENV, fetchImpl: broken, force: true, now: laterThan(created.body.payment) });
  assert.equal(out.status, 502);
  assert.equal(out.body.payment.status, 'pending');
  assert.match(out.body.error, /temporarily unavailable/);
});

/* ------------------------------------------------------------------ */
/* The Ekorana callback                                                */
/* ------------------------------------------------------------------ */

test('a forged callback cannot confirm a payment: the gateway is asked again', async () => {
  const store = await storeWithDevice();
  const bridge = fakeBridge();
  const created = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl: fakeEkopay() });
  const id = created.body.payment.id;

  // someone posts "success" for our reference; Ekorana itself still says pending
  const out = await handleEkopayCallback({
    store,
    bridge,
    body: { referenceId: id, status: 'success', statusCode: 200, amount: 12_000 },
    env: ENV,
    fetchImpl: fakeEkopay({ verify: { status: 'pending' } }),
  });

  assert.equal(out.status, 200);
  assert.equal(out.body.verified, true);
  assert.equal(out.body.confirmed, false);
  const stored = await store.getPayment(id);
  assert.equal(stored.status, 'pending');
  assert.equal(stored.provider_confirmed, false);
  assert.equal(bridge.published.length, 0, 'a forged callback must not unlock a unit');
});

test('a real callback re-verifies with the gateway, then confirms and unlocks', async () => {
  const store = await storeWithDevice();
  const bridge = fakeBridge();
  const created = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl: fakeEkopay() });
  const ref = created.body.payment.provider_ref;

  const out = await handleEkopayCallback({
    store,
    bridge,
    body: { referenceId: created.body.payment.id, status: 'success', statusCode: 200, amount: 12_000, message: 'Payment completed successfully' },
    env: ENV,
    fetchImpl: fakeEkopay({ verify: { status: 'success', statusCode: 200, amount: 12_000 } }),
  });

  assert.equal(out.body.confirmed, true);
  assert.equal(out.body.payment.status, 'successful');
  assert.equal(out.body.device_unlock.sent, true);
  // resolvable by the reference alone too (it can be the callback URL's last segment)
  assert.equal((await handleEkopayCallback({ store, bridge, reference: ref, env: ENV, fetchImpl: fakeEkopay() })).body.payment.status, 'successful');
});

test('a callback for a reference we do not know is refused', async () => {
  const store = await storeWithDevice();
  const out = await handleEkopayCallback({ store, body: { referenceId: 'pay_nope', status: 'success' }, env: ENV, fetchImpl: fakeEkopay() });
  assert.equal(out.status, 404);
  assert.match(out.body.error, /Unknown Ekorana reference/);
});

test('a repeat of a callback — the gateway retrying — never rewrites the payment', async () => {
  const store = await storeWithDevice();
  const bridge = fakeBridge();
  await store.upsertState(DEVICE, { deviceId: DEVICE, locked: true, lastSeenAt: Date.now() });
  const created = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl: fakeEkopay() });
  const cb = { referenceId: created.body.payment.id, status: 'success', statusCode: 200, amount: 12_000 };
  const confirm = fakeEkopay({ verify: { status: 'success', statusCode: 200, amount: 12_000 } });

  const first = await handleEkopayCallback({ store, bridge, body: cb, env: ENV, fetchImpl: confirm });
  assert.equal(first.body.confirmed, true);
  assert.equal(first.body.device_unlock.sent, true);
  const settled = await store.getPayment(created.body.payment.id);

  // The unit that was just unlocked reports so, as a real one does on its next
  // heartbeat — and then Ekorana retries the callback.
  await store.upsertState(DEVICE, { deviceId: DEVICE, locked: false, lastSeenAt: Date.now() });
  const retry = await handleEkopayCallback({ store, bridge, body: cb, env: ENV, fetchImpl: confirm });

  assert.equal(retry.body.confirmed, true);
  assert.equal(retry.body.payment.status, 'successful');
  assert.equal(retry.body.device_unlock.sent, false, 'a unit that is already unlocked is left alone');
  assert.equal(retry.body.device_unlock.reason, 'device already unlocked');
  assert.equal(bridge.published.length, 1, 'a command is published once, not once per retry');
  assert.deepEqual(await store.getPayment(created.body.payment.id), settled, 'a settled payment is never rewritten by a retry');
});

/* ------------------------------------------------------------------ */
/* FUNCTIONAL: it runs on the store the server uses                    */
/* ------------------------------------------------------------------ */

test('the whole flow reads back through the store as the dashboard sees it', async () => {
  const store = await storeWithDevice();
  const created = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl: fakeEkopay() });

  const listed = (await store.listPayments({ deviceId: DEVICE })).map(publicPayment);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, created.body.payment.id);
  assert.equal(listed[0].phone, '250788123456');
  assert.equal(listed[0].status, 'pending');
  assert.equal(listed[0].method, 'MTN MoMo');

  const one = publicPayment(await store.getPayment(created.body.payment.id));
  assert.deepEqual(one, listed[0]);
  assert.equal(publicPayment(await store.getPayment('pay_missing')), null);
});

/* ------------------------------------------------------------------ */
/* The callback log: an absent line means Ekorana did not call          */
/* ------------------------------------------------------------------ */

/**
 * The exact shape of a callback log line — fixed fields, one line, no free
 * text. Asserting the shape rather than a sample is what makes it a guarantee:
 * a body, a gateway message or a URL could not fit this pattern.
 */
const CALLBACK_LINE = /^\[ekopay\] callback event=[a-z-]+ http=\d{3} ref=\S+ payment=\S+ payment_status=\S+( reason=\S+)?( confirmed=(true|false))?$/;

/** Capture what the callback logs, and hand back the callback lines only. */
function captureCallbackLogs(t) {
  const lines = [];
  t.mock.method(console, 'log', (...args) => { lines.push(args.map(String).join(' ')); });
  return () => lines.filter((l) => l.startsWith('[ekopay] callback'));
}

test('every callback is logged exactly once, refusal and success alike', async (t) => {
  const store = await storeWithDevice();
  const bridge = fakeBridge();
  const created = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl: fakeEkopay() });
  const id = created.body.payment.id;
  const logs = captureCallbackLogs(t);

  // Creating the payment is not a callback and must not be logged as one.
  assert.equal(logs().length, 0);

  const unknown = await handleEkopayCallback({ store, bridge, body: { referenceId: 'pay_nope' }, env: ENV, fetchImpl: fakeEkopay() });
  assert.equal(unknown.status, 404);
  assert.equal(logs().length, 1);

  const unconfigured = await handleEkopayCallback({ store, bridge, body: { referenceId: id }, env: {}, fetchImpl: fakeEkopay() });
  assert.equal(unconfigured.status, 202);
  assert.equal(logs().length, 2);

  const broken = async () => ({ ok: false, status: 503, text: async () => JSON.stringify({ error: 'down' }) });
  const unverified = await handleEkopayCallback({ store, bridge, body: { referenceId: id }, env: ENV, fetchImpl: broken });
  assert.equal(unverified.status, 202);
  assert.equal(logs().length, 3);

  const verified = await handleEkopayCallback({
    store, bridge, body: { referenceId: id }, env: ENV,
    fetchImpl: fakeEkopay({ verify: { status: 'success', statusCode: 200, amount: 12_000 } }),
  });
  assert.equal(verified.status, 200);
  assert.equal(logs().length, 4);

  const lines = logs();
  for (const line of lines) assert.match(line, CALLBACK_LINE, `unexpected log line: ${line}`);
  assert.match(lines[0], /event=unknown-reference http=404/);
  assert.match(lines[1], /event=unconfigured http=202/);
  assert.match(lines[2], /event=verify-failed http=202/);
  assert.match(lines[3], /event=verified http=200/);
  assert.match(lines[3], new RegExp(`payment=${id} payment_status=successful confirmed=true`));
});

test('a callback with no usable body still leaves exactly one line', async (t) => {
  const store = await storeWithDevice();
  const logs = captureCallbackLogs(t);

  // Nothing a caller can send — or fail to send — may make a callback silent.
  const bodies = [null, {}, { referenceId: 42 }, { referenceId: '   ' }, { reference: { nested: true } }, 'not json at all'];
  for (const body of bodies) {
    const out = await handleEkopayCallback({ store, bridge: fakeBridge(), body, env: ENV, fetchImpl: fakeEkopay() });
    assert.equal(out.status, 404);
  }

  const lines = logs();
  assert.equal(lines.length, bodies.length, 'one line per callback, body or no body');
  for (const line of lines) {
    assert.match(line, CALLBACK_LINE);
    assert.match(line, /ref=-/, 'a unusable reference is shown as absent, never dropped');
  }
});

test('the callback log carries fixed fields only — never the key, never gateway text', async (t) => {
  const store = await storeWithDevice();
  const secret = 'Prod_KEY_SHAPED_LIKE_THE_REAL_ONE';
  const env = { ...ENV, EKOPAY_API_KEY: secret };
  const created = await createPaymentRequest({ store, body: BODY, env, fetchImpl: fakeEkopay() });
  const logs = captureCallbackLogs(t);

  // The worst case for a leak: the gateway hands back a message containing the
  // key it was sent. The key travels as a query parameter, so echoing anything
  // the gateway said is a real risk — and the reason we log is a code of ours.
  const leaky = async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: `Invalid API key: ${secret}` }) });
  const out = await handleEkopayCallback({
    store, bridge: fakeBridge(), body: { referenceId: created.body.payment.id }, env, fetchImpl: leaky,
  });

  assert.equal(out.status, 202);
  const lines = logs();
  assert.equal(lines.length, 1);
  assert.match(lines[0], CALLBACK_LINE);
  assert.match(lines[0], /reason=\S+/);
  assert.ok(!lines[0].includes(secret), 'the API key must never reach the log');
  assert.ok(!lines[0].includes('Invalid API key'), 'gateway free text must never reach the log');
});
