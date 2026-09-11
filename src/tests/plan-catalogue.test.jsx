/**
 * The plan catalogue is Afriinnox's, not the browser's.
 *
 * The app stores its state in localStorage, so a browser that has been used
 * since an earlier build still holds that build's plan catalogue. The first
 * build seeded three plans of its own — "15-Day", "30-Day" and "90-Day", each
 * with a single flat price and no multiplier — and none of their ids match a
 * column of the approved sheet. Left in place they made the console show three
 * columns and an unknown price (Customized) in every cell of every farm size,
 * with the 6-Month and 1-Year plans nowhere on it.
 *
 *   INVARIANT   whatever was saved — nothing, an older build's three plans,
 *               renamed plans, plans the console added, duplicates and junk —
 *               the app runs on the five plans the approved sheet prints:
 *               present, in the sheet's order, each with a positive multiplier,
 *               priced by the sheet on every farm size, and never two plans at
 *               the same price on the same farm size. Repairing is idempotent.
 *   BEHAVIOURAL the repair keeps what the console changed (a renamed plan, a
 *               changed duration, a plan of its own) and drops stale seed data.
 *   FUNCTIONAL  a console mounted on a state an older build left behind shows
 *               all five plans as columns, with the approved RWF in the cells.
 */
import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render } from '@testing-library/react';
import { StoreProvider, useStore } from '../lib/store.jsx';
import { buildSeed } from '../lib/seed.js';
import {
  BANDS, TERM_IDS, TERMS, approvedPlans, priceFor, publishedSheet, reconcilePlans, sheetBandLabel, sheetBands, sheetPrice,
} from '../lib/subscriptions.js';

const KEY = 'broodiinnox_app_v1';
const ADMIN = { id: 'a1', name: 'Innocent Ingabire', role: 'admin', adminRole: 'super', email: 'admin@afriinnox.com' };

/** The catalogue the FIRST build of the app seeded, and left in the browser. */
const OLD_PLANS = [
  { id: 'p15', name: '15-Day', durationDays: 15, price: 15000, active: true, description: 'Short cycle (piglets, small batches)' },
  { id: 'p30', name: '30-Day', durationDays: 30, price: 25000, active: true, description: 'Standard cycle (chickens)' },
  { id: 'p90', name: '90-Day', durationDays: 90, price: 65000, active: true, description: 'Multiple cycles — best value' },
];

/** Every kind of catalogue a browser could hand the app. */
const SAVED = [
  ['nothing at all', undefined],
  ['null', null],
  ['not a list', 'plans'],
  ['an empty list', []],
  ['the first build\'s three plans', OLD_PLANS],
  ['the approved five', approvedPlans()],
  ['plans renamed in the console', approvedPlans().map((p) => (p.id === 't30d' ? { ...p, name: 'Monthly Plan', durationDays: 45 } : p))],
  ['an older seed\'s plan names (no " Plan")', approvedPlans().map((p) => ({ ...p, name: p.name.replace(/ Plan$/, '') }))],
  ['an approved plan with no multiplier', approvedPlans().map((p) => (p.id === 't6m' ? { ...p, multiplier: undefined } : p))],
  ['the five plus a plan the console added', [...approvedPlans(), { id: 'plan-x', name: '45-Day Plan', durationDays: 45, multiplier: 2.2, active: true, description: 'Added by Afriinnox' }]],
  ['duplicated ids', [...approvedPlans(), { ...approvedPlans()[0], name: 'Duplicate 15-Day' }]],
  ['junk alongside real plans', [null, {}, { id: 7 }, { id: 't15d', name: '   ' }, ...approvedPlans()]],
];

/** The five approved plans of a catalogue, in the sheet's order. */
const leadingFive = (plans) => plans.slice(0, 5);

const SHEET = publishedSheet();
const PRICED = BANDS.filter((b) => typeof b.base === 'number');

let probe = { state: null, dispatch: null };
function Probe() {
  const { state, dispatch } = useStore();
  probe = { state, dispatch };
  return null;
}

const clone = (v) => JSON.parse(JSON.stringify(v));

beforeEach(() => {
  localStorage.clear();
  probe = { state: null, dispatch: null };
});

/* ------------------------------------------------------------------ */
/* INVARIANT: the five approved plans, at the approved prices          */
/* ------------------------------------------------------------------ */

