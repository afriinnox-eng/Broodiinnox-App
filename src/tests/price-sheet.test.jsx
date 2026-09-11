/**
 * The price list is editable, and it is the ONLY price in the app.
 *
 *   INVARIANT   the sheet starts as the published sheet — every one of the 36
 *               farm sizes x 5 plans is the price the PDF prints, nothing moved;
 *               it tiles the chick range so every farm size falls in exactly one
 *               row; only an Afriinnox admin can edit it; an edit the sheet
 *               refuses changes nothing at all; and editing a price never
 *               re-prices a subscription or a payment already made.
 *   BEHAVIOURAL an edited price is what the farmer is shown AND what MoMo is
 *               asked for; a renamed plan or farm size reads the same on both
 *               sides; "Reset" puts the published list back.
 *   FUNCTIONAL  typing in a cell on the admin page saves it, and the farmer's
 *               own page then shows that number.
 */
import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, render } from '@testing-library/react';
import { StoreProvider, useStore } from '../lib/store.jsx';
import { buildSeed } from '../lib/seed.js';
import {
  BANDS, MAX_PRICE, TERMS, bandForChicks, planFrom, publishedSheet, sheetBandForChicks,
  sheetBandIsPriced, sheetBandLabel, sheetBands, sheetPrice, sheetWithBand, sheetWithPrice,
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

/** A mounted store, with the session and any edit already in place. */
function mount(session, edit) {
  const seed = JSON.parse(JSON.stringify(buildSeed()));
  if (edit) seed.sheet = edit(seed.sheet, seed);
  localStorage.setItem(KEY, JSON.stringify({ ...seed, session, reminderSent: [] }));
  return render(<StoreProvider><Probe /></StoreProvider>);
}

function mountPage(Component, session, edit, path = '/') {
  const seed = JSON.parse(JSON.stringify(buildSeed()));
  if (edit) seed.sheet = edit(seed.sheet, seed);
  localStorage.setItem(KEY, JSON.stringify({ ...seed, session, reminderSent: [] }));
  return render(
    <StoreProvider>
      <Probe />
      <MemoryRouter initialEntries={[path]}><Component /></MemoryRouter>
    </StoreProvider>
  );
}

/**
 * Mount a page on the state the store has ALREADY saved — so a page can be
 * opened as a second user reading the same edited list, not a fresh seed.
 */
function mountPageOnSavedState(Component, session, path = '/') {
  const saved = JSON.parse(localStorage.getItem(KEY));
  localStorage.setItem(KEY, JSON.stringify({ ...saved, session }));
  return render(
    <StoreProvider>
      <Probe />
      <MemoryRouter initialEntries={[path]}><Component /></MemoryRouter>
    </StoreProvider>
  );
}

const sheetCell = (sheet, bandId, planId) => sheetPrice(sheet, sheetBands(sheet).find((b) => b.id === bandId), planId);

beforeEach(() => {
  localStorage.clear();
  probe = { state: null, dispatch: null };
});

/* ------------------------------------------------------------------ */
/* INVARIANT: as published                                             */
/* ------------------------------------------------------------------ */

describe('INVARIANT: the editable sheet starts as the published sheet', () => {
  it('reproduces the printed price of all 36 farm sizes on all 5 plans', () => {
    const sheet = publishedSheet();
    expect(sheet.bands).toHaveLength(36);
    let checked = 0;
    for (const band of BANDS) {
      for (const term of TERMS) {
        const cell = sheetCell(sheet, band.id, term.id);
        const published = priceForPublished(band, term);
        expect(cell, `${band.id} / ${term.name}`).toBe(published);
        if (published !== null) checked++;
      }
    }
    expect(checked).toBe(35 * 5); // the top row is "Customized"
  });

  it('quotes nothing above 15,999 chicks, and never invents a price there', () => {
    const sheet = publishedSheet();
    const top = sheet.bands[sheet.bands.length - 1];
    expect(top.max).toBeNull();
    for (const term of TERMS) expect(sheetCell(sheet, top.id, term.id)).toBeNull();
    expect(sheetBandIsPriced(sheet, top)).toBe(false);
    expect(sheetPrice(sheet, sheetBandForChicks(sheet, 20000), planFrom(buildSeed().plans, 't30d'))).toBeNull();
  });

  it('tiles the chick range: every count lands in exactly one row, on any sheet', () => {
    const sheets = [
      publishedSheet(),
      sheetWithBand(publishedSheet(), 'b06', { min: 990, max: 1250 }),   // re-ranged
      sheetWithBand(publishedSheet(), 'b01', { label: 'Small flock' }),  // renamed
    ];
    for (const sheet of sheets) {
      const bands = sheetBands(sheet);
      for (const n of [1, 2, 599, 600, 999, 1000, 1250, 1251, 16000, 999999]) {
        const hits = bands.filter((b) => n >= b.min && (b.max === null || n <= b.max));
        expect(hits, `chicks=${n} matched ${hits.length} rows`).toHaveLength(1);
      }
      // and the labels stay readable, however they were renamed
      for (const band of bands) expect(sheetBandLabel(sheet, band).trim()).not.toBe('');
    }
  });
});

/* ------------------------------------------------------------------ */
/* INVARIANT: refusals, authority and history                          */
/* ------------------------------------------------------------------ */

describe('INVARIANT: what the sheet refuses, and what an edit cannot reach', () => {
  const BAD_PRICES = [
    ['a negative price', -5],
    ['a fractional price', 1500.5],
    ['not a number', 'abc'],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['a price above the ceiling', MAX_PRICE + 1],
  ];

  it.each(BAD_PRICES)('refuses %s and leaves the sheet exactly as it was', async (_label, price) => {
    const before = JSON.stringify(publishedSheet());
    mount(ADMIN);
    await act(async () => { probe.dispatch({ type: 'SHEET_SET_PRICE', bandId: 'b06', planId: 't30d', price }); });
    expect(JSON.stringify(probe.state.sheet)).toBe(before);
    expect(probe.state.toast?.kind).toBe('error');
    expect(probe.state.toast.msg.length).toBeGreaterThan(10);
  });

  const BAD_ROWS = [
    ['an empty name', { label: '   ' }],
    ['a first row that does not start at 1', { min: 0 }],
    ['a range that opens the wrong end of a row and overlaps its neighbour', { min: 500 }],
    ['a maximum below its minimum', { min: 1200, max: 1100 }],
    ['closing the top row', { max: 20000 }],
  ];

  it.each(BAD_ROWS)('refuses %s and leaves the sheet exactly as it was', async (_label, patch) => {
    const before = JSON.stringify(publishedSheet());
    mount(ADMIN);
    const bandId = patch.max === 20000 ? 'b36' : 'b06';
    await act(async () => { probe.dispatch({ type: 'SHEET_SET_BAND', bandId, patch }); });
    expect(JSON.stringify(probe.state.sheet)).toBe(before);
    expect(probe.state.toast?.kind).toBe('error');
  });

  it('lets no one but an admin touch the list', async () => {
    const before = JSON.stringify(publishedSheet());
    mount(FARMER);
    await act(async () => { probe.dispatch({ type: 'SHEET_SET_PRICE', bandId: 'b06', planId: 't30d', price: 1 }); });
    await act(async () => { probe.dispatch({ type: 'SHEET_SET_BAND', bandId: 'b06', patch: { label: 'Mine now' } }); });
    await act(async () => { probe.dispatch({ type: 'SHEET_RESET' }); });
    expect(JSON.stringify(probe.state.sheet)).toBe(before);
  });

  it('never re-prices what was already sold, however the list is edited', async () => {
    mount(ADMIN);
    const before = {
      subs: probe.state.devices.map((d) => d.subscription?.price ?? null),
      payments: probe.state.payments.map((p) => p.amount),
    };
    await act(async () => {
      probe.dispatch({ type: 'SHEET_SET_PRICE', bandId: 'b06', planId: 't30d', price: 999999 });
      probe.dispatch({ type: 'SHEET_SET_BAND', bandId: 'b06', patch: { label: 'Renamed row' } });
    });
    expect(probe.state.devices.map((d) => d.subscription?.price ?? null)).toEqual(before.subs);
    expect(probe.state.payments.map((p) => p.amount)).toEqual(before.payments);
    // the new price is what is quoted now, though
    expect(sheetCell(probe.state.sheet, 'b06', 't30d')).toBe(999999);
  });

  it('records who changed the list, and resets to the published one', async () => {
    mount(ADMIN);
    await act(async () => { probe.dispatch({ type: 'SHEET_SET_PRICE', bandId: 'b06', planId: 't30d', price: 60000 }); });
    expect(probe.state.sheet.updatedBy).toBe(ADMIN.name);
    expect(probe.state.sheet.updatedAt).toBeTruthy();
    expect(probe.state.audit[0].action).toBe('price_sheet.price');
    expect(probe.state.audit[0].details).toMatch(/RWF 52,800 → RWF 60,000/);

    await act(async () => { probe.dispatch({ type: 'SHEET_RESET' }); });
    expect(JSON.stringify(probe.state.sheet)).toBe(JSON.stringify(publishedSheet()));
    expect(probe.state.audit[0].action).toBe('price_sheet.reset');
  });

  it('survives a reload, and an older browser that saved no list gets the published one', async () => {
    mount(ADMIN);
    await act(async () => { probe.dispatch({ type: 'SHEET_SET_PRICE', bandId: 'b06', planId: 't30d', price: 60000 }); });

    // a fresh store, reading the same localStorage
    const out = render(<StoreProvider><Probe /></StoreProvider>);
    expect(sheetCell(probe.state.sheet, 'b06', 't30d')).toBe(60000);
    out.unmount();

    // a state saved before the list was editable carries no sheet
    const legacy = { ...JSON.parse(localStorage.getItem(KEY)) };
    delete legacy.sheet;
    localStorage.setItem(KEY, JSON.stringify(legacy));
    render(<StoreProvider><Probe /></StoreProvider>);
    expect(probe.state.sheet.bands).toHaveLength(36);
    expect(sheetCell(probe.state.sheet, 'b06', 't30d')).toBe(52800);
  });
});

/* ------------------------------------------------------------------ */
/* BEHAVIOURAL: the edited list is what the farmer is shown and charged */
/* ------------------------------------------------------------------ */

describe('BEHAVIOURAL: an edited price is the price the farmer meets', () => {
  const editThirtyDay = (sheet) => sheetWithPrice(sheet, 'b06', 't30d', 60000);

  it('shows the edited price on the farmer page, and still shows what was paid', async () => {
    const { default: FarmerSubscriptions } = await import('../pages/farmer/Subscriptions.jsx');
    const out = mountPage(FarmerSubscriptions, FARMER, editThirtyDay, '/farmer/subscriptions');

    // BRD001 is registered in the 1,000–1,199 chicks band: the plans it can buy
    // now cost the edited price, and no longer quote the old one…
    const shops = [...out.container.querySelectorAll('.table-wrap table')]
      .filter((t) => /Your price/.test(t.textContent))
      .map((t) => t.textContent).join(' ');
    expect(shops).toMatch(/RWF 60,000/);
    expect(shops).not.toMatch(/RWF 52,800/);
    // …while the 15-Day column and every other farm size are untouched
    expect(shops).toMatch(/RWF 33,000/);
    // and the history still shows the price that was actually paid — an edit
    // never rewrites what a farmer has already bought
    expect(out.getAllByText('RWF 52,800').length).toBeGreaterThan(0);
  });

  it('charges exactly the edited price when MoMo is asked for', async () => {
    mount(FARMER, editThirtyDay);
    await act(async () => {
      probe.dispatch({ type: 'REQUEST_PAYMENT', farmerId: 'f1', deviceId: 'BRD001', planId: 't30d', phone: '0788123456' });
    });
    const payment = probe.state.payments[0];
    expect(payment.deviceId).toBe('BRD001');
    expect(payment.amount).toBe(60000);
    expect(payment.bandId).toBe('b06');
    expect(payment.period).toMatch(/30-Day Plan — 1,000–1,199 chicks/);
  });

  it('refuses to charge where the list quotes nothing', async () => {
    mount(FARMER, (sheet) => sheetWithPrice(sheet, 'b06', 't30d', null));
    await act(async () => {
      probe.dispatch({ type: 'REQUEST_PAYMENT', farmerId: 'f1', deviceId: 'BRD001', planId: 't30d', phone: '0788123456' });
    });
    expect(probe.state.payments.filter((p) => p.deviceId === 'BRD001' && p.status === 'pending')).toHaveLength(0);
    expect(probe.state.toast.msg).toMatch(/quoted individually/i);
  });

  it('reads a renamed plan and a renamed farm size the same on both sides', async () => {
    const rename = (sheet) => {
      const renamed = sheetWithBand(sheet, 'b06', { label: '1,000 to 1,199 birds' });
      return renamed;
    };
    const { default: FarmerSubscriptions } = await import('../pages/farmer/Subscriptions.jsx');
    const farmer = mountPage(FarmerSubscriptions, FARMER, rename, '/farmer/subscriptions');
    expect(farmer.getAllByText(/1,000 to 1,199 birds/).length).toBeGreaterThan(0);
    farmer.unmount();

    const { default: AdminSubscriptions } = await import('../pages/admin/Subscriptions.jsx');
    const admin = mountPage(AdminSubscriptions, ADMIN, rename, '/admin/subscriptions');
    expect(admin.getAllByText(/1,000 to 1,199 birds/).length).toBeGreaterThan(0);
  });

  it('renames a plan column everywhere when the admin renames it', async () => {
    mount(ADMIN);
    await act(async () => { probe.dispatch({ type: 'UPDATE_PLAN', id: 't30d', patch: { name: 'Monthly Plan' } }); });
    expect(probe.state.plans.find((p) => p.id === 't30d').name).toBe('Monthly Plan');
    expect(probe.state.audit[0].action).toBe('plan.rename');
    expect(probe.state.audit[0].details).toMatch(/30-Day Plan → Monthly Plan/);

    // the farmer, opening their own page on the same state, reads the new name
    const { default: FarmerSubscriptions } = await import('../pages/farmer/Subscriptions.jsx');
    const farmer = mountPageOnSavedState(FarmerSubscriptions, FARMER, '/farmer/subscriptions');
    expect(farmer.getAllByText('Monthly Plan').length).toBeGreaterThan(0);
    expect(farmer.queryByText('30-Day Plan')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* FUNCTIONAL: typing in the admin page's own cell                     */
/* ------------------------------------------------------------------ */

describe('FUNCTIONAL: the admin types a price into the list itself', () => {
  it('saves it on blur, and the farmer page then shows that number', async () => {
    const { default: AdminSubscriptions } = await import('../pages/admin/Subscriptions.jsx');
    const admin = mountPage(AdminSubscriptions, ADMIN, null, '/admin/subscriptions');

    const cell = admin.container.querySelector('input[aria-label="30-Day Plan — 1,000–1,199 chicks"]');
    expect(cell).toBeTruthy();
    expect(cell.value).toBe('52800');

    fireEvent.focus(cell);
    fireEvent.change(cell, { target: { value: '60000' } });
    fireEvent.blur(cell);
    await act(async () => {});

    expect(sheetCell(probe.state.sheet, 'b06', 't30d')).toBe(60000);
    expect(admin.container.querySelector('input[aria-label="30-Day Plan — 1,000–1,199 chicks"]').value).toBe('60000');
    admin.unmount();

    // the farmer opens their page on the same state: the saved price is theirs
    const { default: FarmerSubscriptions } = await import('../pages/farmer/Subscriptions.jsx');
    const farmer = mountPageOnSavedState(FarmerSubscriptions, FARMER, '/farmer/subscriptions');
    expect(farmer.getAllByText('RWF 60,000').length).toBeGreaterThan(0);
  });

  it('renames a farm size from the same row, on screen, and the farmer reads it', async () => {
    const { default: AdminSubscriptions } = await import('../pages/admin/Subscriptions.jsx');
    const admin = mountPage(AdminSubscriptions, ADMIN, null, '/admin/subscriptions');

    const nameInput = admin.container.querySelector('input[aria-label="Farm size name"]');
    expect(nameInput.value).toBe('Up to 599 chicks');
    fireEvent.focus(nameInput);
    fireEvent.change(nameInput, { target: { value: 'Starter flock (up to 599)' } });
    fireEvent.blur(nameInput);
    await act(async () => {});

    expect(sheetBandLabel(probe.state.sheet, sheetBands(probe.state.sheet)[0])).toBe('Starter flock (up to 599)');
    admin.unmount();

    const { default: FarmerSubscriptions } = await import('../pages/farmer/Subscriptions.jsx');
    const farmer = mountPageOnSavedState(FarmerSubscriptions, FARMER, '/farmer/subscriptions');
    expect(farmer.getAllByText(/Starter flock \(up to 599\)/).length).toBeGreaterThan(0);
  });

  it('refuses a typo in the cell, says why, and keeps the old price', async () => {
    const { default: AdminSubscriptions } = await import('../pages/admin/Subscriptions.jsx');
    const admin = mountPage(AdminSubscriptions, ADMIN, null, '/admin/subscriptions');

    const cell = admin.container.querySelector('input[aria-label="30-Day Plan — 1,000–1,199 chicks"]');
    fireEvent.focus(cell);
    fireEvent.change(cell, { target: { value: '52 800 RWF' } });
    fireEvent.blur(cell);
    await act(async () => {});

    expect(sheetCell(probe.state.sheet, 'b06', 't30d')).toBe(52800); // unchanged
    expect(probe.state.toast?.kind).toBe('error');
  });
});

/** The published sheet's own arithmetic (base x multiplier), for comparison. */
function priceForPublished(band, term) {
  if (typeof band.base !== 'number') return null;
  const price = Math.round(band.base * term.multiplier);
  return Number.isFinite(price) ? price : null;
}

/* keeps the exported-but-unused import honest in the lint-free sense */
void bandForChicks;
