/**
 * MTN MoMo Collections client — env config, MSISDN normalization, the exact
 * HTTP the provider gets, and how its answers are read.
 *
 *   INVARIANT   credentials come from the environment only; an MSISDN that is
 *               not this country's is refused before any request is made; a
 *               status we do not understand is PENDING (never a success);
 *               the access token is reused, not re-fetched per call.
 *   BEHAVIOURAL requestToPay sends exactly one token call + one requesttopay
 *               with the reference id, payer and string amount; getStatus maps
 *               SUCCESSFUL / FAILED / PENDING; provider errors become messages
 *               an operator can act on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOMO_REQUIRED_ENV, MoMoError, createMomoClient, describeMomoConfig, interpretMomoStatus,
  momoErrorMessage, momoNotConfiguredMessage, momoReasonMessage, newMomoReference,
  normalizeMsisdn, resolveMomoConfig, verifyMomoCredentials,
} from '../lib/momo.js';

const ENV = {
  MOMO_SUBSCRIPTION_KEY: 'sub-key',
  MOMO_API_USER: 'user-uuid',
  MOMO_API_KEY: 'api-key',
  MOMO_TARGET_ENVIRONMENT: 'sandbox',
  MOMO_CURRENCY: 'RWF',
  MOMO_BASE_URL: 'https://sandbox.momodeveloper.mtn.com',
};

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

test('resolveMomoConfig: unset => disabled, and it names what is missing', () => {
  const cfg = resolveMomoConfig({});
  assert.equal(cfg.enabled, false);
  assert.deepEqual(cfg.missing, MOMO_REQUIRED_ENV);
  assert.equal(cfg.baseUrl, 'https://sandbox.momodeveloper.mtn.com');
  assert.equal(cfg.targetEnvironment, 'sandbox');
  assert.equal(cfg.currency, 'RWF');
  assert.equal(cfg.countryCode, '250');
  assert.equal(cfg.timeoutMs, 15_000);
});

test('resolveMomoConfig: enabled only with all three credentials', () => {
  assert.equal(resolveMomoConfig(ENV).enabled, true);
  for (const k of MOMO_REQUIRED_ENV) {
    const partial = { ...ENV };
    delete partial[k];
    const cfg = resolveMomoConfig(partial);
    assert.equal(cfg.enabled, false, `${k} missing must disable MoMo`);
    assert.deepEqual(cfg.missing, [k]);
  }
});

test('resolveMomoConfig: normalizes the base URL, currency and country code', () => {
  const cfg = resolveMomoConfig({ ...ENV, MOMO_BASE_URL: 'https://momo.example.com///', MOMO_CURRENCY: 'rwf', MOMO_COUNTRY_CODE: '250' });
  assert.equal(cfg.baseUrl, 'https://momo.example.com');
  assert.equal(cfg.currency, 'RWF');
  const bad = resolveMomoConfig({ ...ENV, MOMO_BASE_URL: 'not-a-url' });
  assert.equal(bad.enabled, false);
  assert.ok(bad.missing.includes('MOMO_BASE_URL'));
});

test('describeMomoConfig never carries a credential value', () => {
  const desc = describeMomoConfig(resolveMomoConfig(ENV));
  const json = JSON.stringify(desc);
  assert.equal(desc.enabled, true);
  assert.equal(desc.currency, 'RWF');
  for (const secret of ['sub-key', 'user-uuid', 'api-key']) {
    assert.ok(!json.includes(secret), `config leaked ${secret}`);
  }
});

test('an unconfigured server says which env vars are missing', () => {
  const msg = momoNotConfiguredMessage(resolveMomoConfig({}));
  for (const k of MOMO_REQUIRED_ENV) assert.ok(msg.includes(k), `message does not name ${k}`);
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

test('newMomoReference: a valid, distinct UUID per payment', () => {
  const a = newMomoReference();
  const b = newMomoReference();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.notEqual(a, b);
});

/* ------------------------------------------------------------------ */
/* The provider's answer                                               */
/* ------------------------------------------------------------------ */

