/**
 * The subscription feature end to end: farm size -> band -> price, a payment
 * per batch, and the batch the money is paying for.
 *
 *   INVARIANT   every price the app can show or charge is the sheet's price for
 *               that farm size (never a guess, never the price of another
 *               band), a farmer can never change their own farm size, a payment
 *               always equals the sheet price for (plan, band), and a renewal
 *               extends cover instead of restarting it.
 *   BEHAVIOURAL registering a device records its farm size and prices its plans;
 *               starting a batch is counted against the plan paying for it; a
 *               plan that ends before its batch raises exactly that warning.
 *   FUNCTIONAL  the real farmer page shows the plans of THAT farm size and keeps
 *               the other sizes behind the "View all subscription plans" button.
 */
import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { StoreProvider, useStore } from '../lib/store.jsx';
import { buildSeed } from '../lib/seed.js';
import { generateAlerts, forecastMrr, ALERT_KEYS } from '../lib/services.js';
import {
  BANDS, TERMS, bandForChicks, bandLabel, coverageFor, deviceBand, planPrice, priceFor,
} from '../lib/subscriptions.js';

const KEY = 'broodiinnox_app_v1';
const FARMER = { id: 'f1', name: 'Jean Damascene', role: 'farmer', phone: '0788123456' };
const ADMIN = { id: 'a1', name: 'Innocent Ingabire', role: 'admin', adminRole: 'super', email: 'admin@afriinnox.com' };

let probe = { state: null, dispatch: null };

function Probe() {
  const { state, dispatch } = useStore();
  probe = { state, dispatch };
  return null;
}

function seedWith(session, mutate) {
  const seed = mutate ? mutate(JSON.parse(JSON.stringify(buildSeed()))) : buildSeed();
  localStorage.setItem(KEY, JSON.stringify({ ...seed, session, reminderSent: [] }));
  return seed;
}

const device = (id) => probe.state.devices.find((d) => d.id === id);
const paymentsFor = (id) => probe.state.payments.filter((p) => p.deviceId === id);

beforeEach(() => {
  localStorage.clear();
  probe = { state: null, dispatch: null };
});

/* ------------------------------------------------------------------ */
/* INVARIANT: the sheet is the only source of a price                  */
/* ------------------------------------------------------------------ */

describe('INVARIANT: every price is the sheet price for that farm size', () => {
  it('holds for every seeded device, every plan, and the price it was sold at', () => {
    const { devices } = buildSeed();
    expect(devices.length).toBeGreaterThan(1);

    for (const d of devices) {
      const band = deviceBand(d);
      expect(band, `${d.id} has no band`).toBeTruthy();
      for (const term of TERMS) {
        expect(planPrice(term.id, d.farmSize), `${d.id} / ${term.name}`).toBe(priceFor(band, term));
      }
      // the money on the record is the sheet's price for the band it was BOUGHT for
      if (typeof d.subscription?.price === 'number') {
        expect(d.subscription.price, `${d.id} price paid`).toBe(priceFor(d.subscription.bandId, d.subscription.planId));
      }
    }
  });

  it('holds for every seeded payment too', () => {
    for (const p of buildSeed().payments) {
      if (p.amount === undefined) continue;
      expect(p.amount, `${p.id}`).toBe(priceFor(bandForChicks(p.farmSize), p.planId));
      expect(bandForChicks(p.farmSize).id).toBe(p.bandId);
    }
  });

  it('never lets a farmer set their own farm size', () => {
    seedWith(FARMER);
    render(<StoreProvider><Probe /></StoreProvider>);
    const before = device('BRD001').farmSize;
    act(() => { probe.dispatch({ type: 'SET_DEVICE_FARM_SIZE', deviceId: 'BRD001', farmSize: 200 }); });
    expect(device('BRD001').farmSize).toBe(before); // unchanged: not the farmer's to set
  });

  it('lets Afriinnox set it, without rewriting what is already paid for', () => {
    seedWith(ADMIN);
    render(<StoreProvider><Probe /></StoreProvider>);
    const priced = device('BRD001').subscription.price;

    act(() => { probe.dispatch({ type: 'SET_DEVICE_FARM_SIZE', deviceId: 'BRD001', farmSize: 3000 }); });
    expect(device('BRD001').farmSize).toBe(3000);
    expect(deviceBand(device('BRD001')).id).toBe('b14');
    // the subscription already bought keeps its band and its price
    expect(device('BRD001').subscription.price).toBe(priced);
    expect(probe.state.audit[0].action).toBe('device.farm_size');

    // and the plans offered from now on are the new band's
    expect(planPrice('t30d', 3000)).toBe(100800);
  });

  it('refuses a farm size that is not a count of animals', () => {
    seedWith(ADMIN);
    render(<StoreProvider><Probe /></StoreProvider>);
    const before = device('BRD001').farmSize;
    for (const junk of [0, -5, 1.5, NaN, null, undefined, 'many']) {
      act(() => { probe.dispatch({ type: 'SET_DEVICE_FARM_SIZE', deviceId: 'BRD001', farmSize: junk }); });
      expect(device('BRD001').farmSize).toBe(before);
    }
  });
});

