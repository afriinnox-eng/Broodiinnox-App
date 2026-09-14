/**
 * Payment records and the rules that decide whether money has arrived.
 *
 *   INVARIANT   a payment is confirmed only by the provider's own SUCCESSFUL
 *               answer, and only when the amount and currency collected are the
 *               ones requested; a settled payment is never rewritten; a unit is
 *               unlocked only after a confirmed payment, and only once.
 *   BEHAVIOURAL a second request while a prompt is live reuses the pending
 *               payment instead of prompting the farmer twice; a failed or
 *               still-pending payment unlocks nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../lib/store.js';
import {
  MAX_AMOUNT, PAYMENT_STATUS, applyProviderStatus, buildPayment, failPayment,
  findReusablePending, isConfirmed, isPending, newPaymentId, paymentPatch,
  paymentTouched, providerAmountMatches, publicPayment, shouldPollStatus,
  unlockDeviceAfterPayment, validatePaymentInput,
} from '../lib/payments.js';

const NOW = '2026-09-20T10:00:00.000Z';
const at = (ms) => new Date(Date.parse(NOW) + ms).toISOString();

const REQUEST = { device_id: 'BROODIINNOX-002', farmer_id: 'f1', plan_id: 't30d', band_id: 'b5', amount: 12_000, phone: '0788123456' };

const pending = (over = {}) => ({
  ...buildPayment(validatePaymentInput(REQUEST).value, { id: 'pay_1', referenceId: 'ref-1', now: NOW }),
  ...over,
});

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

test('validatePaymentInput: a good request is normalized and priced as asked', () => {
  const out = validatePaymentInput(REQUEST, { currency: 'RWF', countryCode: '250' });
  assert.equal(out.ok, true);
  assert.deepEqual(out.value, {
    device_id: 'BROODIINNOX-002',
    farmer_id: 'f1',
    plan_id: 't30d',
    band_id: 'b5',
    amount: 12_000,
    currency: 'RWF',
    phone: '250788123456',
    method: 'MTN MoMo',
    payer_message: 'Broodiinnox subscription',
    payee_note: 'Broodiinnox subscription payment',
  });
});

test('validatePaymentInput: refuses an unpricesable request, whatever else is right', () => {
  const bad = (over, expect) => {
    const out = validatePaymentInput({ ...REQUEST, ...over });
    assert.equal(out.ok, false, `${JSON.stringify(over)} should be refused`);
    assert.match(out.error, expect);
    assert.equal(out.value, null);
  };
  bad({ device_id: '../etc/passwd' }, /Invalid device_id/);
  bad({ device_id: '' }, /Invalid device_id/);
  bad({ amount: 0 }, /whole number/);
  bad({ amount: -12000 }, /whole number/);
  bad({ amount: 12.5 }, /whole number/);
  bad({ amount: 'twelve thousand' }, /whole number/);
  bad({ amount: MAX_AMOUNT + 1 }, /whole number/);
  bad({ amount: null }, /whole number/);
  bad({ phone: 'not-a-number' }, /valid MTN MoMo number/);
  bad({ currency: 'RWFX' }, /Invalid currency/);
});

test('buildPayment: a new payment starts pending and unconfirmed', () => {
  const row = buildPayment(validatePaymentInput(REQUEST).value, { id: 'pay_x', referenceId: 'ref-x', now: NOW });
  assert.equal(row.status, PAYMENT_STATUS.PENDING);
  assert.equal(row.provider_confirmed, false);
  assert.equal(row.provider_ref, 'ref-x');
  assert.equal(row.created_at, NOW);
  assert.equal(row.confirmed_at, null);
  assert.equal(row.amount, 12_000);
  assert.match(newPaymentId(), /^pay_/);
});

/* ------------------------------------------------------------------ */
/* Double-tap protection                                               */
/* ------------------------------------------------------------------ */

test('findReusablePending: a live prompt is reused, an old one is not', () => {
  const list = [pending({ id: 'pay_old', created_at: '2026-09-20T09:50:00.000Z', provider_ref: 'ref-old' })];
  assert.equal(findReusablePending(list, { device_id: 'BROODIINNOX-002' }, NOW), null, 'a 10-minute-old prompt is stale');

  const fresh = [pending()];
  assert.equal(findReusablePending(fresh, { device_id: 'BROODIINNOX-002' }, NOW)?.id, 'pay_1');
  assert.equal(findReusablePending(fresh, { device_id: 'BROODIINNOX-002' }, at(60_000))?.id, 'pay_1');
  assert.equal(findReusablePending(fresh, { device_id: 'BROODIINNOX-002' }, at(120_001)), null);
});

