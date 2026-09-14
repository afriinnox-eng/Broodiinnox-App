/**
 * MTN MoMo payments in the farmer's app: request -> provider -> confirm -> unlock.
 *
 *   INVARIANT   nothing the browser can do confirms a payment. The number must
 *               be one MTN MoMo can reach, the amount asked for is the sheet's
 *               price for that farm size, and a payment unlocks a system only
 *               when MTN's own answer says `successful` AND that answer is the
 *               provider's (`provider_confirmed: true`) — a row that merely
 *               claims success is still pending.
 *   BEHAVIOURAL a request reaches broodiinnox-api once, with the sheet price and
 *               the normalized MSISDN; a second tap while a prompt is live
 *               neither charges nor prompts again; MTN's refusal is recorded
 *               with what it said; a provider-confirmed payment activates the
 *               subscription the farmer paid for.
 *   FUNCTIONAL  the real farmer pages and the payment modal: an unreachable
 *               number disables the button and says why, a pending payment can
 *               be checked with MTN from the page, and a server that cannot take
 *               payments says so instead of collecting a number.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { planPrice } from '../lib/subscriptions.js';

const KEY = 'broodiinnox_app_v1';
const FARMER = { id: 'f1', name: 'Jean Damascene', role: 'farmer', phone: '0788123456' };
const DEVICE = 'BRD001';
const PLAN = 't30d';
const CHICKS = 1000; // BRD001's farm size, which is what prices its plans
const PRICE = planPrice(PLAN, CHICKS);

/** The payment row broodiinnox-api reports for a prompt it has just sent. */
const apiRow = (over = {}) => ({
  id: 'pay_api_1',
  device_id: DEVICE,
  farmer_id: 'f1',
  plan_id: PLAN,
  band_id: 'b06',
  amount: PRICE,
  currency: 'RWF',
  phone: '250788123456',
  method: 'MTN MoMo',
  status: 'pending',
  provider_confirmed: false,
  provider_ref: 'ref-abc123',
  financial_transaction_id: null,
  reason: null,
  created_at: '2026-09-11T08:00:00.000Z',
  updated_at: '2026-09-11T08:00:00.000Z',
  confirmed_at: null,
  status_checked_at: null,
  ...over,
});

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

let StoreProvider;
let useStore;
let buildSeed;
// src/lib/payments.js is imported dynamically, AFTER the env stub: its
// module-level `paymentsConfig` is resolved once from import.meta.env, and the
// store only builds a payments client when that says the API is configured.
let pay;
let probe = { state: null, dispatch: null };
let calls = [];
/** What the fake broodiinnox-api answers this test. */
let server = {};

const device = (id) => probe.state.devices.find((d) => d.id === id);

function Probe() {
  const { state, dispatch } = useStore();
  probe = { state, dispatch };
  return null;
}

function seedWith(session, mutate) {
  const seed = buildSeed();
  const state = mutate ? mutate(JSON.parse(JSON.stringify(seed))) : seed;
  localStorage.setItem(KEY, JSON.stringify({ ...state, session, reminderSent: [] }));
  return state;
}

/** Flush what the store's effects started (and, optionally, let a timer fire). */
async function settle(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

const paymentCalls = () => calls.filter((c) => c.path.includes('/api/payments'));
const posts = () => calls.filter((c) => c.method === 'POST' && c.path.endsWith('/api/payments'));

beforeEach(async () => {
  localStorage.clear();
  calls = [];
  probe = { state: null, dispatch: null };
  server = { momo: { enabled: true, missing: [] }, create: apiRow(), createStatus: 201 };
  vi.unstubAllEnvs();
  vi.stubEnv('VITE_IOT_API_URL', 'https://iot.local');
  vi.stubEnv('VITE_IOT_TIMEOUT_MS', '2000');
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ method, path: u, body });

    if (method === 'GET' && u.endsWith('/api/health')) {
      return jsonResponse({ ok: true, momo: server.momo });
    }
    if (method === 'POST' && u.endsWith('/api/payments')) {
      return jsonResponse({ payment: server.create, reused: false }, server.createStatus);
    }
    if (method === 'POST' && u.endsWith('/refresh')) {
      return jsonResponse({ payment: server.refresh ?? server.create });
    }
    if (method === 'GET' && /\/api\/payments\/[^/?]+$/.test(u)) {
      return jsonResponse({ payment: server.status ?? server.create });
    }
    if (method === 'GET' && u.includes('/api/payments')) {
      return jsonResponse({ count: 0, payments: [] });
    }
    if (method === 'GET' && u.endsWith('/api/devices')) {
      return jsonResponse({ count: 0, devices: [] });
    }
    return jsonResponse({ ok: true });
  }));

  // Dynamic import AFTER the env stub, so paymentsConfig resolves enabled:true
  // (it is read from import.meta.env once per module load).
  pay = await import('../lib/payments.js');
  const store = await import('../lib/store.jsx');
  const seed = await import('../lib/seed.js');
  StoreProvider = store.StoreProvider;
  useStore = store.useStore;
  buildSeed = seed.buildSeed;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* INVARIANT: what the app does about a number, and what it cannot say */