describe('INVARIANT: the app always runs on the five approved plans', () => {
  it('holds for every catalogue a browser could have saved', () => {
    for (const [what, saved] of SAVED) {
      const plans = reconcilePlans(saved);
      expect(plans.slice(0, 5).map((p) => p.id), what).toEqual(TERM_IDS);
      for (const plan of leadingFive(plans)) {
        const term = TERMS.find((t) => t.id === plan.id);
        expect(typeof plan.name === 'string' && plan.name.trim() !== '', `${what}: ${plan.id} has a name`).toBe(true);
        expect(Number.isInteger(plan.durationDays) && plan.durationDays >= 1, `${what}: ${plan.id} lasts whole days`).toBe(true);
        expect(plan.multiplier, `${what}: ${plan.id} has a multiplier`).toBeGreaterThan(0);
        // what the sheet prints for this plan is what the app can charge for it
        expect(plan.multiplier, `${what}: ${plan.id} multiplier`).toBe(term.multiplier);
      }
      // nothing is left in the catalogue that the sheet cannot price
      for (const plan of plans.slice(5)) {
        expect(plan.multiplier, `${what}: ${plan.id} (added by the console)`).toBeGreaterThan(0);
      }
    }
  });

  it('prices every approved plan on every farm size the sheet prices, and never shares a price', () => {
    for (const [what, saved] of SAVED) {
      const plans = reconcilePlans(saved);
      for (const band of PRICED) {
        const row = SHEET.bands.find((b) => b.id === band.id);
        const prices = leadingFive(plans).map((plan) => sheetPrice(SHEET, row, plan));
        for (const [i, price] of prices.entries()) {
          const plan = leadingFive(plans)[i];
          expect(price, `${what}: ${plan.name} on ${sheetBandLabel(SHEET, row)}`).toBe(priceFor(band, plan.id));
          expect(Number.isFinite(price), `${what}: ${plan.name} on ${sheetBandLabel(SHEET, row)} is money`).toBe(true);
          expect(price, `${what}: ${plan.name} on ${sheetBandLabel(SHEET, row)} is not Customized`).not.toBeNull();
        }
        // the complaint this repair answers: at one farm size, five plans, five prices
        expect(new Set(prices).size, `${what}: five plans share a price on ${sheetBandLabel(SHEET, row)}`).toBe(5);
      }
    }
  });

  it('is idempotent, and settles: repairing a repaired catalogue changes nothing', () => {
    for (const [what, saved] of SAVED) {
      const once = reconcilePlans(saved);
      expect(reconcilePlans(once), what).toEqual(once);
    }
  });

  it('drops the stale plans of the first build, whose ids the sheet cannot price', () => {
    const plans = reconcilePlans(OLD_PLANS);
    for (const stale of ['p15', 'p30', 'p90']) {
      expect(plans.some((p) => p.id === stale), `${stale} is gone`).toBe(false);
      expect(TERM_IDS.includes(stale), `${stale} was never an approved plan`).toBe(false);
    }
    expect(plans.map((p) => p.name)).toEqual(['15-Day Plan', '30-Day Plan', '40-Day Plan', '6-Month Plan', '1-Year Plan']);
  });

  it('keeps what the console changed, and a plan the console added', () => {
    const renamed = reconcilePlans(approvedPlans().map((p) => (p.id === 't30d' ? { ...p, name: 'Monthly Plan', durationDays: 45, active: false } : p)));
    const monthly = renamed.find((p) => p.id === 't30d');
    expect(monthly.name).toBe('Monthly Plan');
    expect(monthly.durationDays).toBe(45);
    expect(monthly.active).toBe(false);
    expect(monthly.multiplier).toBe(1.6);              // the sheet's multiple, kept

    const withOwn = reconcilePlans([...OLD_PLANS, { id: 'plan-x', name: '45-Day Plan', durationDays: 45, multiplier: 2.2 }]);
    expect(withOwn.map((p) => p.id)).toEqual([...TERM_IDS, 'plan-x']);
    expect(withOwn[5].multiplier).toBe(2.2);

    // an older seed dropped the trailing " Plan"; the sheet prints it
    expect(reconcilePlans(OLD_PLANS)[1].name).toBe('30-Day Plan');
    expect(reconcilePlans(approvedPlans().map((p) => ({ ...p, name: '30-Day' })))[1].name).toBe('30-Day Plan');
  });
});

