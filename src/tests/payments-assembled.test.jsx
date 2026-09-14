/**
 * Assembled exercise of the payment path — the program as a farmer meets it,
 * not a unit in isolation. The REAL entry chain is mounted
 * (HashRouter -> StoreProvider -> App) cold-started on the farmer payments
 * route, with a fake broodiinnox-api and the Ekorana gateway behind fetch, and
 * the farmer is driven through it: open the page, press Pay, type a number,
 * request the payment. It asserts on what actually left the app and what the
 * app says afterwards — the route is registered, the page is mounted, the modal
 * is wired to the store, the store reaches the API, and the pending payment is
 * shown.
 */
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import { planPrice } from '../lib/subscriptions.js';

const KEY = 'broodiinnox_app_v1';
const FARMER = { id: 'f1', name: 'Jean Damascene', role: 'farmer', phone: '0788123456' };

let calls = [];
let App;
let StoreProvider;
let buildSeed;

const apiRow = {
  id: 'pay_api_9', device_id: 'BRD001', farmer_id: 'f1', plan_id: 't30d', band_id: 'b06',
  amount: 33000, currency: 'RWF', phone: '250788123456', method: 'MTN MoMo',
  status: 'pending', provider_confirmed: false, provider_ref: 'ref-live-1',
  financial_transaction_id: null, reason: null,
  created_at: '2026-09-11T08:00:00.000Z', confirmed_at: null, status_checked_at: null,
};

beforeEach(async () => {
  localStorage.clear();
  calls = [];
  window.location.hash = '#/farmer/payments';
  vi.unstubAllEnvs();
  vi.stubEnv('VITE_IOT_API_URL', 'https://iot.local');
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ method, path: u, body });
    const reply = (payload, status = 200) => ({
      ok: status < 300, status, text: async () => JSON.stringify(payload),
    });
    if (u.endsWith('/api/health')) return reply({ ok: true, ekopay: { enabled: true, missing: [], invalid: [] } });
    if (method === 'POST' && u.endsWith('/api/payments')) return reply({ payment: apiRow, reused: false }, 201);
    if (method === 'GET' && /\/api\/payments\/[^/?]+$/.test(u)) return reply({ payment: apiRow });
    if (u.includes('/api/payments')) return reply({ count: 0, payments: [] });
    if (u.endsWith('/api/devices')) return reply({ count: 0, devices: [] });
    return reply({ ok: true });
  }));

  App = (await import('../App.jsx')).default;
  ({ StoreProvider } = await import('../lib/store.jsx'));
  ({ buildSeed } = await import('../lib/seed.js'));
  localStorage.setItem(KEY, JSON.stringify({ ...buildSeed(), session: FARMER, lang: 'en', reminderSent: [] }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('a farmer opens Payments, requests a MoMo payment, and the app asks the API for it', async () => {
  render(<HashRouter><StoreProvider><App /></StoreProvider></HashRouter>);

  // The route is registered and the page is mounted.
  expect(await screen.findByRole('heading', { name: 'Payments' })).toBeInTheDocument();

  // The farmer picks their system and opens the payment modal. The plan it
  // opens on is whatever the app has active; the price charged must be THAT
  // plan's sheet price for this farm size.
  fireEvent.click(await screen.findByRole('button', { name: '+ Pay for Main Farm (BRD001)' }));
  const chosen = within(document.querySelector('.modal')).getByRole('combobox').value;
  const phone = screen.getByPlaceholderText('0788123456');
  fireEvent.change(phone, { target: { value: '0788 123 456' } });
  expect(screen.getByText(/MTN MoMo prompt on 0788 123 456/)).toBeInTheDocument();

  const verifiedBefore = screen.getAllByText(/verified by MTN MoMo/).length; // the seeded history
  fireEvent.click(screen.getByRole('button', { name: /Request MoMo payment/ }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  // What actually left the app: one request to broodiinnox-api, for the plan on
  // screen, at the sheet price for that farm size, to the number normalized to
  // an MSISDN.
  const posts = calls.filter((c) => c.method === 'POST' && c.path.endsWith('/api/payments'));
  expect(posts).toHaveLength(1);
  expect(posts[0].body).toMatchObject({
    device_id: 'BRD001', band_id: 'b06', currency: 'RWF', phone: '250788123456',
  });
  expect(posts[0].body.plan_id).toBe(chosen);
  expect(posts[0].body.amount).toBe(planPrice(chosen, 1000));

  // And what the app shows afterwards: the prompt is live on that number, with
  // MTN's own reference, and nothing has been unlocked by pressing a button.
  expect(await screen.findByText(/Waiting for MTN MoMo/)).toBeInTheDocument();
  expect(screen.getByText('MTN ref ref-live-1')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Check status with MTN/ })).toBeInTheDocument();
  // Nothing has been confirmed: requesting a payment marks nothing as verified.
  expect(screen.getAllByText(/verified by MTN MoMo/)).toHaveLength(verifiedBefore);

  // Printed for the record: the request the assembled app sent, and the DOM.
  console.log('[assembled] POST /api/payments ->', JSON.stringify(posts[0].body));
  console.log('[assembled] pending row shows:', screen.getByText(/Waiting for MTN MoMo/).textContent);
});