/* ------------------------------------------------------------------ */
/* BEHAVIOURAL: registration, payment, renewal                         */
/* ------------------------------------------------------------------ */

describe('BEHAVIOURAL: a device is registered with the farm size that prices it', () => {
  it('records the farm size and logs the band it was priced in', () => {
    seedWith(ADMIN);
    render(<StoreProvider><Probe /></StoreProvider>);
    act(() => { probe.dispatch({ type: 'REGISTER_DEVICE', serial: 'BRD900', name: 'New Coop', farmerId: 'f1', farmSize: 1200 }); });

    const d = device('BRD900');
    expect(d.farmSize).toBe(1200);
    expect(deviceBand(d).id).toBe('b07');
    expect(d.subscription.planId).toBeNull(); // nothing bought yet
    expect(probe.state.audit[0].details).toMatch(/farm size 1200 chicks \(1,200–1,499 chicks\)/);
  });

  it('registers one without a farm size, but then nothing can be priced', () => {
    seedWith(FARMER);
    render(<StoreProvider><Probe /></StoreProvider>);
    act(() => { probe.dispatch({ type: 'REGISTER_DEVICE', serial: 'BRD901', name: 'No size', farmerId: 'f1' }); });
    expect(device('BRD901').farmSize).toBeNull();
    expect(deviceBand(device('BRD901'))).toBeNull();

    act(() => { probe.dispatch({ type: 'REQUEST_PAYMENT', farmerId: 'f1', deviceId: 'BRD901', planId: 't30d', phone: '0788' }); });
    expect(paymentsFor('BRD901')).toHaveLength(0); // refused, not charged a guess
    expect(probe.state.toast.msg).toMatch(/farm size/i);
  });
});