test('findReusablePending: nothing to reuse without a reference, another device, or a settled payment', () => {
  assert.equal(findReusablePending([pending({ provider_ref: null })], { device_id: 'BROODIINNOX-002' }, NOW), null);
  assert.equal(findReusablePending([pending()], { device_id: 'BROODIINNOX-003' }, NOW), null);
  assert.equal(findReusablePending([pending({ status: PAYMENT_STATUS.SUCCESSFUL })], { device_id: 'BROODIINNOX-002' }, NOW), null);
  assert.equal(findReusablePending([pending({ status: PAYMENT_STATUS.FAILED })], { device_id: 'BROODIINNOX-002' }, NOW), null);
  assert.equal(findReusablePending([pending({ farmer_id: 'f2' })], { device_id: 'BROODIINNOX-002', farmer_id: 'f1' }, NOW), null);
  assert.equal(findReusablePending([], { device_id: 'BROODIINNOX-002' }, NOW), null);
});

/* ------------------------------------------------------------------ */
/* INVARIANT: only the provider confirms                               */
/* ------------------------------------------------------------------ */

test('applyProviderStatus: SUCCESSFUL confirms, and records the MTN transaction', () => {
  const { payment, confirmed, changed } = applyProviderStatus(pending(), { status: 'successful', financialTransactionId: 'FT1', amount: '12000', currency: 'RWF' }, at(5_000));
  assert.equal(confirmed, true);
  assert.equal(changed, true);
  assert.equal(payment.status, PAYMENT_STATUS.SUCCESSFUL);
  assert.equal(payment.provider_confirmed, true);
  assert.equal(payment.financial_tx_id, 'FT1');
  assert.equal(payment.confirmed_at, at(5_000));
  assert.equal(isConfirmed(payment), true);
});

test('applyProviderStatus: a paid amount that is not the amount asked for is never a success', () => {
  const short = applyProviderStatus(pending(), { status: 'successful', amount: '100', currency: 'RWF' }, at(5_000));
  assert.equal(short.confirmed, false);
  assert.equal(short.payment.status, PAYMENT_STATUS.FAILED);
  assert.equal(short.payment.reason, 'AMOUNT_MISMATCH');
  assert.equal(isConfirmed(short.payment), false);

  const currency = applyProviderStatus(pending(), { status: 'successful', amount: '12000', currency: 'UGX' }, at(5_000));
  assert.equal(currency.confirmed, false);
  assert.equal(currency.payment.reason, 'AMOUNT_MISMATCH');

  // an amount we cannot read is not a pass either
  const junk = applyProviderStatus(pending(), { status: 'successful', amount: 'twelve thousand' }, at(5_000));
  assert.equal(junk.confirmed, false);
  assert.equal(junk.payment.reason, 'AMOUNT_MISMATCH');
});

test('providerAmountMatches: absent is trusted, present must be exact', () => {
  const payment = pending();
  assert.equal(providerAmountMatches(payment, { status: 'successful' }), true, 'no amount reported');
  assert.equal(providerAmountMatches(payment, { amount: '12000', currency: 'RWF' }), true);
  assert.equal(providerAmountMatches(payment, { amount: 12_000, currency: 'rwf' }), true);
  assert.equal(providerAmountMatches(payment, { amount: '12001' }), false);
  assert.equal(providerAmountMatches(payment, { amount: 100 }), false);
  assert.equal(providerAmountMatches(payment, { amount: '' }), true, 'an empty field is not a reported amount');
  assert.equal(providerAmountMatches(payment, { amount: null }), true);
  assert.equal(providerAmountMatches(payment, { currency: 'UGX' }), false);
});

test('applyProviderStatus: failed and pending stay unconfirmed', () => {
  const failed = applyProviderStatus(pending(), { status: 'failed', reason: 'PAYER_NOT_FOUND' }, at(5_000));
  assert.equal(failed.payment.status, PAYMENT_STATUS.FAILED);
  assert.equal(failed.payment.provider_confirmed, false);
  assert.equal(failed.payment.reason, 'PAYER_NOT_FOUND');

  const still = applyProviderStatus(pending(), { status: 'pending' }, at(5_000));
  assert.equal(still.payment.status, PAYMENT_STATUS.PENDING);
  assert.equal(still.confirmed, false);
  assert.equal(still.payment.status_checked_at, at(5_000));
});

