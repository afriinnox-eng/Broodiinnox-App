/**
 * Ekorana Payment Gateway ("Ekopay") client — env config, MSISDN normalization,
 * the exact HTTP the gateway gets, and how its answers are read.
 *
 *   INVARIANT   credentials come from the environment only and are never
 *               echoed, in a warning or in an error; an MSISDN that is not this
 *               country's is refused before any request is made; an amount
 *               below the gateway's floor never leaves the server; a status we
 *               do not understand is PENDING (never a success).
 *   BEHAVIOURAL initiatePayment sends exactly one POST with the integer amount,
 *               the referenceId, the payer and the merchant number, and the key
 *               as the documented query parameter; getStatus maps
 *               success / failed / pending; provider errors become messages an
 *               operator can act on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EKOPAY_MIN_AMOUNT, EKOPAY_REQUIRED_ENV, EkopayError, createEkopayClient,
  describeEkopayConfig, ekopayErrorMessage, ekopayFailureReason, ekopayNotConfiguredMessage,
  ekopayReasonMessage, interpretEkopayStatus, newEkopayProbeReference, normalizeMsisdn,
  resolveEkopayConfig, verifyEkopayCredentials,
} from '../lib/ekopay.js';

const ENV = {
  EKOPAY_API_KEY: 'ekopay-key',
  EKOPAY_TRANSFER_PHONE: '0788765432',
  EKOPAY_BASE_URL: 'https://api.payment.ekorana.com/api/v1',
  EKOPAY_CURRENCY: 'RWF',
  EKOPAY_CALLBACK_URL: 'https://api.example.com/api/payments/ekopay/callback',
};

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

test('resolveEkopayConfig: unset => disabled, and it names what is missing', () => {
  const cfg = resolveEkopayConfig({});
  assert.equal(cfg.enabled, false);
  assert.deepEqual(cfg.missing, EKOPAY_REQUIRED_ENV);
  assert.deepEqual(cfg.invalid, []);
  assert.equal(cfg.baseUrl, 'https://api.payment.ekorana.com/api/v1');
  assert.equal(cfg.currency, 'RWF');
  assert.equal(cfg.countryCode, '250');
  assert.equal(cfg.minAmount, EKOPAY_MIN_AMOUNT);
  assert.equal(cfg.transferPhone, null);
});

test('resolveEkopayConfig: enabled only with the key and a usable merchant number', () => {
  const cfg = resolveEkopayConfig(ENV);
  assert.equal(cfg.enabled, true);
  assert.deepEqual(cfg.missing, []);
  assert.deepEqual(cfg.invalid, []);
  assert.equal(cfg.transferPhone, '250788765432', 'the merchant number is normalized to an MSISDN');
  for (const k of EKOPAY_REQUIRED_ENV) {
    const partial = { ...ENV };
    delete partial[k];
    const out = resolveEkopayConfig(partial);
    assert.equal(out.enabled, false, `${k} missing must disable payments`);
    assert.deepEqual(out.missing, [k]);
  }
});

test('resolveEkopayConfig: a value that is set but unusable is invalid, not missing', () => {
  const badUrl = resolveEkopayConfig({ ...ENV, EKOPAY_BASE_URL: 'not-a-url' });
  assert.equal(badUrl.enabled, false);
  assert.deepEqual(badUrl.missing, []);
  assert.deepEqual(badUrl.invalid, ['EKOPAY_BASE_URL']);

  const badPhone = resolveEkopayConfig({ ...ENV, EKOPAY_TRANSFER_PHONE: 'not-a-number' });
  assert.equal(badPhone.enabled, false);
  assert.deepEqual(badPhone.missing, []);
  assert.deepEqual(badPhone.invalid, ['EKOPAY_TRANSFER_PHONE']);

  // ... and whitespace is not a value at all
  const blank = resolveEkopayConfig({ ...ENV, EKOPAY_API_KEY: '   ', EKOPAY_TRANSFER_PHONE: '\t' });
  assert.equal(blank.enabled, false);
  assert.deepEqual(blank.missing, EKOPAY_REQUIRED_ENV);
});

test('resolveEkopayConfig: normalizes the base URL, currency and timeout', () => {
  const cfg = resolveEkopayConfig({ ...ENV, EKOPAY_BASE_URL: 'https://ekopay.example.com///', EKOPAY_CURRENCY: 'rwf' });
  assert.equal(cfg.baseUrl, 'https://ekopay.example.com');
  assert.equal(cfg.currency, 'RWF');
  assert.equal(resolveEkopayConfig({ ...ENV, EKOPAY_TIMEOUT_MS: '20' }).timeoutMs, 20);
  // below the gateway's own floor is not a configuration we will honour
  assert.equal(resolveEkopayConfig(ENV).minAmount, 50);
});

test('resolveEkopayConfig: the callback URL defaults to this deployment’s public callback', () => {
  const cfg = resolveEkopayConfig({ EKOPAY_API_KEY: ENV.EKOPAY_API_KEY, EKOPAY_TRANSFER_PHONE: ENV.EKOPAY_TRANSFER_PHONE });
  assert.equal(cfg.callbackUrl, 'https://broodiinnox-api.onrender.com/api/payments/ekopay/callback');
});

test('describeEkopayConfig never carries the API key or the merchant number', () => {
  const desc = describeEkopayConfig(resolveEkopayConfig(ENV));
  const json = JSON.stringify(desc);
  assert.equal(desc.enabled, true);
  assert.equal(desc.currency, 'RWF');
  assert.equal(desc.min_amount, 50);
  assert.equal(desc.transfer_phone_set, true);
  for (const secret of ['ekopay-key', '0788765432', '250788765432']) {
    assert.ok(!json.includes(secret), `config leaked ${secret}`);
  }
});

test('an unconfigured server says which env vars are still to be set', () => {
  const msg = ekopayNotConfiguredMessage(resolveEkopayConfig({}));
  for (const k of EKOPAY_REQUIRED_ENV) assert.ok(msg.includes(k), `message does not name ${k}`);
  assert.match(msg, /Render/);
  const unusable = ekopayNotConfiguredMessage(resolveEkopayConfig({ ...ENV, EKOPAY_TRANSFER_PHONE: 'nope' }));
  assert.match(unusable, /fix EKOPAY_TRANSFER_PHONE/);
});

/* ------------------------------------------------------------------ */
/* MSISDN normalization                                                */
/* ------------------------------------------------------------------ */