describe('BEHAVIOURAL: a MoMo payment is the sheet price for (plan, farm size)', () => {
  it("charges the band's price and records the band", () => {
    seedWith(FARMER);
    render(<StoreProvider><Probe /></StoreProvider>);
    const seeded = paymentsFor('BRD001').length;

    act(() => { probe.dispatch({ type: 'REQUEST_PAYMENT', farmerId: 'f1', deviceId: 'BRD001', planId: 't40d', phone: '0788123456' }); });
    const [payment] = paymentsFor('BRD001');
    expect(paymentsFor('BRD001')).toHaveLength(seeded + 1);
    expect(payment).toMatchObject({ planId: 't40d', bandId: 'b06', farmSize: 1000, amount: 59400, status: 'pending' });

    act(() => { probe.dispatch({ type: 'CONFIRM_PAYMENT', paymentId: payment.id, ok: true }); });
    const sub = device('BRD001').subscription;
    expect(sub).toMatchObject({ planId: 't40d', bandId: 'b06', farmSize: 1000, status: 'active' });
    // BRD001's 30-day plan still had days running, so this 40-day plan is added
    // on: 30 + 40 days of cover, and both payments are what it has cost.
    expect(Math.round((Date.parse(sub.endDate) - Date.parse(sub.startDate)) / 86400000)).toBe(70);
    expect(sub.price).toBe(priceFor('b06', 't30d') + 59400);
  });

  it('refuses to charge for a farm size the sheet quotes individually', () => {
    seedWith(FARMER, (seed) => ({
      ...seed,
      devices: seed.devices.map((d) => (d.id === 'BRD001' ? { ...d, farmSize: 20000 } : d)),
    }));
    render(<StoreProvider><Probe /></StoreProvider>);
    const before = paymentsFor('BRD001').length;
    act(() => { probe.dispatch({ type: 'REQUEST_PAYMENT', farmerId: 'f1', deviceId: 'BRD001', planId: 't30d', phone: '0788' }); });
    expect(paymentsFor('BRD001')).toHaveLength(before); // nothing added
    expect(probe.state.toast.msg).toMatch(/individually|custom/i);
  });

  it('renewing while covered ADDS the days and the money instead of resetting', () => {
    seedWith(FARMER);
    render(<StoreProvider><Probe /></StoreProvider>);
    const before = device('BRD001').subscription;
    const beforeDays = Math.round((Date.parse(before.endDate) - Date.parse(before.startDate)) / 86400000);

    act(() => { probe.dispatch({ type: 'REQUEST_PAYMENT', farmerId: 'f1', deviceId: 'BRD001', planId: 't15d', phone: '0788' }); });
    act(() => { probe.dispatch({ type: 'CONFIRM_PAYMENT', paymentId: paymentsFor('BRD001')[0].id, ok: true }); });

    const after = device('BRD001').subscription;
    expect(after.startDate).toBe(before.startDate);              // cover is not thrown away
    const afterDays = Math.round((Date.parse(after.endDate) - Date.parse(after.startDate)) / 86400000);
    expect(afterDays).toBe(beforeDays + 15);                     // the new plan is added on
    expect(after.price).toBe(before.price + priceFor('b06', 't15d'));
    expect(coverageFor(after, null, new Date().toISOString()).paidDays).toBe(afterDays);
  });

  it('a failed payment adds nothing at all', () => {
    seedWith(FARMER);
    render(<StoreProvider><Probe /></StoreProvider>);
    const before = device('BRD002').subscription;
    act(() => { probe.dispatch({ type: 'REQUEST_PAYMENT', farmerId: 'f1', deviceId: 'BRD002', planId: 't6m', phone: '0788' }); });
    act(() => { probe.dispatch({ type: 'CONFIRM_PAYMENT', paymentId: paymentsFor('BRD002')[0].id, ok: false }); });
    expect(device('BRD002').subscription).toEqual(before);
  });
});

/* ------------------------------------------------------------------ */
/* BEHAVIOURAL: the batch and the plan that pays for it                */
/* ------------------------------------------------------------------ */