test('interpretMomoStatus: SUCCESSFUL/FAILED only when the provider says so', () => {
  assert.equal(interpretMomoStatus({ status: 'SUCCESSFUL', financialTransactionId: 'FT1' }).status, 'successful');
  assert.equal(interpretMomoStatus({ status: 'SUCCESSFUL', financialTransactionId: 'FT1' }).financialTransactionId, 'FT1');
  assert.equal(interpretMomoStatus({ status: 'FAILED', reason: 'PAYER_NOT_FOUND' }).status, 'failed');
  assert.equal(interpretMomoStatus({ status: 'REJECTED' }).status, 'failed');
  assert.equal(interpretMomoStatus({ status: 'PENDING' }).status, 'pending');
  // an answer we do not understand must never move money or unlock a device
  assert.equal(interpretMomoStatus({ status: 'WHATEVER' }).status, 'pending');
  assert.equal(interpretMomoStatus({}).status, 'pending');
  assert.equal(interpretMomoStatus(null).status, 'pending');
});

test('interpretMomoStatus: what was collected travels with the verdict', () => {
  const ok = interpretMomoStatus({ status: 'SUCCESSFUL', amount: '12000', currency: 'RWF', payer: { partyId: '250788123456' } });
  assert.equal(ok.amount, '12000');
  assert.equal(ok.currency, 'RWF');
  assert.equal(ok.payer, '250788123456');
  const bare = interpretMomoStatus({ status: 'SUCCESSFUL' });
  assert.equal(bare.amount, null);
  assert.equal(bare.currency, null);
});

test('momoReasonMessage / momoErrorMessage: reasons become sentences an operator can act on', () => {
  assert.match(momoReasonMessage('PAYER_NOT_FOUND'), /not an MTN MoMo account/);
  assert.equal(momoReasonMessage('SOMETHING_NEW'), null);
  assert.match(momoErrorMessage({ status: 401 }), /MOMO_SUBSCRIPTION_KEY/);
  assert.match(momoErrorMessage({ status: 429 }), /rate-limiting/);
  assert.match(momoErrorMessage({ code: 'timeout' }), /did not answer in time/);
  assert.match(momoErrorMessage({ code: 'network' }), /Could not reach MTN MoMo/);
  assert.match(momoErrorMessage({ status: 400, body: { reason: 'PAYER_NOT_FOUND' } }), /not an MTN MoMo account/);
});