test('normalizeMsisdn: every way a Rwandan number is written lands on 250 + 9 digits', () => {
  const expected = '250788123456';
  for (const written of ['0788123456', '788123456', '250788123456', '+250788123456', '00250788123456', '0788 123 456', '0788-123-456', 788123456]) {
    assert.equal(normalizeMsisdn(written), expected, `${written} should normalize to ${expected}`);
  }
});

test('normalizeMsisdn: anything that cannot be an MSISDN is refused', () => {
  for (const bad of ['', '   ', 'not-a-number', '+250', '254712345678', '0712345', '078812345678901234', null, undefined, {}, '0788 123 45x']) {
    assert.equal(normalizeMsisdn(bad), null, `${JSON.stringify(bad)} should be refused`);
  }
  // a different country code is only accepted when the caller asks for it
  assert.equal(normalizeMsisdn('+254712345678'), null);
  assert.equal(normalizeMsisdn('+254712345678', '254'), '254712345678');
});

test('newEkopayProbeReference: a distinct reference that cannot belong to a payment', () => {
  const a = newEkopayProbeReference();
  const b = newEkopayProbeReference();
  assert.match(a, /^probe-/);
  assert.notEqual(a, b);
});

/* ------------------------------------------------------------------ */
/* The gateway's answer                                                */
/* ------------------------------------------------------------------ */