describe('BEHAVIOURAL: a batch is paid for by the plan, and counted against it', () => {
  it('counts a started batch on the subscription and says how it fits', () => {
    seedWith(FARMER);
    render(<StoreProvider><Probe /></StoreProvider>);
    const before = device('BRD003').subscription.batchesUsed;

    act(() => {
      probe.dispatch({
        type: 'START_BATCH', deviceId: 'BRD003', animal: 'chicken',
        durationDays: 21, count: 900, startDate: new Date().toISOString(),
      });
    });

    expect(device('BRD003').subscription.batchesUsed).toBe(before + 1);
    // the 6-month plan pays for 8 cycles of 21 days
    expect(probe.state.audit[0].details).toMatch(/6-Month Plan covers it \(4 of 8 batches\)/);
  });

  it('warns in the log when the plan cannot see the batch through', () => {
    seedWith(FARMER);
    render(<StoreProvider><Probe /></StoreProvider>);
    act(() => {
      probe.dispatch({
        type: 'START_BATCH', deviceId: 'BRD005', animal: 'pig',
        durationDays: 21, count: 120, startDate: new Date().toISOString(),
      });
    });
    expect(probe.state.audit[0].details).toMatch(/15-Day Plan ends \d+d before it/);
  });

  it('counts nothing against a plan the device does not have', () => {
    seedWith(ADMIN);
    render(<StoreProvider><Probe /></StoreProvider>);
    act(() => { probe.dispatch({ type: 'START_BATCH', deviceId: 'BRD006', animal: 'chicken', durationDays: 21, count: 600, startDate: new Date().toISOString() }); });
    expect(device('BRD006').subscription.batchesUsed).toBe(0); // its plan expired long ago
    expect(probe.state.audit[0].details).toMatch(/no subscription is paying for it/);
  });

  it('raises the shortfall alert exactly when the plan ends before the batch', () => {
    const now = new Date().toISOString();
    const { devices } = buildSeed();
    const byId = Object.fromEntries(devices.map((d) => [d.id, d]));

    // BRD002: a 30-day plan bought 28 days ago, with an 18-day duck batch left.
    const alerts = generateAlerts(byId.BRD002, now);
    const short = alerts.find((a) => a.key === ALERT_KEYS.SUB_SHORT_OF_BATCH);
    expect(short, 'no shortfall alert for BRD002').toBeTruthy();
    expect(short.message).toMatch(/21 days before this 28-day batch/);
    expect(short.severity).toBe('warning');

    // ... and none for the systems whose plan does see the batch through.
    for (const id of ['BRD001', 'BRD003', 'BRD004', 'BRD007']) {
      const keys = generateAlerts(byId[id], now).map((a) => a.key);
      expect(keys, `${id} should not warn about a shortfall`).not.toContain(ALERT_KEYS.SUB_SHORT_OF_BATCH);
    }

    // A plan paying for its last whole batch says so, once.
    expect(generateAlerts(byId.BRD001, now).map((a) => a.key)).toContain(ALERT_KEYS.SUB_LAST_BATCH);
    expect(generateAlerts(byId.BRD003, now).map((a) => a.key)).not.toContain(ALERT_KEYS.SUB_LAST_BATCH);
  });

  it('projects MRR from the price actually paid, not from today\'s sheet', () => {
    const now = new Date().toISOString();
    const devices = buildSeed().devices;
    const expected = devices.reduce((sum, d) => {
      const sub = d.subscription;
      if (sub?.status !== 'active' || Date.parse(sub.endDate) <= Date.parse(now)) return sum;
      const days = Math.round((Date.parse(sub.endDate) - Date.parse(sub.startDate)) / 86400000);
      return sum + sub.price / (days / 30);
    }, 0);
    expect(forecastMrr(devices, buildSeed().plans, now)).toBe(Math.round(expected));

    // an old payment keeps its own price after the sheet changes
    const paid = devices.map((d) => (d.id === 'BRD001' ? { ...d, subscription: { ...d.subscription, price: 1 } } : d));
    expect(forecastMrr(paid, buildSeed().plans, now)).toBeLessThan(forecastMrr(devices, buildSeed().plans, now));
  });
});

/* ------------------------------------------------------------------ */
/* FUNCTIONAL: the farmer's real page                                  */
/* ------------------------------------------------------------------ */