/* ------------------------------------------------------------------ */

describe('INVARIANT: the app never confirms a payment the provider has not', () => {
  it('accepts only numbers MTN MoMo can actually be charged', () => {
    const { normalizeMomoPhone, momoPhoneError } = pay;
    expect(normalizeMomoPhone('0788123456')).toBe('250788123456');
    expect(normalizeMomoPhone('+250 788 123 456')).toBe('250788123456');
    expect(normalizeMomoPhone('00250788123456')).toBe('250788123456');
    expect(normalizeMomoPhone('788123456')).toBe('250788123456');
    expect(normalizeMomoPhone(788123456)).toBe('250788123456');

    for (const junk of ['', '0788', 'abc', null, undefined, {}, '25078812345678901']) {
      expect(normalizeMomoPhone(junk), String(junk)).toBeNull();
      expect(momoPhoneError(junk)).toMatch(/valid MTN MoMo number/);
    }
    expect(momoPhoneError('0788123456')).toBeNull();
  });

  it('carries only the provider-derived fields, and never a confirmation', () => {
    const { providerFieldsFromRow, isProviderConfirmed } = pay;
    // MTN has only received the request: nothing here reads as paid.
    const pending = providerFieldsFromRow(apiRow());
    expect(pending).toMatchObject({
      apiId: 'pay_api_1', providerRef: 'ref-abc123', providerConfirmed: false, providerStatus: 'pending',
    });
    expect(pending.financialTxId).toBeNull();
    expect(pending.amount).toBe(PRICE);

    // A row that CLAIMS success without the provider's own flag carries no
    // confirmation: that flag comes from MTN's answer and from nothing else.
    const claiming = providerFieldsFromRow(apiRow({ status: 'successful', provider_confirmed: false }));
    expect(claiming.providerConfirmed).toBe(false);
    expect(isProviderConfirmed(apiRow({ status: 'successful', provider_confirmed: false }))).toBe(false);

    // Fields the app has no business copying are ignored, and MTN's own
    // confirmation is what the app acts on.
    expect(claiming).not.toHaveProperty('farmer_id');
    expect(claiming).not.toHaveProperty('payer_message');
    const real = apiRow({ status: 'successful', provider_confirmed: true, financial_transaction_id: 'MTN-77' });
    expect(isProviderConfirmed(real)).toBe(true);
    expect(providerFieldsFromRow(real).financialTxId).toBe('MTN-77');
    expect(providerFieldsFromRow(real).providerConfirmed).toBe(true);
    expect(providerFieldsFromRow(null)).toBeNull();
  });

  it('is configured by the same API as the devices, and refuses to run without one', () => {
    const { resolvePaymentConfig, createPaymentsApi } = pay;
    expect(resolvePaymentConfig({}).enabled).toBe(false);
    expect(resolvePaymentConfig({ VITE_IOT_API_URL: 'localhost:3001' }).enabled).toBe(false);
    expect(resolvePaymentConfig({ VITE_IOT_API_URL: 'https://api.test' })).toMatchObject({
      enabled: true, baseUrl: 'https://api.test', timeoutMs: 8000,
    });
    expect(resolvePaymentConfig({ VITE_IOT_API_URL: 'https://api.test', VITE_IOT_API_KEY: 'k' }).apiKey).toBe('k');
    expect(() => createPaymentsApi({ baseUrl: '' })).toThrow(/not configured/);
  });

  it('says in plain words why a payment did not go through', () => {
    const { momoFailureNote, momoPendingNote, momoDisabledNote } = pay;
    expect(momoFailureNote({ failureReason: 'PAYER_NOT_FOUND' })).toMatch(/not an MTN MoMo account/);
    expect(momoFailureNote({ failureReason: 'AMOUNT_MISMATCH' })).toMatch(/different amount/);
    expect(momoFailureNote({ failureReason: 'MTN MoMo is not configured on this server yet.' }))
      .toBe('MTN MoMo is not configured on this server yet.');
    expect(momoFailureNote({})).toMatch(/did not go through/);
    expect(momoPendingNote({ phone: '250788123456' })).toMatch(/250788123456/);
    expect(momoPendingNote({})).toMatch(/approve the prompt/);
    expect(momoDisabledNote({ missing: ['MOMO_SUBSCRIPTION_KEY'] })).toMatch(/MOMO_SUBSCRIPTION_KEY/);
    expect(momoDisabledNote({})).toMatch(/not configured on the server/);
  });
});