test('interpretEkopayStatus: success and failure only when the gateway says so', () => {
  assert.equal(interpretEkopayStatus({ status: 'success' }).status, 'successful');
  assert.equal(interpretEkopayStatus({ status: 'SUCCESS' }).status, 'successful');
  assert.equal(interpretEkopayStatus({ status: 'failed' }).status, 'failed');
  assert.equal(interpretEkopayStatus({ status: 'pending' }).status, 'pending');
  // an answer we do not understand must never move money or unlock a device
  assert.equal(interpretEkopayStatus({ status: 'WHATEVER' }).status, 'pending');
  assert.equal(interpretEkopayStatus({}).status, 'pending');
  assert.equal(interpretEkopayStatus(null).status, 'pending');
});

test('interpretEkopayStatus: a statusCode that is not 200 wins over the word "success"', () => {
  // The callback carries both. When they disagree, the one that says money did
  // NOT move is the one that decides.
  assert.equal(interpretEkopayStatus({ status: 'success', statusCode: 200 }).status, 'successful');
  assert.equal(interpretEkopayStatus({ status: 'success', statusCode: 500 }).status, 'failed');
  assert.equal(interpretEkopayStatus({ status: 'success', statusCode: 400 }).status, 'failed');
  assert.equal(interpretEkopayStatus({ status: 'failed', statusCode: 200 }).status, 'failed');
  assert.equal(interpretEkopayStatus({ status: 'pending', statusCode: 200 }).status, 'pending');
});

test('interpretEkopayStatus: what was collected travels with the verdict', () => {
  const ok = interpretEkopayStatus({ status: 'success', amount: 12000, phoneNumber: '250788123456', transactionId: 'EK-1' });
  assert.equal(ok.amount, 12000);
  assert.equal(ok.payer, '250788123456');
  assert.equal(ok.financialTransactionId, 'EK-1');
  const bare = interpretEkopayStatus({ status: 'success' });
  assert.equal(bare.amount, null);
  assert.equal(bare.currency, null, 'the gateway collects in RWF and reports no currency');
});

test('ekopayReasonMessage / ekopayErrorMessage: the gateway’s errors become sentences', () => {
  assert.match(ekopayReasonMessage('amount must be at least 50'), /minimum of 50 RWF/);
  assert.match(ekopayReasonMessage('referenceId already exists'), /already used/);
  assert.match(ekopayReasonMessage('Invalid phone number'), /not one the payment gateway can charge/);
  assert.match(ekopayReasonMessage('Invalid API key'), /EKOPAY_API_KEY/);
  assert.match(ekopayReasonMessage('API key is not active'), /not active/);
  assert.match(ekopayReasonMessage('Transaction not found'), /does not know this transaction/);
  assert.equal(ekopayReasonMessage('SOMETHING_NEW'), null);
  assert.equal(ekopayReasonMessage(''), null);

  assert.match(ekopayErrorMessage({ status: 401 }), /EKOPAY_API_KEY/);
  assert.match(ekopayErrorMessage({ status: 429 }), /rate-limiting/);
  assert.match(ekopayErrorMessage({ code: 'timeout' }), /did not answer in time/);
  assert.match(ekopayErrorMessage({ code: 'network' }), /Could not reach the payment gateway/);
  assert.match(ekopayErrorMessage({ status: 400, body: { error: 'Invalid phone number' } }), /not one the payment gateway can charge/);
});

test('ekopayFailureReason: the gateway’s own wording, as a code the dashboard can read', () => {
  assert.equal(ekopayFailureReason({ status: 400, body: { error: 'referenceId already exists' } }), 'REFERENCE_EXISTS');
  assert.equal(ekopayFailureReason({ status: 400, body: { error: 'amount must be at least 50' } }), 'AMOUNT_TOO_SMALL');
  assert.equal(ekopayFailureReason({ status: 400, body: { error: 'Invalid phone number' } }), 'INVALID_PHONE');
  assert.equal(ekopayFailureReason({ status: 401, body: { error: 'API key is not active' } }), 'API_KEY_INACTIVE');
  assert.equal(ekopayFailureReason({ status: 401, body: { error: 'Invalid API key' } }), 'INVALID_API_KEY');
  assert.equal(ekopayFailureReason({ code: 'timeout' }), 'TIMEOUT');
  assert.equal(ekopayFailureReason({ code: 'network' }), 'NETWORK');
  assert.equal(ekopayFailureReason({ code: 'not-configured' }), 'NOT_CONFIGURED');
  assert.equal(ekopayFailureReason({ code: 'invalid-phone' }), 'INVALID_PHONE');
  assert.equal(ekopayFailureReason({ status: 500 }), 'REQUEST_FAILED');
});