describe('FUNCTIONAL: the farmer sees their own farm size first, other sizes on request', () => {
  async function renderSubscriptions() {
    const { default: FarmerSubscriptions } = await import('../pages/farmer/Subscriptions.jsx');
    return render(
      <StoreProvider>
        <Probe />
        <MemoryRouter initialEntries={['/farmer/subscriptions']}>
          <FarmerSubscriptions />
        </MemoryRouter>
      </StoreProvider>
    );
  }

  it('shows the plans of the farm size each system is registered with', async () => {
    seedWith(FARMER);
    const out = await renderSubscriptions();

    // f1 owns BRD001 (1,000–1,199 chicks) and BRD002 (up to 599 chicks)
    expect(out.getByText('Plans for 1,000–1,199 chicks')).toBeTruthy();
    expect(out.getByText('Plans for Up to 599 chicks')).toBeTruthy();
    expect(out.getAllByText('1,000 chicks').length).toBeGreaterThan(0);

    // the sheet's prices for those two bands, and nothing from any other band
    expect(out.getAllByText(/RWF 52,800/).length).toBeGreaterThan(0);  // 30-Day, 1,000–1,199
    expect(out.getAllByText(/RWF 40,000/).length).toBeGreaterThan(0);  // 30-Day, up to 599
    expect(out.queryByText(/1,368,000/)).toBeNull();                    // 1-Year on 10,000+ chicks
    expect(screen.getByText('View all subscription plans')).toBeTruthy();
  });

  it('opens the whole published price list on request, with the farmer\'s own size marked', async () => {
    seedWith(FARMER);
    const out = await renderSubscriptions();

    fireEvent.click(screen.getByText('View all subscription plans'));

    expect(out.getByText(/RWF 1,368,000/)).toBeTruthy();   // a farm size the farmer does not have
    expect(out.getAllByText('Customized').length).toBeGreaterThan(0); // the top band is quoted individually
    expect(screen.getByText(/Up to 599 chicks · your size/)).toBeTruthy();
    expect(screen.getByText('Hide other farm sizes')).toBeTruthy();
  });

  it('tells the farmer which subscription ends before its batch, and by how long', async () => {
    seedWith(FARMER);
    const out = await renderSubscriptions();
    expect(out.getByText(/Ends 21 days before this 28-day batch does/)).toBeTruthy();
    expect(out.getByText(/subscription\(s\) end before their batch does/)).toBeTruthy();
    expect(out.getAllByText('Your price').length).toBeGreaterThan(0);
  });

  it('estimates from the running batch when no farm size was recorded', async () => {
    seedWith(FARMER, (seed) => ({
      ...seed,
      devices: seed.devices.map((d) => (d.id === 'BRD001' ? { ...d, farmSize: null } : d)),
    }));
    const out = await renderSubscriptions();
    expect(out.getByText(/1,000–1,199 chicks \(estimated from the batch running now\)/)).toBeTruthy();
    expect(out.getByText('Plans for 1,000–1,199 chicks')).toBeTruthy();
  });

  it('quotes no price for a system with no farm size and no batch to infer one from', async () => {
    seedWith(FARMER, (seed) => ({
      ...seed,
      devices: seed.devices.map((d) => (d.id === 'BRD002' ? { ...d, farmSize: null, batch: null } : d)),
    }));
    const out = await renderSubscriptions();
    expect(out.getByText(/No farm size is recorded for this system yet/)).toBeTruthy();
    expect(out.getByText(/not recorded yet/)).toBeTruthy();
    expect(out.queryByText('Plans for Up to 599 chicks')).toBeNull();
    // the farmer is told the size is recorded at installation, not walked through
    // the admin console's screens — no admin navigation path in farmer-facing copy
    expect(out.container.textContent).not.toMatch(/Admin\s*(→|->)/);
    expect(out.getByText(/Afriinnox records it at installation/)).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* FUNCTIONAL: all five plans, with real RWF, wherever plans appear     */
/* ------------------------------------------------------------------ */

describe('FUNCTIONAL: every list of plans names all five and prices them in RWF', () => {
  const ALL_FIVE = ['15-Day Plan', '30-Day Plan', '40-Day Plan', '6-Month Plan', '1-Year Plan'];

  function renderPage(Component, path, session, mutate) {
    seedWith(session, mutate);
    return render(
      <StoreProvider>
        <Probe />
        <MemoryRouter initialEntries={[path]}>
          <Component />
        </MemoryRouter>
      </StoreProvider>
    );
  }

  it("the farmer's plan table names all five plans and prices each one", async () => {
    const { default: FarmerSubscriptions } = await import('../pages/farmer/Subscriptions.jsx');
    const out = renderPage(FarmerSubscriptions, '/farmer/subscriptions', FARMER);

    // BRD001 is registered in the 1,000–1,199 chicks band
    for (const name of ALL_FIVE) expect(out.getAllByText(name).length, name).toBeGreaterThan(0);
    for (const price of [33000, 52800, 59400, 165000, 264000]) {
      expect(out.getAllByText(new RegExp(`RWF ${price.toLocaleString('en-US')}`)).length, `RWF ${price}`).toBeGreaterThan(0);
    }
  });

  it('the payment modal offers all five plans, each priced', async () => {
    const { default: FarmerSubscriptions } = await import('../pages/farmer/Subscriptions.jsx');
    const out = renderPage(FarmerSubscriptions, '/farmer/subscriptions', FARMER);

    fireEvent.click(out.getAllByText('Renew / extend')[0]);
    const options = [...document.querySelectorAll('select option')];
    expect(options).toHaveLength(ALL_FIVE.length);
    for (const name of ALL_FIVE) expect(options.some((o) => o.textContent.includes(name)), name).toBe(true);
    expect(options.every((o) => /RWF [\d,]+/.test(o.textContent))).toBe(true);
  });

  it('a system with no farm size still shows every plan with real RWF, before pressing anything', async () => {
    const { default: FarmerSubscriptions } = await import('../pages/farmer/Subscriptions.jsx');
    const out = renderPage(FarmerSubscriptions, '/farmer/subscriptions', FARMER, (seed) => ({
      ...seed,
      devices: seed.devices.map((d) => (d.farmerId === 'f1' ? { ...d, farmSize: null, batch: null } : d)),
    }));

    expect(out.getAllByText(/No farm size is recorded for this system yet/).length).toBeGreaterThan(0);
    for (const name of ALL_FIVE) expect(out.getAllByText(name).length, name).toBeGreaterThan(0);
    // the whole published list is on screen already: 35 priced bands x 5 plans
    expect((out.container.textContent.match(/RWF [\d,]+/g) || []).length).toBeGreaterThan(150);
    expect(out.getByText('Hide other farm sizes')).toBeTruthy(); // and it can be closed again
    fireEvent.click(out.getByText('Hide other farm sizes'));
    expect(out.queryByText('Hide other farm sizes')).toBeNull();
  });

  it('the admin console shows all five plans, each with real money on the card', async () => {
    const { default: AdminSubscriptions } = await import('../pages/admin/Subscriptions.jsx');
    const out = renderPage(AdminSubscriptions, '/admin/subscriptions', ADMIN);

    // the console names a plan the way the farmer's page does: 15-Day Plan,
    // 30-Day Plan, 40-Day Plan, 6-Month Plan, 1-Year Plan
    for (const name of ALL_FIVE) expect(out.getAllByText(name).length, name).toBeGreaterThan(0);
    // the cheapest and dearest farm size on the sheet, per plan, as money
    expect(out.getByText('RWF 25,000 – RWF 247,000')).toBeTruthy();    // 15-Day
    expect(out.getByText('RWF 40,000 – RWF 395,200')).toBeTruthy();    // 30-Day
    expect(out.getByText('RWF 45,000 – RWF 444,600')).toBeTruthy();    // 40-Day
    expect(out.getByText('RWF 125,000 – RWF 1,235,000')).toBeTruthy(); // 6-Month
    expect(out.getByText('RWF 200,000 – RWF 1,976,000')).toBeTruthy(); // annual
    expect(out.getByText(/RWF 25,000 for Up to 599 chicks/)).toBeTruthy();
    // and the full price list behind them — every farm size against every plan,
    // read as the list it is: text, with one Edit button, until someone edits it
    const list = [...out.container.querySelectorAll('.table-wrap table')].map((tb) => tb.textContent).join(' ');
    expect(list).toMatch(/RWF 1,368,000/); // 1-Year on 10,000–10,999 chicks
    expect(list).toMatch(/RWF 347,200/);   // 1-Year on 13,000–13,999 chicks
    expect(list).toMatch(/Customized/);    // the top row, quoted individually
    expect(out.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
  });
});