/* ------------------------------------------------------------------ */
/* BEHAVIOURAL: the request, the provider, and what it buys            */
/* ------------------------------------------------------------------ */

describe('BEHAVIOURAL: a real payment goes to MTN MoMo and back', () => {
  it('refuses a number MTN cannot reach before the request ever leaves', async () => {
    seedWith(FARMER);
    render(<StoreProvider><Probe /></StoreProvider>);
    const before = probe.state.payments.length;

    await act(async () => {
      probe.dispatch({ type: 'REQUEST_PAYMENT', farmerId: 'f1', deviceId: DEVICE, planId: PLAN, phone: '0788' });
    });
    await settle(100);

    expect(probe.state.payments).toHaveLength(before); // nothing recorded
    expect(probe.state.toast.kind).toBe('error');
    expect(probe.state.toast.msg).toMatch(/valid MTN MoMo number/);
    expect(posts()).toHaveLength(0); // no charge attempted
  });

  it("asks the API for the sheet price, then unlocks the system only on MTN's confirmation", async () => {
    seedWith(FARMER, (seed) => ({
      ...seed,
      // A lapsed subscription: the farmer is paying to unlock this unit.
      devices: seed.devices.map((d) => (d.id === DEVICE
        ? { ...d, subscription: { ...d.subscription, status: 'expired', endDate: new Date(Date.now() - 86400000).toISOString() } }
        : d)),
    }));
    render(<StoreProvider><Probe /></StoreProvider>);
    expect(device(DEVICE).subscription.status).toBe('expired');

    await act(async () => {
      probe.dispatch({ type: 'REQUEST_PAYMENT', farmerId: 'f1', deviceId: DEVICE, planId: PLAN, phone: '0788 123 456' });
    });
    await settle(100);

    // Exactly one prompt, for the sheet price, to the normalized MSISDN.
    expect(posts()).toHaveLength(1);
    expect(posts()[0].body).toMatchObject({
      device_id: DEVICE, plan_id: PLAN, band_id: 'b06', amount: PRICE, phone: '250788123456', currency: 'RWF',
    });

    // MTN has only received it: the system is NOT unlocked yet.
    const pending = probe.state.payments.find((p) => p.deviceId === DEVICE && p.momo === true);
    expect(pending).toMatchObject({ status: 'pending', providerRef: 'ref-abc123', providerConfirmed: false });
    expect(device(DEVICE).subscription.status).toBe('expired');

    // The provider answers: successful, on its own authority.
    server.status = apiRow({
      status: 'successful', provider_confirmed: true, financial_transaction_id: 'MTN-77',
      confirmed_at: '2026-09-11T08:01:00.000Z',
    });
    await settle(5100);

    const paid = probe.state.payments.find((p) => p.id === pending.id);
    expect(paid).toMatchObject({ status: 'successful', providerConfirmed: true, financialTxId: 'MTN-77', failureReason: null });
    const sub = device(DEVICE).subscription;
    expect(sub.status).toBe('active');
    expect(sub.planId).toBe(PLAN);
    expect(sub.price).toBe(PRICE);
    expect(Date.parse(sub.endDate)).toBeGreaterThan(Date.now());
    expect(probe.state.audit[0].action).toBe('payment.success');
  });

  it('does not unlock on a success that the provider has not confirmed', async () => {
    seedWith(FARMER, (seed) => ({
      ...seed,
      devices: seed.devices.map((d) => (d.id === DEVICE
        ? { ...d, subscription: { ...d.subscription, status: 'expired', endDate: new Date(Date.now() - 86400000).toISOString() } }
        : d)),
    }));
    render(<StoreProvider><Probe /></StoreProvider>);
    const before = device(DEVICE).subscription;

    await act(async () => {
      probe.dispatch({ type: 'REQUEST_PAYMENT', farmerId: 'f1', deviceId: DEVICE, planId: PLAN, phone: '0788123456' });
    });
    await settle(100);

    // What a buggy or hostile client could send: the status word without the
    // provider's flag. It buys nothing at all.
    server.status = apiRow({ status: 'successful', provider_confirmed: false });
    await settle(5100);

    const p = probe.state.payments.find((x) => x.deviceId === DEVICE && x.momo === true);
    expect(p.status).toBe('pending');
    expect(p.providerConfirmed).toBe(false);
    expect(device(DEVICE).subscription).toEqual(before); // still locked
  });

  it('never prompts — or charges — twice while a prompt is live', async () => {
    seedWith(FARMER);
    render(<StoreProvider><Probe /></StoreProvider>);
    const seeded = probe.state.payments.length;

    await act(async () => {
      probe.dispatch({ type: 'REQUEST_PAYMENT', farmerId: 'f1', deviceId: DEVICE, planId: PLAN, phone: '0788123456' });
      probe.dispatch({ type: 'REQUEST_PAYMENT', farmerId: 'f1', deviceId: DEVICE, planId: PLAN, phone: '0788123456' });
    });
    await settle(100);

    expect(probe.state.payments).toHaveLength(seeded + 1);
    expect(posts()).toHaveLength(1);
    expect(probe.state.toast.msg).toMatch(/already waiting for MTN MoMo/i);
  });

  it("records MTN's refusal, in its own words, with nothing unlocked", async () => {
    seedWith(FARMER);
    render(<StoreProvider><Probe /></StoreProvider>);
    const before = device(DEVICE).subscription;

    server.createStatus = 502;
    server.create = apiRow({ status: 'failed', provider_confirmed: false, reason: 'PAYER_NOT_FOUND' });
    // The API answers a refusal with the payment row and a plain-words message.
    vi.mocked(globalThis.fetch).mockImplementation(async (url, opts = {}) => {
      const u = String(url);
      const method = (opts.method || 'GET').toUpperCase();
      calls.push({ method, path: u, body: opts.body ? JSON.parse(opts.body) : null });
      if (method === 'POST' && u.endsWith('/api/payments')) {
        return jsonResponse({ error: 'That number is not an MTN MoMo account.', payment: server.create }, 502);
      }
      if (method === 'GET' && u.endsWith('/api/health')) return jsonResponse({ ok: true, momo: server.momo });
      if (method === 'GET' && u.endsWith('/api/devices')) return jsonResponse({ count: 0, devices: [] });
      return jsonResponse({ ok: true });
    });

    await act(async () => {
      probe.dispatch({ type: 'REQUEST_PAYMENT', farmerId: 'f1', deviceId: DEVICE, planId: PLAN, phone: '0788123456' });
    });
    await settle(100);

    const p = probe.state.payments.find((x) => x.deviceId === DEVICE && x.momo === true);
    expect(p.status).toBe('failed');
    expect(p.providerConfirmed).toBe(false);
    expect(p.providerRef).toBe('ref-abc123'); // the reference MTN gave, kept
    expect(p.providerStatus).toBe('failed');
    expect(pay.momoFailureNote(p)).toBe('That number is not an MTN MoMo account.');
    expect(device(DEVICE).subscription).toEqual(before);
  });
});