/* ------------------------------------------------------------------ */
/* The HTTP the gateway receives                                       */
/* ------------------------------------------------------------------ */

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const text = String(url);
    const parsed = new URL(text, 'https://api.payment.ekorana.com');
    const call = {
      url: text,
      path: parsed.pathname,
      apiKey: parsed.searchParams.get('apiKey'),
      method: opts.method || 'GET',
      headers: opts.headers || {},
      body: opts.body ? JSON.parse(opts.body) : null,
    };
    calls.push(call);
    const r = (await handler(call)) || {};
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status || 200,
      text: async () => (r.body === undefined || r.body === null ? '' : JSON.stringify(r.body)),
    };
  };
  fn.calls = calls;
  return fn;
}

const INITIATED = {
  status: 201,
  body: {
    transaction: {
      amount: 12000, referenceId: 'pay_1', phoneNumber: '250788123456', transferPhone: '250788765432',
      transactionId: 'EK-TX-1', status: 'pending', callbackUrl: ENV.EKOPAY_CALLBACK_URL,
      createdAt: '2026-09-20T10:00:00Z',
    },
    message: 'Payment initiated successfully',
  },
};

test('createEkopayClient refuses to exist without credentials', () => {
  assert.throws(() => createEkopayClient(resolveEkopayConfig({})), EkopayError);
});

test('initiatePayment: one POST, the key as the documented query parameter, exact payload', async () => {
  const fetchImpl = fakeFetch(() => INITIATED);
  const client = createEkopayClient(resolveEkopayConfig(ENV), { fetchImpl });

  const out = await client.initiatePayment({
    amount: 12000, referenceId: 'pay_1', phone: '0788123456', senderMessage: 'Broodiinnox subscription',
  });

  assert.equal(out.status, 'pending');
  assert.equal(out.referenceId, 'pay_1');
  assert.equal(out.transactionId, 'EK-TX-1');
  assert.equal(out.payer, '250788123456');
  assert.equal(fetchImpl.calls.length, 1);

  const [pay] = fetchImpl.calls;
  assert.equal(pay.method, 'POST');
  assert.equal(pay.path, '/api/v1/payment/initiate');
  assert.equal(pay.apiKey, ENV.EKOPAY_API_KEY, 'the key travels as the apiKey query parameter');
  assert.equal(pay.headers['content-type'], 'application/json');
  assert.deepEqual(pay.body, {
    amount: 12000, // the gateway documents an INTEGER, not a string
    referenceId: 'pay_1',
    phoneNumber: '250788123456',
    transferPhone: '250788765432',
    callbackUrl: ENV.EKOPAY_CALLBACK_URL,
    senderMessage: 'Broodiinnox subscription',
  });
});

test('initiatePayment: the merchant number and callback URL come from the configuration', async () => {
  const fetchImpl = fakeFetch(() => INITIATED);
  const client = createEkopayClient(resolveEkopayConfig(ENV), { fetchImpl });
  await client.initiatePayment({ amount: 12000, referenceId: 'pay_2', phone: '0788123456' });
  assert.equal(fetchImpl.calls[0].body.transferPhone, '250788765432');
  assert.equal(fetchImpl.calls[0].body.callbackUrl, ENV.EKOPAY_CALLBACK_URL);
  assert.equal(fetchImpl.calls[0].body.senderMessage, undefined, 'no message is sent when there is nothing to say');
});