/* ------------------------------------------------------------------ */
/* BEHAVIOURAL: opening the app on a state an older build left behind    */
/* ------------------------------------------------------------------ */

describe('BEHAVIOURAL: a browser that has been used since an older build', () => {
  it('reloads the approved catalogue, not the three plans that build seeded', () => {
    const stale = { ...clone(buildSeed()), plans: OLD_PLANS, session: ADMIN, reminderSent: [] };
    delete stale.sheet;
    localStorage.setItem(KEY, JSON.stringify(stale));

    render(<StoreProvider><Probe /></StoreProvider>);

    expect(probe.state.plans.map((p) => p.name))
      .toEqual(['15-Day Plan', '30-Day Plan', '40-Day Plan', '6-Month Plan', '1-Year Plan']);
    expect(probe.state.plans.map((p) => p.id)).toEqual(TERM_IDS);
    // the published list itself is untouched: 36 farm sizes, the sheet's prices
    expect(sheetBands(probe.state.sheet)).toHaveLength(36);
    const row = sheetBands(probe.state.sheet).find((b) => b.id === 'b06');
    expect(sheetPrice(probe.state.sheet, row, probe.state.plans.find((p) => p.id === 't30d'))).toBe(52800);
  });

  it('leaves a current state exactly as it was', () => {
    const plans = approvedPlans().map((p) => (p.id === 't40d' ? { ...p, name: 'Duck & Turkey Plan' } : p));
    localStorage.setItem(KEY, JSON.stringify({ ...clone(buildSeed()), plans, session: ADMIN, reminderSent: [] }));

    render(<StoreProvider><Probe /></StoreProvider>);

    expect(probe.state.plans.map((p) => p.name))
      .toEqual(['15-Day Plan', '30-Day Plan', 'Duck & Turkey Plan', '6-Month Plan', '1-Year Plan']);
  });
});

/* ------------------------------------------------------------------ */
/* FUNCTIONAL: the console an older build leaves behind                */
/* ------------------------------------------------------------------ */

describe('FUNCTIONAL: the admin console on a stale state', () => {
  const rowOf = (out, label) => [...out.container.querySelectorAll('table tbody tr')]
    .find((tr) => tr.querySelector('td')?.textContent.trim() === label) || null;

  it('shows all five plans as columns, priced in RWF on every farm size', async () => {
    const { default: AdminSubscriptions } = await import('../pages/admin/Subscriptions.jsx');
    const stale = { ...clone(buildSeed()), plans: OLD_PLANS, session: ADMIN, reminderSent: [] };
    delete stale.sheet;
    localStorage.setItem(KEY, JSON.stringify(stale));

    const out = render(
      <StoreProvider>
        <Probe />
        <MemoryRouter initialEntries={['/admin/subscriptions']}><AdminSubscriptions /></MemoryRouter>
      </StoreProvider>
    );

    const table = [...out.container.querySelectorAll('table')].find((t) => /Up to 599 chicks/.test(t.textContent));
    expect(table, 'the price list is on the console').toBeTruthy();
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()))
      .toEqual(['Farm size', '15-Day Plan', '30-Day Plan', '40-Day Plan', '6-Month Plan', '1-Year Plan']);

    // the row that used to read "Customized" in all three of its columns
    const cells = (label) => [...rowOf(out, label).querySelectorAll('td')].slice(1).map((td) => td.textContent.trim());
    expect(cells('1,000–1,199 chicks')).toEqual(['RWF 33,000', 'RWF 52,800', 'RWF 59,400', 'RWF 165,000', 'RWF 264,000']);
    expect(cells('Up to 599 chicks')).toEqual(['RWF 25,000', 'RWF 40,000', 'RWF 45,000', 'RWF 125,000', 'RWF 200,000']);
    // 36 farm sizes, and no cell of a priced row left unknown
    expect(table.querySelectorAll('tbody tr')).toHaveLength(36);

    // the three stale plans are not on the console at all
    expect(out.queryByText('90-Day')).toBeNull();
    expect([...out.container.querySelectorAll('th')].some((th) => /90-Day/.test(th.textContent))).toBe(false);
  });
});