/* ------------------------------------------------------------------ */
/* The HTTP the provider receives                                      */
/* ------------------------------------------------------------------ */

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const call = {
      url: String(url),
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

const TOKEN_OK = { status: 200, body: { access_token: 'tok-1', expires_in: 3600 } };

test('createMomoClient refuses to exist without credentials', () => {
  assert.throws(() => createMomoClient(resolveMomoConfig({})), MoMoError);
});

test('requestToPay: token then requesttopay, with the reference, payer and string amount', async () => {
  const fetchImpl = fakeFetch((c) => (c.url.endsWith('/collection/token/') ? TOKEN_OK : { status: 202 }));
  const client = createMomoClient(resolveMomoConfig({ ...ENV, MOMO_CALLBACK_URL: 'https://api.example.com/api/payments/momo/callback' }), { fetchImpl });

  const out = await client.requestToPay({
    amount: 12000, currency: 'RWF', externalId: 'pay_1', payer: '0788123456',
    payerMessage: 'Broodiinnox subscription', payeeNote: 'Broodiinnox subscription payment',
  });

  assert.equal(out.status, 'pending');
  assert.equal(out.payer, '250788123456');
  assert.equal(fetchImpl.calls.length, 2);

  const [token, pay] = fetchImpl.calls;
  assert.equal(token.method, 'POST');
  assert.equal(token.headers.Authorization, `Basic ${Buffer.from('user-uuid:api-key').toString('base64')}`);
  assert.equal(token.headers['Ocp-Apim-Subscription-Key'], 'sub-key');

  assert.equal(pay.method, 'POST');
  assert.equal(pay.url, 'https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay');
  assert.equal(pay.headers.Authorization, 'Bearer tok-1');
  assert.equal(pay.headers['X-Target-Environment'], 'sandbox');
  assert.equal(pay.headers['X-Reference-Id'], out.referenceId);
  assert.equal(pay.headers['X-Callback-Url'], 'https://api.example.com/api/payments/momo/callback');
  assert.deepEqual(pay.body, {
    amount: '12000',
    currency: 'RWF',
    externalId: 'pay_1',
    payer: { partyIdType: 'MSISDN', partyId: '250788123456' },
    payerMessage: 'Broodiinnox subscription',
    payeeNote: 'Broodiinnox subscription payment',
  });
});

test('requestToPay: without a callback URL no X-Callback-Url header is sent', async () => {
  const fetchImpl = fakeFetch((c) => (c.url.endsWith('/collection/token/') ? TOKEN_OK : { status: 202 }));
  const client = createMomoClient(resolveMomoConfig(ENV), { fetchImpl });
  await client.requestToPay({ amount: 5000, payer: '0788123456' });
  assert.equal(fetchImpl.calls[1].headers['X-Callback-Url'], undefined);
});

test('requestToPay: a bad number or amount never reaches the provider', async () => {
  const fetchImpl = fakeFetch(() => TOKEN_OK);
  const client = createMomoClient(resolveMomoConfig(ENV), { fetchImpl });

  await assert.rejects(() => client.requestToPay({ amount: 1000, payer: 'not-a-number' }), /valid MTN MoMo number/);
  await assert.rejects(() => client.requestToPay({ amount: 0, payer: '0788123456' }), /positive whole amount/);
  await assert.rejects(() => client.requestToPay({ amount: 1.5, payer: '0788123456' }), /positive whole amount/);
  assert.equal(fetchImpl.calls.length, 0);
});

test('the access token is reused across calls and re-fetched once it expires', async () => {
  const fetchImpl = fakeFetch((c) => (c.url.endsWith('/collection/token/') ? { status: 200, body: { access_token: `tok-${fetchImpl.calls.length}`, expires_in: 60 } } : { status: 202 }));
  let clock = 1_000_000;
  const client = createMomoClient(resolveMomoConfig(ENV), { fetchImpl, now: () => clock });

  await client.requestToPay({ amount: 1000, payer: '0788123456' });
  await client.requestToPay({ amount: 1000, payer: '0788123456' });
  assert.equal(fetchImpl.calls.filter((c) => c.url.endsWith('/collection/token/')).length, 1, 'token should be cached');

  clock += 61_000; // past expires_in
  await client.requestToPay({ amount: 1000, payer: '0788123456' });
  assert.equal(fetchImpl.calls.filter((c) => c.url.endsWith('/collection/token/')).length, 2, 'expired token should be re-fetched');
});

test('getStatus: reads the provider verdict for one reference', async () => {
  const fetchImpl = fakeFetch((c) => {
    if (c.url.endsWith('/collection/token/')) return TOKEN_OK;
    if (c.url.endsWith('/requesttopay/ref-1')) return { status: 200, body: { status: 'SUCCESSFUL', financialTransactionId: 'FT9', amount: '12000', currency: 'RWF' } };
    return { status: 200, body: { status: 'PENDING' } };
  });
  const client = createMomoClient(resolveMomoConfig(ENV), { fetchImpl });

  const ok = await client.getStatus('ref-1');
  assert.equal(ok.status, 'successful');
  assert.equal(ok.financialTransactionId, 'FT9');
  assert.equal(ok.amount, '12000', 'the collected amount must travel with the verdict');
  assert.equal(ok.currency, 'RWF');
  assert.equal(fetchImpl.calls[1].url, 'https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay/ref-1');
  assert.equal(fetchImpl.calls[1].headers['X-Reference-Id'], undefined, 'status reads must not send X-Reference-Id');

  assert.equal((await client.getStatus('ref-2')).status, 'pending');
  await assert.rejects(() => client.getStatus(''), /reference is required/);
});

test('provider errors surface as MoMoError with a message, and a timeout is a timeout', async () => {
  const unauthorized = createMomoClient(resolveMomoConfig(ENV), {
    fetchImpl: fakeFetch(() => ({ status: 401, body: { error: 'invalid key' } })),
  });
  await assert.rejects(() => unauthorized.requestToPay({ amount: 1000, payer: '0788123456' }), (err) => {
    assert.ok(err instanceof MoMoError);
    assert.equal(err.status, 401);
    assert.match(err.message, /credentials/);
    return true;
  });

  const failing = createMomoClient(resolveMomoConfig(ENV), {
    fetchImpl: fakeFetch((c) => (c.url.endsWith('/collection/token/') ? TOKEN_OK : { status: 409, body: { reason: 'RESOURCE_ALREADY_EXIST' } })),
  });
  await assert.rejects(() => failing.requestToPay({ amount: 1000, payer: '0788123456' }), /already used/);

  const hanging = createMomoClient(resolveMomoConfig({ ...ENV, MOMO_TIMEOUT_MS: '20' }), {
    fetchImpl: (url, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  });
  await assert.rejects(() => hanging.requestToPay({ amount: 1000, payer: '0788123456' }), (err) => {
    assert.equal(err.code, 'timeout');
    return true;
  });
});

/* ------------------------------------------------------------------ */
/* Credential verification (behind scripts/momo-check.mjs)             */
/* ------------------------------------------------------------------ */

test('verifyMomoCredentials: unset credentials are a config answer, not a rejection', async () => {
  const fetchImpl = fakeFetch(() => ({ status: 200 }));
  const verdict = await verifyMomoCredentials(resolveMomoConfig({}), { fetchImpl });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.step, 'config');
  assert.match(verdict.message, /MOMO_SUBSCRIPTION_KEY/);
  assert.equal(fetchImpl.calls.length, 0, 'nothing is asked of MTN until all three are set');
});

test('verifyMomoCredentials: a key MTN refuses is REJECTED, and the verdict carries no credential', async () => {
  const fetchImpl = fakeFetch(() => ({ status: 401, body: { error: 'invalid key' } }));
  const verdict = await verifyMomoCredentials(resolveMomoConfig(ENV), { fetchImpl });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.step, 'token');
  assert.equal(verdict.status, 401);
  assert.match(verdict.message, /credentials/);
  assert.ok(!JSON.stringify(verdict).includes(ENV.MOMO_SUBSCRIPTION_KEY), 'never echo a credential');
  assert.equal(fetchImpl.calls.length, 1, 'a refused token stops there — no reference lookup is attempted');
});

test('verifyMomoCredentials: accepted credentials answer Collections — 404 for an unknown reference is the good news', async () => {
  const fetchImpl = fakeFetch((c) => (c.url.endsWith('/collection/token/')
    ? TOKEN_OK
    : { status: 404, body: { reason: 'RESOURCE_NOT_FOUND' } }));
  const verdict = await verifyMomoCredentials(resolveMomoConfig(ENV), { fetchImpl, newReference: () => 'probe-ref' });

  assert.equal(verdict.ok, true);
  assert.equal(verdict.step, 'collections');
  assert.equal(verdict.status, 404);
  assert.match(verdict.message, /accepts these credentials/);
  assert.equal(fetchImpl.calls[1].url, 'https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay/probe-ref');
});

test('verifyMomoCredentials: a token that works but a product that refuses is not a pass', async () => {
  const fetchImpl = fakeFetch((c) => (c.url.endsWith('/collection/token/') ? TOKEN_OK : { status: 403, body: {} }));
  const verdict = await verifyMomoCredentials(resolveMomoConfig(ENV), { fetchImpl });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.step, 'collections');
  assert.equal(verdict.status, 403);
});
