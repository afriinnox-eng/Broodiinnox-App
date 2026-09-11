/**
 * The price list is edited in two steps, and the step matters.
 *
 *   INVARIANT   the published list starts as the sheet the PDF prints, keeps one
 *               row per farm size (the ranges are not editable, so no installed
 *               system ever changes band), refuses anything that would break it,
 *               can be changed by an Afriinnox admin and nobody else, and never
 *               re-prices a subscription or a payment already made.
 *               A SAVED list is a draft: farmers and the MoMo amount still see
 *               the PUBLISHED one until the admin publishes.
 *   BEHAVIOURAL publishing is what reaches farmers, and every farmer the change
 *               concerns is notified in words naming what changed (plan name,
 *               duration, the amount for their own farm size).
 *   FUNCTIONAL  on the console: Edit, change a cell, Save, Publish — and the
 *               farmer's own page shows the new price only after the publish.
 */
import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, render } from '@testing-library/react';
import { StoreProvider, useStore } from '../lib/store.jsx';
import { buildSeed } from '../lib/seed.js';
import {
  BANDS, MAX_PRICE, TERMS, bandForChicks, draftError, publishedSheet, sheetBandLabel, sheetBands,
  sheetChanges, sheetPrice, sheetWithPrice,
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

const clone = (v) => JSON.parse(JSON.stringify(v));

/** A mounted store with the session, and optionally an already-published change. */
function mount(session, edit) {
  const seed = clone(buildSeed());
  if (edit) seed.sheet = edit(seed.sheet, seed);
  localStorage.setItem(KEY, JSON.stringify({ ...seed, session, reminderSent: [] }));
  return render(<StoreProvider><Probe /></StoreProvider>);
}

function mountPage(Component, session, path = '/') {
  const seed = clone(buildSeed());
  localStorage.setItem(KEY, JSON.stringify({ ...seed, session, reminderSent: [] }));
  return render(
    <StoreProvider>
      <Probe />
      <MemoryRouter initialEntries={[path]}><Component /></MemoryRouter>
    </StoreProvider>
  );
}

/** Mount a page on the state the store already holds — admin edits included. */
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

/* ------------------------------ editing helpers ------------------------------ */

/** Save a working copy to the store, mutated from the draft (or the published list). */
async function save(mutate, { dispatchFn } = {}) {
  const source = probe.state.sheetDraft || { bands: probe.state.sheet.bands, plans: probe.state.plans };
  const working = { bands: clone(source.bands), plans: clone(source.plans) };
  if (mutate) mutate(working);
  await act(async () => { (dispatchFn || probe.dispatch)({ type: 'SHEET_SAVE', bands: working.bands, plans: working.plans }); });
  return working;
}

const setPrice = (working, bandId, planId, price) => {
  working.bands.find((b) => b.id === bandId).prices[planId] = price;
};
const setLabel = (working, bandId, label) => {
  working.bands.find((b) => b.id === bandId).label = label;
};
const setPlan = (working, planId, patch) => {
  Object.assign(working.plans.find((p) => p.id === planId), patch);
};

const publish = async () => { await act(async () => { probe.dispatch({ type: 'SHEET_PUBLISH' }); }); };
const discard = async () => { await act(async () => { probe.dispatch({ type: 'SHEET_DISCARD' }); }); };

const publishedPrice = (bandId, planId) => sheetPrice({ bands: probe.state.sheet.bands }, bandId, planId);
const draftPrice = (bandId, planId) => (probe.state.sheetDraft
  ? sheetPrice({ bands: probe.state.sheetDraft.bands }, bandId, planId)
  : null);
const notificationsFor = (farmerId) => probe.state.notifications.filter((n) => n.farmerId === farmerId);
/** Only what publishing added — the seed already carries notifications of its own. */
const noticesFor = (farmerId) => notificationsFor(farmerId).filter((n) => n.title === 'Price list updated');

/** The published list as the store holds it: the printed bands, and the app's plans. */
const publishedList = () => ({ bands: publishedSheet().bands, plans: clone(buildSeed().plans) });

/** The farmers the seed says hold a given plan. */
const holdersOf = (planId) => [...new Set(buildSeed().devices.filter((d) => d.subscription?.planId === planId).map((d) => d.farmerId))];
/** The farmers holding a given plan on a given farm size. */
const holdersOfBand = (planId, bandId) => [...new Set(buildSeed().devices
  .filter((d) => d.subscription?.planId === planId && bandForChicks(d.farmSize)?.id === bandId)
  .map((d) => d.farmerId))];

beforeEach(() => {
  localStorage.clear();
  probe = { state: null, dispatch: null };
});

/* ------------------------------------------------------------------ */
/* INVARIANT: as published, and what cannot change                     */
/* ------------------------------------------------------------------ */

describe('INVARIANT: the published list is the printed sheet', () => {
  it('reproduces the price of all 36 farm sizes on all 5 plans', () => {
    const sheet = publishedSheet();
    expect(sheet.bands).toHaveLength(36);
    let priced = 0;
    for (const band of BANDS) {
      for (const term of TERMS) {
        const expected = typeof band.base === 'number' ? Math.round(band.base * term.multiplier) : null;
        expect(sheetPrice(sheet, band, term), `${band.id} / ${term.name}`).toBe(expected);
        if (expected !== null) priced++;
      }
    }
    expect(priced).toBe(35 * 5);
  });

  it('quotes nothing above 15,999 chicks and never invents a price there', () => {
    const sheet = publishedSheet();
    const top = sheet.bands[sheet.bands.length - 1];
    expect(top.max).toBeNull();
    for (const term of TERMS) expect(sheetPrice(sheet, top, term)).toBeNull();
  });

  it('keeps one row per farm size on ANY saved list: the ranges are not editable', () => {
    const published = publishedList();
    const tiling = (bands) => {
      for (const n of [1, 599, 600, 1199, 1200, 16000, 999999]) {
        const hits = bands.filter((b) => n >= b.min && (b.max === null || n <= b.max));
        expect(hits, `chicks=${n}`).toHaveLength(1);
      }
    };
    tiling(published.bands);

    // a saved list that re-ranges a row, adds one, drops one or empties a name is refused
    const attempts = [
      (w) => { w.bands[5].min = 990; },
      (w) => { w.bands[5].max = 1250; },
      (w) => { w.bands.pop(); },
      (w) => { w.bands[0].label = '   '; },
    ];
    for (const mutate of attempts) {
      const working = clone(published);
      mutate(working);
      expect(draftError(published, working), JSON.stringify(working.bands[5])).toBeTruthy();
    }
    // and the list the app holds still tiles after all that
    tiling(publishedList().bands);
  });

  it('refuses a plan that loses its name, its length, or is removed outright', () => {
    const published = publishedList();
    const attempts = [
      (w) => setPlan(w, 't30d', { name: '  ' }),
      (w) => { setPlan(w, 't30d', { name: 'Same name' }); setPlan(w, 't40d', { name: 'Same name' }); },
      (w) => setPlan(w, 't30d', { durationDays: 0 }),
      (w) => setPlan(w, 't30d', { durationDays: 30.5 }),
      (w) => { w.plans = w.plans.filter((p) => p.id !== 't30d'); },
    ];
    for (const mutate of attempts) {
      const working = clone(published);
      mutate(working);
      expect(draftError(published, working), JSON.stringify(working.plans)).toBeTruthy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* INVARIANT: what a save refuses, and who may save                    */
/* ------------------------------------------------------------------ */

describe('INVARIANT: a save changes nothing it cannot justify', () => {
  const BAD = [
    ['a negative price', -5],
    ['a fractional price', 1500.5],
    ['not a number at all', 'abc'],
    ['NaN', NaN],
    ['a price above the ceiling', MAX_PRICE + 1],
  ];

  it.each(BAD)('refuses %s and leaves both lists exactly as they were', async (_label, price) => {
    mount(ADMIN);
    const before = JSON.stringify({ sheet: probe.state.sheet, plans: probe.state.plans });
    await save((w) => setPrice(w, 'b06', 't30d', price));
    expect(JSON.stringify({ sheet: probe.state.sheet, plans: probe.state.plans })).toBe(before);
    expect(probe.state.sheetDraft ?? null).toBeNull();
    expect(probe.state.toast?.kind).toBe('error');
    expect(probe.state.toast.msg.length).toBeGreaterThan(10);
  });

  it('lets no one but an admin save, discard or publish', async () => {
    mount(FARMER);
    const before = JSON.stringify(probe.state.sheet);
    await save((w) => setPrice(w, 'b06', 't30d', 1));
    await publish();
    await discard();
    expect(JSON.stringify(probe.state.sheet)).toBe(before);
    expect(probe.state.sheetDraft ?? null).toBeNull();
    expect(probe.state.notifications).toHaveLength(buildSeed().notifications.length);
  });

  it('needs a saved list before it will publish or discard one', async () => {
    mount(ADMIN);
    await publish();
    expect(probe.state.toast?.kind).toBe('error');
    expect(probe.state.toast.msg).toMatch(/nothing saved to publish/i);
    await discard();
    expect(probe.state.toast.msg).toMatch(/nothing saved to discard/i);
  });
});

/* ------------------------------------------------------------------ */
/* INVARIANT: a draft is private until it is published                 */
/* ------------------------------------------------------------------ */

describe('INVARIANT: a saved list is the admin\'s alone until published', () => {
  it('leaves the farmer, and the amount MoMo is asked for, on the published price', async () => {
    mount(ADMIN);
    await save((w) => setPrice(w, 'b06', 't30d', 60000));
    expect(draftPrice('b06', 't30d')).toBe(60000);   // saved…
    expect(publishedPrice('b06', 't30d')).toBe(52800); // …not published
    const saved = JSON.parse(localStorage.getItem(KEY));

    // the farmer's page
    const { default: FarmerSubscriptions } = await import('../pages/farmer/Subscriptions.jsx');
    const out = mountPageOnSavedState(FarmerSubscriptions, FARMER, '/farmer/subscriptions');
    const shops = [...out.container.querySelectorAll('.table-wrap table')]
      .filter((tb) => /Your price/.test(tb.textContent)).map((tb) => tb.textContent).join(' ');
    expect(shops).toMatch(/RWF 52,800/);
    expect(shops).not.toMatch(/RWF 60,000/);
    out.unmount();

    // and what a payment asks for
    localStorage.setItem(KEY, JSON.stringify({ ...saved, session: FARMER }));
    render(<StoreProvider><Probe /></StoreProvider>);
    await act(async () => {
      probe.dispatch({ type: 'REQUEST_PAYMENT', farmerId: 'f1', deviceId: 'BRD001', planId: 't30d', phone: '0788123456' });
    });
    expect(probe.state.payments[0].amount).toBe(52800);
  });

  it('reaches the farmer and the amount charged the moment it is published', async () => {
    mount(ADMIN);
    await save((w) => setPrice(w, 'b06', 't30d', 60000));
    await publish();
    expect(probe.state.sheetDraft).toBeNull();
    expect(publishedPrice('b06', 't30d')).toBe(60000);

    const saved = JSON.parse(localStorage.getItem(KEY));
    const { default: FarmerSubscriptions } = await import('../pages/farmer/Subscriptions.jsx');
    const out = mountPageOnSavedState(FarmerSubscriptions, FARMER, '/farmer/subscriptions');
    const shops = [...out.container.querySelectorAll('.table-wrap table')]
      .filter((tb) => /Your price/.test(tb.textContent)).map((tb) => tb.textContent).join(' ');
    expect(shops).toMatch(/RWF 60,000/);
    out.unmount();

    localStorage.setItem(KEY, JSON.stringify({ ...saved, session: FARMER }));
    render(<StoreProvider><Probe /></StoreProvider>);
    await act(async () => {
      probe.dispatch({ type: 'REQUEST_PAYMENT', farmerId: 'f1', deviceId: 'BRD001', planId: 't30d', phone: '0788123456' });
    });
    expect(probe.state.payments[0].amount).toBe(60000);
  });

  it('never re-prices what was already sold, however the list is changed', async () => {
    mount(ADMIN);
    const before = {
      subs: probe.state.devices.map((d) => d.subscription?.price ?? null),
      payments: probe.state.payments.map((p) => p.amount),
    };
    await save((w) => { setPrice(w, 'b06', 't30d', 999999); setPlan(w, 't30d', { name: 'Monthly Plan', durationDays: 45 }); });
    await publish();
    expect(probe.state.devices.map((d) => d.subscription?.price ?? null)).toEqual(before.subs);
    expect(probe.state.payments.map((p) => p.amount)).toEqual(before.payments);
    expect(publishedPrice('b06', 't30d')).toBe(999999);
  });

  it('keeps a saved list across a reload, and copes with a state saved before this existed', async () => {
    mount(ADMIN);
    await save((w) => setPrice(w, 'b06', 't30d', 60000));

    const out = render(<StoreProvider><Probe /></StoreProvider>);
    expect(draftPrice('b06', 't30d')).toBe(60000);
    expect(publishedPrice('b06', 't30d')).toBe(52800);
    out.unmount();

    const legacy = JSON.parse(localStorage.getItem(KEY));
    delete legacy.sheetDraft;
    localStorage.setItem(KEY, JSON.stringify(legacy));
    render(<StoreProvider><Probe /></StoreProvider>);
    expect(probe.state.sheetDraft ?? null).toBeNull();
    expect(sheetBands(probe.state.sheet)).toHaveLength(36);
  });
});

/* ------------------------------------------------------------------ */
/* BEHAVIOURAL: publishing tells the farmers it concerns               */
/* ------------------------------------------------------------------ */

describe('BEHAVIOURAL: publishing notifies the farmers it concerns', () => {
  it('tells every farmer on a renamed plan what it is called now, and no one else', async () => {
    mount(ADMIN);
    await save((w) => setPlan(w, 't30d', { name: 'Monthly Plan' }));
    await publish();

    const holders = holdersOf('t30d');
    expect(holders.length).toBeGreaterThan(0);
    const others = [...new Set(buildSeed().devices.map((d) => d.farmerId))].filter((f) => !holders.includes(f));
    for (const farmerId of holders) {
      const mine = noticesFor(farmerId);
      expect(mine).toHaveLength(1);
      expect(mine[0].title).toBe('Price list updated');
      expect(mine[0].body).toMatch(/your plan is now called Monthly Plan \(it was 30-Day Plan\)/);
      expect(mine[0].read).toBe(false);
    }
    for (const farmerId of others) expect(noticesFor(farmerId)).toHaveLength(0);
  });

  it('tells only the farmers whose own farm size and plan moved, with both amounts', async () => {
    mount(ADMIN);
    await save((w) => setPrice(w, 'b06', 't30d', 60000));
    await publish();

    const affected = holdersOfBand('t30d', 'b06');
    expect(affected.length).toBeGreaterThan(0);
    const holders = holdersOf('t30d');
    for (const farmerId of affected) {
      const body = noticesFor(farmerId)[0]?.body || '';
      expect(body).toMatch(/the 30-Day Plan price for 1,000–1,199 chicks is now RWF 60,000 \(it was RWF 52,800\)/);
      expect(body).toMatch(/nothing you have already paid for changes/);
    }
    // the same plan on a different farm size is not this farmer's business
    for (const farmerId of holders.filter((f) => !affected.includes(f))) {
      expect(noticesFor(farmerId)).toHaveLength(0);
    }
  });

  it('tells a farmer when the name of their own farm size changes', async () => {
    mount(ADMIN);
    await save((w) => setLabel(w, 'b01', 'Starter flock (up to 599)'));
    await publish();
    const inBand = [...new Set(buildSeed().devices.filter((d) => bandForChicks(d.farmSize)?.id === 'b01').map((d) => d.farmerId))];
    expect(inBand.length).toBeGreaterThan(0);
    for (const farmerId of inBand) {
      expect(noticesFor(farmerId)[0]?.body).toMatch(/the farm size "Up to 599 chicks" is now called "Starter flock \(up to 599\)"/);
    }
  });

  it('notifies nobody when nothing changed, and discarding leaves the published list alone', async () => {
    mount(ADMIN);
    const before = JSON.stringify(probe.state.sheet.bands);
    await save();
    expect(probe.state.sheetDraft).toBeTruthy();
    expect(sheetChanges({ bands: probe.state.sheet.bands, plans: probe.state.plans }, probe.state.sheetDraft)).toEqual([]);
    await publish();
    expect(noticesFor('f1')).toHaveLength(0);
    expect(probe.state.notifications).toHaveLength(buildSeed().notifications.length);

    await save((w) => setPrice(w, 'b06', 't30d', 60000));
    await discard();
    expect(probe.state.sheetDraft ?? null).toBeNull();
    expect(JSON.stringify(probe.state.sheet.bands)).toBe(before);
  });

  it('records the save and the publish in the audit log', async () => {
    mount(ADMIN);
    await save((w) => setPrice(w, 'b06', 't30d', 60000));
    expect(probe.state.audit[0].action).toBe('price_sheet.save');
    expect(probe.state.audit[0].details).toMatch(/1 unpublished change/);
    expect(probe.state.audit[0].details).toMatch(/now RWF 60,000 \(it was RWF 52,800\)/);

    await publish();
    expect(probe.state.audit[0].action).toBe('price_sheet.publish');
    expect(probe.state.audit[0].details).toMatch(/1 change/);
    expect(probe.state.audit[0].details).toMatch(/\d+ farmer\(s\) notified/);
    expect(probe.state.sheet.publishedBy).toBe(ADMIN.name);
  });
});

/* ------------------------------------------------------------------ */
/* FUNCTIONAL: the console itself                                      */
/* ------------------------------------------------------------------ */

describe('FUNCTIONAL: Edit, Save, Publish on the console', () => {
  it('shows the table as text with one Edit button, and turns it into fields on Edit', async () => {
    const { default: AdminSubscriptions } = await import('../pages/admin/Subscriptions.jsx');
    const out = mountPage(AdminSubscriptions, ADMIN, '/admin/subscriptions');

    // the list reads as it did: text, and only one Edit button
    const priceCells = () => [...out.container.querySelectorAll('input.cell-input')];
    expect(priceCells()).toHaveLength(0);
    // exactly one Edit button, top right of the list
    expect(out.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
    expect(out.container.textContent).toMatch(/1,000–1,199 chicks/);

    fireEvent.click(out.getByRole('button', { name: 'Edit' }));
    const cell = out.container.querySelector('input[aria-label="30-Day Plan — 1,000–1,199 chicks"]');
    expect(cell).toBeTruthy();
    expect(cell.value).toBe('52800');
    // the size column is a name field only — no second line of numbers
    expect(out.container.querySelectorAll('input[aria-label="Farm size name"]')).toHaveLength(36);
    expect(out.container.querySelector('input[aria-label*="chicks from"]')).toBeNull();
    expect(out.container.querySelector('input[aria-label*="chicks to"]')).toBeNull();
  });

  it('saves the change to the console only, then publishes it to the farmer', async () => {
    const { default: AdminSubscriptions } = await import('../pages/admin/Subscriptions.jsx');
    const out = mountPage(AdminSubscriptions, ADMIN, '/admin/subscriptions');

    fireEvent.click(out.getByRole('button', { name: 'Edit' }));
    const cell = out.container.querySelector('input[aria-label="30-Day Plan — 1,000–1,199 chicks"]');
    fireEvent.change(cell, { target: { value: '60000' } });
    fireEvent.click(out.getByRole('button', { name: 'Save' }));
    await act(async () => {});

    expect(draftPrice('b06', 't30d')).toBe(60000);
    expect(publishedPrice('b06', 't30d')).toBe(52800);
    expect(out.container.textContent).toMatch(/not published yet/);
    expect(out.getByRole('button', { name: /^Publish/ })).toBeTruthy();
    // the console now shows the saved number
    expect(out.container.textContent).toMatch(/RWF 60,000/);
    out.unmount();

    // the farmer still pays the published price
    const { default: FarmerSubscriptions } = await import('../pages/farmer/Subscriptions.jsx');
    const beforePublish = mountPageOnSavedState(FarmerSubscriptions, FARMER, '/farmer/subscriptions');
    expect([...beforePublish.container.querySelectorAll('table tbody tr')].map((r) => r.textContent).join(' ')).toMatch(/RWF 52,800/);
    beforePublish.unmount();

    // publish, and the farmer sees it
    const admin = mountPageOnSavedState(AdminSubscriptions, ADMIN, '/admin/subscriptions');
    fireEvent.click(admin.getByRole('button', { name: /^Publish/ }));   // the list's Publish
    fireEvent.click(admin.getByRole('button', { name: 'Publish' }));     // the confirmation
    await act(async () => {});
    expect(publishedPrice('b06', 't30d')).toBe(60000);
    admin.unmount();

    const after = mountPageOnSavedState(FarmerSubscriptions, FARMER, '/farmer/subscriptions');
    expect(after.getAllByText('RWF 60,000').length).toBeGreaterThan(0);
  });

  it('refuses a typo at Save, says why, and keeps the numbers', async () => {
    const { default: AdminSubscriptions } = await import('../pages/admin/Subscriptions.jsx');
    const out = mountPage(AdminSubscriptions, ADMIN, '/admin/subscriptions');

    fireEvent.click(out.getByRole('button', { name: 'Edit' }));
    fireEvent.change(out.container.querySelector('input[aria-label="30-Day Plan — 1,000–1,199 chicks"]'), { target: { value: '52 800' } });
    fireEvent.click(out.getByRole('button', { name: 'Save' }));
    await act(async () => {});

    expect(probe.state.sheetDraft ?? null).toBeNull();
    expect(probe.state.toast?.kind).toBe('error');
    expect(probe.state.toast.msg).toMatch(/30-Day Plan for 1,000–1,199 chicks/);
    // still editing, with the published numbers intact
    expect(publishedPrice('b06', 't30d')).toBe(52800);
  });

  it('renames a plan inside the edit session and it reaches the farmer after publishing', async () => {
    const { default: AdminSubscriptions } = await import('../pages/admin/Subscriptions.jsx');
    const out = mountPage(AdminSubscriptions, ADMIN, '/admin/subscriptions');

    fireEvent.click(out.getByRole('button', { name: 'Edit' }));
    fireEvent.click(out.getByRole('button', { name: '30-Day Plan' }));   // the column header opens the plan
    const nameField = out.container.querySelector('.modal input');
    fireEvent.change(nameField, { target: { value: 'Monthly Plan' } });
    fireEvent.click(out.getByRole('button', { name: 'Save to the list' }));
    await act(async () => {});
    fireEvent.click(out.getByRole('button', { name: 'Save' }));
    await act(async () => {});

    expect(probe.state.sheetDraft.plans.find((p) => p.id === 't30d').name).toBe('Monthly Plan');
    expect(probe.state.plans.find((p) => p.id === 't30d').name).toBe('30-Day Plan'); // still published

    // publish from the same console: the list, then the confirmation
    fireEvent.click(out.getByRole('button', { name: /^Publish/ }));
    fireEvent.click(out.getByRole('button', { name: 'Publish' }));
    await act(async () => {});
    expect(probe.state.plans.find((p) => p.id === 't30d').name).toBe('Monthly Plan');
    out.unmount();

    const { default: FarmerSubscriptions } = await import('../pages/farmer/Subscriptions.jsx');
    const farmer = mountPageOnSavedState(FarmerSubscriptions, FARMER, '/farmer/subscriptions');
    expect(farmer.getAllByText(/Monthly Plan/).length).toBeGreaterThan(0);
    expect(farmer.queryByText('30-Day Plan')).toBeNull();
  });

  it('labels the farm size row, and the farmer reads the new name after publishing', async () => {
    const { default: AdminSubscriptions } = await import('../pages/admin/Subscriptions.jsx');
    const out = mountPage(AdminSubscriptions, ADMIN, '/admin/subscriptions');

    fireEvent.click(out.getByRole('button', { name: 'Edit' }));
    const nameField = out.container.querySelector('input[aria-label="Farm size name"]');
    expect(nameField.value).toBe('Up to 599 chicks');
    fireEvent.change(nameField, { target: { value: 'Starter flock (up to 599)' } });
    fireEvent.click(out.getByRole('button', { name: 'Save' }));
    await act(async () => {});
    expect(sheetBandLabel({ bands: probe.state.sheetDraft.bands }, { label: 'Starter flock (up to 599)' })).toBe('Starter flock (up to 599)');

    fireEvent.click(out.getByRole('button', { name: /^Publish/ }));
    fireEvent.click(out.getByRole('button', { name: 'Publish' }));
    await act(async () => {});
    out.unmount();

    const { default: FarmerSubscriptions } = await import('../pages/farmer/Subscriptions.jsx');
    const farmer = mountPageOnSavedState(FarmerSubscriptions, FARMER, '/farmer/subscriptions');
    expect(farmer.getAllByText(/Starter flock \(up to 599\)/).length).toBeGreaterThan(0);
  });
});

/* keeps the published-list fixture helper honest: an already-published change */
describe('a published change, as the store would hold it', () => {
  it('is what an edited-and-published list looks like', () => {
    const edited = sheetWithPrice(publishedSheet(), 'b06', 't30d', 60000);
    expect(sheetPrice(edited, 'b06', 't30d')).toBe(60000);
    expect(sheetPrice(edited, 'b06', 't15d')).toBe(33000);
  });
});
