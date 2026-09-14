/**
 * The payment flow against a real (in-memory) store and a fake MoMo — the
 * whole journey a farmer takes, plus the two ways it can go wrong for them.
 *
 *   INVARIANT   nothing a client sends can confirm a payment: only a status
 *               answer from MoMo can, and only when the amount and currency
 *               collected match what was requested. A unit is unlocked exactly
 *               once, and only for a confirmed payment.
 *   BEHAVIOURAL a request sends one prompt to the number the farmer typed; a
 *               second tap reuses it instead of charging twice; a rejected
 *               request is recorded with its reference and reports why.
 *   FUNCTIONAL  the flow runs end to end on the store the server really uses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../lib/store.js';
import { publicPayment } from '../lib/payments.js';
import { createPaymentRequest, handleMomoCallback, refreshPayment } from '../lib/paymentFlow.js';

const ENV = {
  MOMO_SUBSCRIPTION_KEY: 'sub-key',
  MOMO_API_USER: 'user-uuid',
  MOMO_API_KEY: 'api-key',
  MOMO_BASE_URL: 'https://momo.test',
  MOMO_TARGET_ENVIRONMENT: 'sandbox',
  MOMO_CURRENCY: 'RWF',
};
const DEVICE = 'BROODIINNOX-002';
const BODY = { device_id: DEVICE, farmer_id: 'f1', plan_id: 't30d', band_id: 'b5', amount: 12_000, phone: '0788123456' };

/** A fake MTN MoMo. `verify` is what the status endpoint will answer. */
function fakeMoMo({ verify = { status: 'PENDING' }, payStatus = 202 } = {}) {
  const calls = { token: 0, pay: 0, status: 0 };
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url);
    const body = opts.body ? JSON.parse(opts.body) : null;
    const ok = (status, payload) => ({ ok: status < 300, status, text: async () => (payload === undefined ? '' : JSON.stringify(payload)) });
    if (u.endsWith('/collection/token/')) {
      calls.token += 1;
      return ok(200, { access_token: 'tok-1', expires_in: 3600 });
    }
    if (u.endsWith('/collection/v1_0/requesttopay')) {
      calls.pay += 1;
      calls.payBody = body;
      calls.payHeaders = opts.headers;
      return ok(payStatus, payStatus === 202 ? '' : { error: 'nope' });
    }
    if (u.includes('/collection/v1_0/requesttopay/')) {
      calls.status += 1;
      return ok(200, typeof verify === 'function' ? verify() : verify);
    }
    return ok(404, { error: 'unknown path' });
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
 * A moment after a payment was created, for the calls that talk to the provider.
 * Status checks are throttled, so a test that wants a check has to happen later
 * than the payment did — and it is measured from the payment itself, so the
 * machine's clock never matters.
 */
const laterThan = (payment, ms = 6_000) => new Date(Date.parse(payment.created_at) + ms).toISOString();

/* ------------------------------------------------------------------ */
/* Requesting a payment                                                */
/* ------------------------------------------------------------------ */

test('an unconfigured server says so, names the missing env vars, and charges nothing', async () => {
  const store = await storeWithDevice();
  const fetchImpl = fakeMoMo();
  const out = await createPaymentRequest({ store, body: BODY, env: {}, fetchImpl });

  assert.equal(out.status, 503);
  assert.match(out.body.error, /MOMO_SUBSCRIPTION_KEY/);
  assert.equal(out.body.momo.enabled, false);
  assert.equal(fetchImpl.calls.token + fetchImpl.calls.pay, 0, 'no provider call without credentials');
  assert.equal((await store.listPayments()).length, 0, 'no payment record without credentials');
});

test('an unpriced or unpayable request is refused before the provider is touched', async () => {
  const store = await storeWithDevice();
  const fetchImpl = fakeMoMo();

  const noAmount = await createPaymentRequest({ store, body: { ...BODY, amount: 0 }, env: ENV, fetchImpl });
  assert.equal(noAmount.status, 400);
  assert.match(noAmount.body.error, /whole number/);

  const noPhone = await createPaymentRequest({ store, body: { ...BODY, phone: 'nope' }, env: ENV, fetchImpl });
  assert.equal(noPhone.status, 400);
  assert.match(noPhone.body.error, /valid MTN MoMo number/);

  const unknown = await createPaymentRequest({ store, body: { ...BODY, device_id: 'BRD-NOPE' }, env: ENV, fetchImpl });
  assert.equal(unknown.status, 404);

  assert.equal(fetchImpl.calls.pay, 0);
  assert.equal((await store.listPayments()).length, 0);
});