test('initiatePayment: a short answer without the { transaction } wrapper is accepted', async () => {
  const short = { status: 201, body: { amount: 12000, referenceId: 'pay_3', transactionId: 'EK-TX-3', status: 'pending' } };
  const client = createEkopayClient(resolveEkopayConfig(ENV), { fetchImpl: fakeFetch(() => short) });
  const out = await client.initiatePayment({ amount: 12000, referenceId: 'pay_3', phone: '0788123456' });
  assert.equal(out.referenceId, 'pay_3');
  assert.equal(out.transactionId, 'EK-TX-3');
});

test('initiatePayment: a bad number, a bad amount or a missing reference never reaches the gateway', async () => {
  const fetchImpl = fakeFetch(() => INITIATED);
  const client = createEkopayClient(resolveEkopayConfig(ENV), { fetchImpl });

  await assert.rejects(() => client.initiatePayment({ amount: 1000, referenceId: 'pay_1', phone: 'not-a-number' }), /valid MTN MoMo number/);
  await assert.rejects(() => client.initiatePayment({ amount: 0, referenceId: 'pay_1', phone: '0788123456' }), /positive whole amount/);
  await assert.rejects(() => client.initiatePayment({ amount: 12.5, referenceId: 'pay_1', phone: '0788123456' }), /positive whole amount/);
  // the gateway's own floor, enforced before the round trip
  await assert.rejects(() => client.initiatePayment({ amount: 49, referenceId: 'pay_1', phone: '0788123456' }), /at least 50 RWF/);
  await assert.rejects(() => client.initiatePayment({ amount: 12000, phone: '0788123456' }), /reference is required/);
  assert.equal(fetchImpl.calls.length, 0);
});

test('initiatePayment: a merchant number that is not configured is refused, not guessed', async () => {
  const client = createEkopayClient({ ...resolveEkopayConfig(ENV), transferPhone: null }, { fetchImpl: fakeFetch(() => INITIATED) });
  await assert.rejects(() => client.initiatePayment({ amount: 12000, referenceId: 'pay_1', phone: '0788123456' }), /merchant number/);
});

test('getStatus: reads the gateway verdict for one reference', async () => {
  const fetchImpl = fakeFetch((c) => {
    if (c.path.endsWith('/payment/status/pay_1')) {
      return { status: 200, body: { referenceId: 'pay_1', amount: 12000, phoneNumber: '250788123456', status: 'success', updatedAt: '2026-09-20T10:02:00Z' } };
    }
    if (c.path.endsWith('/payment/status/pay.2')) return { status: 200, body: { status: 'pending' } };
    return { status: 404, body: { error: 'Transaction not found' } };
  });
  const client = createEkopayClient(resolveEkopayConfig(ENV), { fetchImpl });

  const ok = await client.getStatus('pay_1');
  assert.equal(ok.status, 'successful');
  assert.equal(ok.amount, 12000, 'the collected amount must travel with the verdict');
  assert.equal(ok.referenceId, 'pay_1');
  assert.equal(fetchImpl.calls[0].method, 'GET');
  assert.equal(fetchImpl.calls[0].apiKey, ENV.EKOPAY_API_KEY);

  assert.equal((await client.getStatus('pay.2')).status, 'pending');
  assert.equal(fetchImpl.calls[1].path, '/api/v1/payment/status/pay.2', 'the reference is encoded into the path');
  await assert.rejects(() => client.getStatus(''), /reference is required/);
});