test('applyProviderStatus: a settled payment is history and is never rewritten', () => {
  const failed = failPayment(pending(), 'REQUEST_FAILED', NOW);
  const again = applyProviderStatus(failed, { status: 'successful', amount: '12000', currency: 'RWF' }, at(9_000));
  assert.equal(again.changed, false);
  assert.equal(again.confirmed, false);
  assert.equal(again.payment.status, PAYMENT_STATUS.FAILED);
  assert.equal(again.payment.status, failed.status);
});

test('paymentPatch moves only the mutable columns', () => {
  const applied = applyProviderStatus(pending(), { status: 'successful', amount: '12000', currency: 'RWF' }, at(5_000)).payment;
  const patch = paymentPatch({ ...applied, _seq: 3 });
  assert.deepEqual(Object.keys(patch).sort(), [
    'confirmed_at', 'financial_tx_id', 'provider_confirmed', 'provider_ref',
    'reason', 'status', 'status_checked_at', 'updated_at',
  ]);
  // and never the things that must not change under a status update
  for (const k of ['id', 'device_id', 'amount', 'phone', 'currency', 'created_at']) {
    assert.equal(patch[k], undefined, `${k} must not be patched`);
  }
});

test('shouldPollStatus: only a pending payment with a reference, once per interval', () => {
  assert.equal(shouldPollStatus(pending({ status_checked_at: NOW }), at(1_000)), false);
  assert.equal(shouldPollStatus(pending({ status_checked_at: NOW }), at(5_000)), true);
  assert.equal(shouldPollStatus(pending({ provider_ref: null }), at(60_000)), false);
  assert.equal(shouldPollStatus(pending({ status: PAYMENT_STATUS.SUCCESSFUL }), at(60_000)), false);
  assert.equal(isPending(pending()), true);
});

test('publicPayment: the dashboard shape, with no internal columns', () => {
  const out = publicPayment({ ...pending(), _seq: 1 });
  assert.equal(out.provider_ref, 'ref-1');
  assert.equal(out.currency, 'RWF');
  assert.equal(out.provider_confirmed, false);
  assert.equal(out.amount, 12_000);
  assert.equal(out._seq, undefined);
  assert.equal(publicPayment(null), null);
});

test('paymentTouched: a provider that did not answer moves the clock, not the status', () => {
  const touched = paymentTouched(pending(), at(7_000));
  assert.equal(touched.status, PAYMENT_STATUS.PENDING);
  assert.equal(touched.status_checked_at, at(7_000));
});

/* ------------------------------------------------------------------ */
/* Unlocking the hardware                                              */
/* ------------------------------------------------------------------ */

function fakeBridge(behaviour = 'ok') {
  const published = [];
  return {
    published,
    async publish(topic, payload) {
      if (behaviour === 'down') throw new Error('MQTT not connected');
      published.push({ topic, payload });
    },
  };
}

test('unlockDeviceAfterPayment: a confirmed payment sends device_active=ACTIVE and audits it', async () => {
  const store = new MemoryStore();
  const bridge = fakeBridge();
  const out = await unlockDeviceAfterPayment({
    store,
    bridge,
    prefix: 'BROODIINNOX',
    payment: pending(),
    device: { device_id: 'BROODIINNOX-002', device_locked: true },
  });

  assert.equal(out.sent, true);
  assert.equal(out.topic, 'BROODIINNOX/BROODIINNOX-002/control/device_active');
  assert.equal(out.payload, 'ACTIVE');
  assert.deepEqual(bridge.published, [{ topic: out.topic, payload: 'ACTIVE' }]);

  const audit = await store.listAudit('BROODIINNOX-002');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].command, 'device_active');
  assert.equal(audit[0].published, true);
});

test('unlockDeviceAfterPayment: an already-unlocked unit is left alone', async () => {
  const bridge = fakeBridge();
  const out = await unlockDeviceAfterPayment({ bridge, payment: pending(), device: { device_locked: false } });
  assert.equal(out.sent, false);
  assert.equal(out.reason, 'device already unlocked');
  assert.equal(bridge.published.length, 0);
});

test('unlockDeviceAfterPayment: a bridge that is down never breaks the payment', async () => {
  const store = new MemoryStore();
  const out = await unlockDeviceAfterPayment({
    store,
    bridge: fakeBridge('down'),
    payment: pending(),
    device: { device_locked: true },
    log: { warn() {} },
  });
  assert.equal(out.sent, false);
  assert.match(out.error, /MQTT not connected/);
  const audit = await store.listAudit('BROODIINNOX-002');
  assert.equal(audit[0].published, false);
  assert.match(audit[0].error, /MQTT not connected/);
});