test('a payment request sends MoMo the normalized number and exactly the amount asked', async () => {
  const store = await storeWithDevice();
  const bridge = fakeBridge();
  const fetchImpl = fakeMoMo();

  const out = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl });
  assert.equal(out.status, 201);
  assert.equal(out.body.payment.status, 'pending');
  assert.equal(out.body.payment.provider_confirmed, false);
  assert.ok(out.body.payment.provider_ref);
  assert.equal(out.body.payment.amount, 12_000);
  assert.equal(out.body.payment.phone, '250788123456');

  // what actually reached MTN
  assert.equal(fetchImpl.calls.token, 1);
  assert.equal(fetchImpl.calls.pay, 1);
  assert.equal(fetchImpl.calls.payBody.amount, '12000');
  assert.equal(fetchImpl.calls.payBody.currency, 'RWF');
  assert.equal(fetchImpl.calls.payBody.payer.partyId, '250788123456');
  assert.equal(fetchImpl.calls.payBody.payer.partyIdType, 'MSISDN');
  assert.equal(fetchImpl.calls.payHeaders['X-Reference-Id'], out.body.payment.provider_ref);
  assert.equal(fetchImpl.calls.payHeaders['X-Target-Environment'], 'sandbox');

  // and what the app is told: pending, so nothing unlocks yet
  const refreshed = await refreshPayment({
    store, bridge, paymentId: out.body.payment.id, env: ENV, fetchImpl: fakeMoMo(),
    now: laterThan(out.body.payment),
  });
  assert.equal(refreshed.body.payment.status, 'pending');
  assert.equal(bridge.published.length, 0);
});

test('tapping pay twice reuses the live prompt instead of prompting twice', async () => {
  const store = await storeWithDevice();
  const fetchImpl = fakeMoMo();

  const first = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl });
  const second = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl });

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.body.reused, true);
  assert.equal(second.body.payment.id, first.body.payment.id);
  assert.equal(fetchImpl.calls.pay, 1, 'the farmer must not be prompted twice');
  assert.equal((await store.listPayments()).length, 1);
});

test('a request MoMo refuses is recorded as a failed attempt, with the reason', async () => {
  const store = await storeWithDevice();
  const out = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl: fakeMoMo({ payStatus: 409 }) });

  assert.equal(out.status, 502);
  assert.match(out.body.error, /already used/);
  assert.equal(out.body.payment.status, 'failed');
  assert.equal(out.body.payment.provider_confirmed, false);
  assert.ok(out.body.payment.provider_ref, 'the reference is kept, so the attempt is traceable at MoMo');

  const [row] = await store.listPayments();
  assert.equal(row.status, 'failed');
});

/* ------------------------------------------------------------------ */
/* INVARIANT: only the provider confirms, and only for the right amount */
/* ------------------------------------------------------------------ */

test('a confirmed payment activates and unlocks the unit exactly once', async () => {
  const store = await storeWithDevice();
  const bridge = fakeBridge();
  const created = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl: fakeMoMo() });
  const id = created.body.payment.id;

  // the device is locked (subscription lapsed) and reports so
  await store.upsertState(DEVICE, { deviceId: DEVICE, locked: true, lastSeenAt: Date.now() });

  const verified = await refreshPayment({
    store,
    bridge,
    paymentId: id,
    env: ENV,
    now: laterThan(created.body.payment),
    fetchImpl: fakeMoMo({ verify: { status: 'SUCCESSFUL', amount: '12000', currency: 'RWF', financialTransactionId: 'FT-77' } }),
  });

  assert.equal(verified.status, 200);
  assert.equal(verified.body.confirmed, true);
  assert.equal(verified.body.payment.status, 'successful');
  assert.equal(verified.body.payment.provider_confirmed, true);
  assert.equal(verified.body.payment.financial_transaction_id, 'FT-77');
  assert.equal(verified.body.payment.confirmed_at !== null, true);
  assert.equal(verified.body.device_unlock.sent, true);
  assert.deepEqual(bridge.published, [{ topic: `BROODIINNOX/${DEVICE}/control/device_active`, payload: 'ACTIVE' }]);

  // asking again changes nothing and sends nothing: a settled payment is history
  const forbiddenFetch = () => {
    throw new Error('a settled payment must not be re-checked with the provider');
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
  const created = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl: fakeMoMo() });

  const out = await refreshPayment({
    store, bridge, paymentId: created.body.payment.id, env: ENV, now: laterThan(created.body.payment),
    fetchImpl: fakeMoMo({ verify: { status: 'SUCCESSFUL', amount: '500', currency: 'RWF', financialTransactionId: 'FT-1' } }),
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
  const created = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl: fakeMoMo() });

  const out = await refreshPayment({
    store, bridge, paymentId: created.body.payment.id, env: ENV, now: laterThan(created.body.payment),
    fetchImpl: fakeMoMo({ verify: { status: 'FAILED', reason: 'PAYER_NOT_FOUND' } }),
  });
  assert.equal(out.body.payment.status, 'failed');
  assert.equal(out.body.payment.reason, 'PAYER_NOT_FOUND');
  assert.equal(out.body.confirmed, false);
  assert.equal(bridge.published.length, 0);
});