test('provider errors surface as EkopayError with a message, and a timeout is a timeout', async () => {
  const unauthorized = createEkopayClient(resolveEkopayConfig(ENV), {
    fetchImpl: fakeFetch(() => ({ status: 401, body: { error: 'Invalid API key' } })),
  });
  await assert.rejects(() => unauthorized.initiatePayment({ amount: 12000, referenceId: 'pay_1', phone: '0788123456' }), (err) => {
    assert.ok(err instanceof EkopayError);
    assert.equal(err.status, 401);
    assert.match(err.message, /EKOPAY_API_KEY/);
    return true;
  });

  const duplicate = createEkopayClient(resolveEkopayConfig(ENV), {
    fetchImpl: fakeFetch(() => ({ status: 400, body: { error: 'referenceId already exists' } })),
  });
  await assert.rejects(() => duplicate.initiatePayment({ amount: 12000, referenceId: 'pay_1', phone: '0788123456' }), /already used/);

  const hanging = createEkopayClient(resolveEkopayConfig({ ...ENV, EKOPAY_TIMEOUT_MS: '20' }), {
    fetchImpl: (url, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  });
  await assert.rejects(() => hanging.initiatePayment({ amount: 12000, referenceId: 'pay_1', phone: '0788123456' }), (err) => {
    assert.equal(err.code, 'timeout');
    return true;
  });
});

/* INVARIANT: the key travels in the URL, so no failure may quote the URL. */
test('no error ever carries the API key, however the network fails', async () => {
  const leaky = createEkopayClient(resolveEkopayConfig(ENV), {
    fetchImpl: async (url) => { throw new Error(`request to ${url} failed`); },
  });
  const err = await leaky.initiatePayment({ amount: 12000, referenceId: 'pay_1', phone: '0788123456' }).then(() => null, (e) => e);
  assert.ok(err instanceof EkopayError);
  assert.ok(!err.message.includes(ENV.EKOPAY_API_KEY), 'the network error must be scrubbed');
  assert.match(err.message, /\[redacted\]/);
});

/* ------------------------------------------------------------------ */
/* Credential verification (behind scripts/ekopay-check.mjs)           */
/* ------------------------------------------------------------------ */

test('verifyEkopayCredentials: unset credentials are a config answer, not a rejection', async () => {
  const fetchImpl = fakeFetch(() => ({ status: 200 }));
  const verdict = await verifyEkopayCredentials(resolveEkopayConfig({}), { fetchImpl });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.step, 'config');
  assert.match(verdict.message, /EKOPAY_API_KEY/);
  assert.equal(fetchImpl.calls.length, 0, 'nothing is asked of the gateway until the config is usable');
});

test('verifyEkopayCredentials: a key the gateway refuses is REJECTED, and the verdict carries no credential', async () => {
  const fetchImpl = fakeFetch(() => ({ status: 401, body: { error: 'Invalid API key' } }));
  const verdict = await verifyEkopayCredentials(resolveEkopayConfig(ENV), { fetchImpl });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.step, 'status');
  assert.equal(verdict.status, 401);
  assert.match(verdict.message, /EKOPAY_API_KEY/);
  assert.ok(!JSON.stringify(verdict).includes(ENV.EKOPAY_API_KEY), 'never echo a credential');
  assert.equal(fetchImpl.calls.length, 1);
});

test('verifyEkopayCredentials: accepted credentials answer a status read — 404 for a reference that cannot exist is the good news', async () => {
  const fetchImpl = fakeFetch(() => ({ status: 404, body: { error: 'Transaction not found' } }));
  const verdict = await verifyEkopayCredentials(resolveEkopayConfig(ENV), { fetchImpl, newReference: () => 'probe-ref' });

  assert.equal(verdict.ok, true);
  assert.equal(verdict.step, 'status');
  assert.equal(verdict.status, 404);
  assert.match(verdict.message, /accepts this API key/);
  assert.equal(fetchImpl.calls[0].path, '/api/v1/payment/status/probe-ref');
});

test('verifyEkopayCredentials: a key that is not active is not a pass', async () => {
  const fetchImpl = fakeFetch(() => ({ status: 401, body: { error: 'API key is not active' } }));
  const verdict = await verifyEkopayCredentials(resolveEkopayConfig(ENV), { fetchImpl });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.status, 401);
  assert.match(verdict.message, /not active/);
});

/* INVARIANT: for EVERY way the configuration can be incomplete — either
 * credential absent or unusable, an unusable gateway host — the answer is a
 * config verdict that names what to fix, and the gateway is never called. */