/* ------------------------------------------------------------------ */
/* FUNCTIONAL: the pages the farmer and the admin actually see         */
/* ------------------------------------------------------------------ */

describe('FUNCTIONAL: the payment screens', () => {
  it('refuses an unreachable number in the payment modal, and asks MTN for a good one', async () => {
    seedWith(FARMER);
    const { default: PayModal } = await import('../components/PayModal.jsx');
    function Harness() {
      const { state } = useStore();
      const dev = state.devices.find((d) => d.id === DEVICE);
      return <PayModal device={dev} onClose={() => {}} />;
    }
    render(<StoreProvider><Harness /></StoreProvider>);
    await settle(100);

    const field = screen.getByPlaceholderText('0788123456');
    fireEvent.change(field, { target: { value: '0788' } });
    expect(screen.getByText(/valid MTN MoMo number/)).toBeInTheDocument();
    const request = screen.getByRole('button', { name: /Request MoMo payment/ });
    expect(request).toBeDisabled();
    expect(posts()).toHaveLength(0);

    fireEvent.change(field, { target: { value: '0788123456' } });
    expect(screen.queryByText(/valid MTN MoMo number/)).toBeNull();
    expect(request).not.toBeDisabled();
    expect(screen.getByText(/MTN MoMo prompt on 0788123456/)).toBeInTheDocument();

    fireEvent.click(request);
    await settle(100);
    expect(posts()).toHaveLength(1);
  });

  it('lets the farmer check a pending payment with MTN from the Payments page', async () => {
    seedWith(FARMER, (seed) => ({
      ...seed,
      payments: [{
        id: 'pay_local_1', farmerId: 'f1', deviceId: DEVICE, planId: PLAN, phone: '250788123456',
        bandId: 'b06', farmSize: CHICKS, amount: PRICE, method: 'MTN MoMo', status: 'pending',
        providerConfirmed: false, providerRef: 'ref-abc123', period: '30-Day Plan', createdAt: '2026-09-11T08:00:00.000Z',
        momo: true, currency: 'RWF', apiId: 'pay_api_1', financialTxId: null, failureReason: null,
        submitting: false, submitError: null, statusCheckedAt: null, confirmedAt: null,
      }, ...seed.payments],
    }));
    const { default: FarmerPayments } = await import('../pages/farmer/Payments.jsx');
    render(<StoreProvider><Probe /><FarmerPayments /></StoreProvider>);
    await settle(100);

    // The prompt is on the farmer's phone, and the page says so.
    expect(screen.getByText(/Waiting for MTN MoMo/)).toBeInTheDocument();
    const verifiedBefore = screen.getAllByText(/verified by MTN MoMo/).length;
    const check = screen.getByRole('button', { name: /Check status with MTN/ });

    // MTN confirms on the status check the farmer asked for.
    server.refresh = apiRow({
      status: 'successful', provider_confirmed: true, financial_transaction_id: 'MTN-88',
    });
    await act(async () => { fireEvent.click(check); });
    await settle(100);

    const asked = calls.filter((c) => c.method === 'POST' && c.path.endsWith('/api/payments/pay_api_1/refresh'));
    expect(asked).toHaveLength(1);
    const mine = probe.state.payments.find((p) => p.id === 'pay_local_1');
    expect(mine).toMatchObject({ status: 'successful', providerConfirmed: true, financialTxId: 'MTN-88' });
    expect(screen.queryByText(/Waiting for MTN MoMo/)).toBeNull(); // it is no longer pending
    expect(screen.getAllByText(/verified by MTN MoMo/)).toHaveLength(verifiedBefore + 1);
    expect(device(DEVICE).subscription.status).toBe('active');
  });

  it('says so, and offers no way to pay, when the server cannot collect payments', async () => {
    server.momo = { enabled: false, missing: ['MOMO_SUBSCRIPTION_KEY', 'MOMO_API_USER'] };
    seedWith(FARMER);
    const { default: FarmerPayments } = await import('../pages/farmer/Payments.jsx');
    render(<StoreProvider><FarmerPayments /></StoreProvider>);
    await settle(100);

    expect(screen.getByText(/not configured on the server yet \(missing: MOMO_SUBSCRIPTION_KEY, MOMO_API_USER\)/))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Pay for Main Farm (BRD001)' })).toBeDisabled();
    expect(paymentCalls()).toEqual([]); // nothing was ever asked of the API
  });

  it('offers a payment per system the farmer owns, not only for the first', async () => {
    seedWith(FARMER);
    const { default: FarmerPayments } = await import('../pages/farmer/Payments.jsx');
    render(<StoreProvider><FarmerPayments /></StoreProvider>);
    await settle(100);

    fireEvent.click(screen.getByRole('button', { name: '+ Pay for Kigali Farm 2 (BRD002)' }));
    expect(screen.getByRole('heading', { name: 'Pay for Kigali Farm 2 (BRD002)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Request MoMo payment/ })).not.toBeDisabled();
  });
});