test('status checks are throttled, and a farmer pressing "check" forces one', async () => {
  const store = await storeWithDevice();
  const created = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl: fakeMoMo() });
  const id = created.body.payment.id;
  const t0 = created.body.payment.created_at;
  const fetchImpl = fakeMoMo({ verify: { status: 'PENDING' } });

  const first = await refreshPayment({ store, paymentId: id, env: ENV, fetchImpl, now: laterThan({ created_at: t0 }, 6_000) });
  assert.equal(first.body.refreshed, true);
  assert.equal(fetchImpl.calls.status, 1);

  const soon = await refreshPayment({ store, paymentId: id, env: ENV, fetchImpl, now: laterThan({ created_at: t0 }, 7_000) });
  assert.equal(soon.body.refreshed, false);
  assert.equal(fetchImpl.calls.status, 1, 'the provider is not hammered');

  const forced = await refreshPayment({ store, paymentId: id, env: ENV, fetchImpl, force: true, now: laterThan({ created_at: t0 }, 7_000) });
  assert.equal(forced.body.refreshed, true);
  assert.equal(fetchImpl.calls.status, 2);
});

test('a provider that cannot be reached leaves the payment pending, not failed', async () => {
  const store = await storeWithDevice();
  const created = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl: fakeMoMo() });
  const broken = async (url) => {
    if (String(url).endsWith('/collection/token/')) return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 't', expires_in: 3600 }) };
    return { ok: false, status: 503, text: async () => JSON.stringify({ error: 'down' }) };
  };

  const out = await refreshPayment({ store, paymentId: created.body.payment.id, env: ENV, fetchImpl: broken, force: true, now: laterThan(created.body.payment) });
  assert.equal(out.status, 502);
  assert.equal(out.body.payment.status, 'pending');
  assert.match(out.body.error, /temporarily unavailable/);
});

/* ------------------------------------------------------------------ */
/* The MoMo callback                                                   */
/* ------------------------------------------------------------------ */

test('a forged callback cannot confirm a payment: the provider is asked again', async () => {
  const store = await storeWithDevice();
  const bridge = fakeBridge();
  const created = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl: fakeMoMo() });
  const id = created.body.payment.id;

  // someone posts "SUCCESSFUL" for our reference; MoMo itself still says PENDING
  const out = await handleMomoCallback({
    store,
    bridge,
    body: { externalId: id, status: 'SUCCESSFUL', financialTransactionId: 'FORGED' },
    env: ENV,
    fetchImpl: fakeMoMo({ verify: { status: 'PENDING' } }),
  });

  assert.equal(out.status, 200);
  assert.equal(out.body.verified, true);
  assert.equal(out.body.confirmed, false);
  const stored = await store.getPayment(id);
  assert.equal(stored.status, 'pending');
  assert.equal(stored.provider_confirmed, false);
  assert.equal(bridge.published.length, 0, 'a forged callback must not unlock a unit');
});

test('a real callback re-verifies with MoMo, then confirms and unlocks', async () => {
  const store = await storeWithDevice();
  const bridge = fakeBridge();
  const created = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl: fakeMoMo() });
  const ref = created.body.payment.provider_ref;

  const out = await handleMomoCallback({
    store,
    bridge,
    body: { status: 'SUCCESSFUL', externalId: created.body.payment.id, financialTransactionId: 'FT-9' },
    env: ENV,
    fetchImpl: fakeMoMo({ verify: { status: 'SUCCESSFUL', amount: 12000, currency: 'RWF', financialTransactionId: 'FT-9' } }),
  });

  assert.equal(out.body.confirmed, true);
  assert.equal(out.body.payment.status, 'successful');
  assert.equal(out.body.device_unlock.sent, true);
  // resolvable by the X-Reference-Id alone too (it can be the callback URL's last segment)
  assert.equal((await handleMomoCallback({ store, bridge, reference: ref, env: ENV, fetchImpl: fakeMoMo() })).body.payment.status, 'successful');
});

test('a callback for a reference we do not know is refused', async () => {
  const store = await storeWithDevice();
  const out = await handleMomoCallback({ store, body: { status: 'SUCCESSFUL', externalId: 'pay_nope' }, env: ENV, fetchImpl: fakeMoMo() });
  assert.equal(out.status, 404);
  assert.match(out.body.error, /Unknown MTN MoMo reference/);
});

/* ------------------------------------------------------------------ */
/* FUNCTIONAL: it runs on the store the server uses                    */
/* ------------------------------------------------------------------ */

test('the whole flow reads back through the store as the dashboard sees it', async () => {
  const store = await storeWithDevice();
  const created = await createPaymentRequest({ store, body: BODY, env: ENV, fetchImpl: fakeMoMo() });

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