test('verifyEkopayCredentials: no incomplete configuration ever reaches the gateway', async () => {
  const incomplete = [];

  // every subset of the two credentials except the complete one
  for (let mask = 0; mask < 3; mask++) {
    const env = { EKOPAY_BASE_URL: ENV.EKOPAY_BASE_URL };
    EKOPAY_REQUIRED_ENV.forEach((k, i) => { if (mask & (1 << i)) env[k] = i === 1 ? ENV.EKOPAY_TRANSFER_PHONE : 'a-value'; });
    incomplete.push({ env, named: EKOPAY_REQUIRED_ENV.filter((_, i) => !(mask & (1 << i))) });
  }

  // each credential present but blank — a whitespace value is not a value
  for (const blank of EKOPAY_REQUIRED_ENV) {
    incomplete.push({ env: { ...ENV, [blank]: '   ' }, named: [blank] });
  }

  // set, but unusable
  incomplete.push({ env: { ...ENV, EKOPAY_TRANSFER_PHONE: 'not-a-number' }, named: ['EKOPAY_TRANSFER_PHONE'] });
  for (const bad of ['not-a-url', 'ftp://ekopay.example.com']) {
    incomplete.push({ env: { ...ENV, EKOPAY_BASE_URL: bad }, named: ['EKOPAY_BASE_URL'] });
  }

  for (const { env, named } of incomplete) {
    const fetchImpl = fakeFetch(() => ({ status: 200, body: {} }));
    const verdict = await verifyEkopayCredentials(resolveEkopayConfig(env), { fetchImpl });

    assert.equal(verdict.ok, false, `incomplete config must never pass: ${JSON.stringify(named)}`);
    assert.equal(verdict.step, 'config');
    assert.equal(fetchImpl.calls.length, 0, `nothing may be asked of the gateway without a usable config: ${JSON.stringify(named)}`);
    for (const k of named) assert.match(verdict.message, new RegExp(k), `the message must name ${k}`);
  }

  assert.equal(incomplete.length, 3 + EKOPAY_REQUIRED_ENV.length + 3, 'every incomplete shape was exercised');
});

/* INVARIANT: ok is true ONLY for a gateway that answered. No rejection status,
 * however the gateway words it, is ever a pass — and no verdict ever carries a
 * credential. */
test('verifyEkopayCredentials: no gateway rejection is ever a pass', async () => {
  for (const status of [400, 401, 403, 409, 429, 500, 502, 503]) {
    const fetchImpl = fakeFetch(() => ({ status, body: { error: 'SOMETHING_NEW' } }));
    const verdict = await verifyEkopayCredentials(resolveEkopayConfig(ENV), { fetchImpl });

    assert.equal(verdict.ok, false, `HTTP ${status} must not be a pass`);
    assert.equal(verdict.status, status);
    assert.equal(typeof verdict.message, 'string');
    assert.ok(verdict.message.length > 0, `HTTP ${status} must say something an operator can act on`);
    assert.ok(!JSON.stringify(verdict).includes(ENV.EKOPAY_API_KEY), 'never echo a credential');
  }
});

/* INVARIANT: an unreachable gateway, one that never answers, and a config that
 * is 'enabled' but has no client all produce a verdict — the check never throws
 * and never claims a pass it did not receive. */
test('verifyEkopayCredentials: an unreachable or silent gateway is a verdict, not a crash', async () => {
  const unreachable = await verifyEkopayCredentials(resolveEkopayConfig(ENV), {
    fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); },
  });
  assert.equal(unreachable.ok, false);
  assert.equal(unreachable.step, 'status');
  assert.equal(unreachable.status, null);
  assert.match(unreachable.message, /Could not reach the payment gateway/);

  const silent = await verifyEkopayCredentials(resolveEkopayConfig({ ...ENV, EKOPAY_TIMEOUT_MS: '20' }), {
    fetchImpl: (url, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  });
  assert.equal(silent.ok, false);
  assert.equal(silent.step, 'status');
  assert.match(silent.message, /did not answer in time/);

  const notEnabled = await verifyEkopayCredentials({ ...resolveEkopayConfig(ENV), enabled: false }, {
    fetchImpl: fakeFetch(() => ({ status: 200 })),
  });
  assert.equal(notEnabled.ok, false, 'a config that is not enabled cannot build a client and is not a pass');
  assert.equal(notEnabled.step, 'config');
});
