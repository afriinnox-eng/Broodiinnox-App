/**
 * The subscription price list and the batch arithmetic behind it.
 *
 * These are property tests over the WHOLE sheet and over every duration
 * combination that matters, not a happy path:
 *
 *   INVARIANT 1  every one of the 180 published prices (36 farm-size bands x 5
 *                plans) is reproduced exactly from the sheet in
 *                "Broodiinnox_Prices_Subscription.pdf", and the top band is
 *                "Customized" — no price is ever invented.
 *   INVARIANT 2  the bands tile the chick range with no gap, no overlap and no
 *                band that can never be reached.
 *   INVARIANT 3  a longer plan never costs less in total and always costs less
 *                per day, for every band: that is the sheet's whole point.
 *   INVARIANT 4  the batch arithmetic holds for every (plan, batch length) pair:
 *                whole batches fit inside the paid days, the leftover is
 *                smaller than one batch, and "does this plan see the batch
 *                through?" agrees with the dates — a plan ending before the
 *                batch always reports the exact number of missing days.
 */
import { describe, expect, it } from 'vitest';
import {
  BANDS, BAND_IDS, TERMS, TERM_IDS, bandForChicks, bandIsPriced, bandLabel, bandById,
  batchesCovered, batchEnd, coverageFor, deviceBand, deviceChicks, farmSizeIsEstimated,
  leftoverDays, planPrice, plansForBand, priceFor, pricePerDay, recommendedTerm, termById,
} from '../lib/subscriptions.js';

/**
 * The sheet exactly as printed: [min chicks, max chicks, 15-Day, 30-Day,
 * 40-Day, 6-Month, 1-Year]. Band 3500–3699 is printed "RWF 710,00" in the PDF
 * — a typo for 71,000, which is what its own other four columns require
 * (71,000 x1.6 = 113,600, x1.8 = 127,800, x5 = 355,000, x8 = 568,000).
 */
const SHEET = [
  [1, 599, 25000, 40000, 45000, 125000, 200000],
  [600, 699, 27000, 43200, 48600, 135000, 216000],
  [700, 799, 28000, 44800, 50400, 140000, 224000],
  [800, 899, 30000, 48000, 54000, 150000, 240000],
  [900, 999, 31000, 49600, 55800, 155000, 248000],
  [1000, 1199, 33000, 52800, 59400, 165000, 264000],
  [1200, 1499, 36000, 57600, 64800, 180000, 288000],
  [1500, 1699, 41000, 65600, 73800, 205000, 328000],
  [1700, 1999, 44000, 70400, 79200, 220000, 352000],
  [2000, 2199, 48000, 76800, 86400, 240000, 384000],
  [2200, 2499, 51000, 81600, 91800, 255000, 408000],
  [2500, 2699, 56000, 89600, 100800, 280000, 448000],
  [2700, 2999, 59000, 94400, 106200, 295000, 472000],
  [3000, 3299, 63000, 100800, 113400, 315000, 504000],
  [3300, 3499, 68000, 108800, 122400, 340000, 544000],
  [3500, 3699, 71000, 113600, 127800, 355000, 568000],
  [3700, 3999, 74000, 118400, 133200, 370000, 592000],
  [4000, 4499, 79000, 126400, 142200, 395000, 632000],
  [4500, 4999, 86000, 137600, 154800, 430000, 688000],
  [5000, 5499, 94000, 150400, 169200, 470000, 752000],
  [5500, 5999, 102000, 163200, 183600, 510000, 816000],
  [6000, 6499, 109000, 174400, 196200, 545000, 872000],
  [6500, 6999, 117000, 187200, 210600, 585000, 936000],
  [7000, 7499, 125000, 200000, 225000, 625000, 1000000],
  [7500, 7999, 132000, 211200, 237600, 660000, 1056000],
  [8000, 8499, 140000, 224000, 252000, 700000, 1120000],
  [8500, 8999, 148000, 236800, 266400, 740000, 1184000],
  [9000, 9499, 155000, 248000, 279000, 775000, 1240000],
  [9500, 9999, 163000, 260800, 293400, 815000, 1304000],
  [10000, 10999, 171000, 273600, 307800, 855000, 1368000],
  [11000, 11999, 186000, 297600, 334800, 930000, 1488000],
  [12000, 12999, 201000, 321600, 361800, 1005000, 1608000],
  [13000, 13999, 217000, 347200, 390600, 1085000, 1736000],
  [14000, 14999, 232000, 371200, 417600, 1160000, 1856000],
  [15000, 15999, 247000, 395200, 444600, 1235000, 1976000],
  [16000, null, null, null, null, null, null],
];

const PRICE_COLUMN = { t15d: 2, t30d: 3, t40d: 4, t6m: 5, t1y: 6 };

/* ------------------------------------------------------------------ */
/* INVARIANT 1: the sheet, price for price                             */
/* ------------------------------------------------------------------ */

describe('INVARIANT: the app quotes the approved sheet, not a guess', () => {
  it('the sheet has 36 bands and the five published plans', () => {
    expect(SHEET).toHaveLength(36);
    expect(BANDS).toHaveLength(36);
    expect(TERMS.map((t) => t.days)).toEqual([15, 30, 40, 180, 365]);
    expect(BAND_IDS.length).toBe(new Set(BAND_IDS).size); // ids are unique
    expect(TERM_IDS.length).toBe(new Set(TERM_IDS).size);
  });

  it('reproduces all 180 published prices', () => {
    const checked = [];
    for (const [min, max, ...prices] of SHEET) {
      const band = BANDS.find((b) => b.min === min);
      expect(band, `no band starting at ${min}`).toBeTruthy();
      expect(band.max).toBe(max);
      for (const termId of TERM_IDS) {
        const expected = prices[PRICE_COLUMN[termId] - 2];
        expect(priceFor(band, termId), `${bandLabel(band)} / ${termId}`).toBe(expected);
        checked.push(expected);
      }
    }
    expect(checked.filter((p) => p !== null)).toHaveLength(175); // 35 bands x 5 plans
  });

  it('quotes nothing at all for the "Customized" top band', () => {
    const top = bandById('b36');
    expect(top.min).toBe(16000);
    expect(top.max).toBeNull();
    expect(bandIsPriced(top)).toBe(false);
    for (const termId of TERM_IDS) expect(priceFor(top, termId)).toBeNull();
    // ... and a farmer at or above it is still placed in that band, not priced wrongly
    expect(bandForChicks(16000).id).toBe('b36');
    expect(bandForChicks(50000).id).toBe('b36');
  });

  it('never prices an unknown band or plan', () => {
    for (const junk of [null, undefined, '', 'nope', 0, -1, {}, []]) {
      expect(priceFor(junk, 't30d')).toBeNull();
      expect(priceFor('b01', junk)).toBeNull();
      expect(termById(junk)).toBeNull();
      expect(bandById(junk)).toBeNull();
    }
    expect(plansForBand('nope')).toHaveLength(TERMS.length); // still renders the terms, unpriced
    expect(plansForBand('nope').every((p) => p.price === null)).toBe(true);
  });

  it('prices a farm straight from its number of chicks', () => {
    // The website's own farm-size tiers, and the sheet behind them.
    expect(planPrice('t30d', 500)).toBe(40000);
    expect(planPrice('t30d', 1000)).toBe(52800);
    expect(planPrice('t6m', 3000)).toBe(315000);
    expect(planPrice('t1y', 15000)).toBe(1976000);
    expect(planPrice('t30d', 20000)).toBeNull(); // Customized
    expect(planPrice('t30d', 0)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* INVARIANT 2: the bands tile the range                               */
/* ------------------------------------------------------------------ */

describe('INVARIANT: the farm-size bands tile the chick range', () => {
  it('is ordered, contiguous and non-overlapping', () => {
    for (let i = 0; i < BANDS.length; i++) {
      const b = BANDS[i];
      expect(b.min).toBeGreaterThan(0);
      if (b.max !== null) expect(b.max).toBeGreaterThanOrEqual(b.min);
      if (i > 0) expect(b.min, `${b.id} overlaps ${BANDS[i - 1].id}`).toBe(BANDS[i - 1].max + 1);
      if (i < BANDS.length - 1) expect(b.max, `${b.id} must be closed`).not.toBeNull();
    }
    expect(BANDS[BANDS.length - 1].max).toBeNull(); // only the top band is open
  });

  it('places every chick count, and every band boundary, in exactly one band', () => {
    for (const b of BANDS) {
      expect(bandForChicks(b.min)?.id, `lower edge of ${b.id}`).toBe(b.id);
      if (b.max !== null) expect(bandForChicks(b.max)?.id, `upper edge of ${b.id}`).toBe(b.id);
      expect(bandForChicks(b.min - 1)?.id, `just below ${b.id}`).not.toBe(b.id);
    }
    // no band is unreachable, and the map never skips a chick count
    for (let n = 1; n <= 2000; n++) expect(bandForChicks(n), `chicks=${n}`).toBeTruthy();
    expect(bandForChicks(999999).id).toBe('b36');
  });

  it('refuses a farm size that is not a count of animals', () => {
    for (const junk of [0, -5, 1.5, NaN, Infinity, 'many', null, undefined, {}, []]) {
      expect(bandForChicks(junk)).toBeNull();
    }
    expect(bandForChicks('1200')).toBeNull(); // a string is not a farm size
  });

  it('labels a band with the farm size it stands for', () => {
    expect(bandLabel(bandById('b01'))).toBe('Up to 599 chicks');
    expect(bandLabel(bandById('b06'))).toBe('1,000–1,199 chicks');
    expect(bandLabel(bandById('b36'))).toBe('16,000+ chicks');
    expect(bandLabel(null)).toBe('');
  });
});

/* ------------------------------------------------------------------ */
/* INVARIANT 3: longer is cheaper per day, never cheaper in total       */
/* ------------------------------------------------------------------ */

describe('INVARIANT: a longer plan costs more, but far less per day', () => {
  it('holds for every one of the 35 priced bands', () => {
    for (const band of BANDS.filter(bandIsPriced)) {
      const priced = TERMS.map((t) => ({ term: t, price: priceFor(band, t) }));
      for (let i = 1; i < priced.length; i++) {
        const prev = priced[i - 1];
        const cur = priced[i];
        expect(cur.price, `${bandLabel(band)}: ${cur.term.name} vs ${prev.term.name}`)
          .toBeGreaterThan(prev.price);
        expect(pricePerDay(cur.price, cur.term.days)).toBeLessThan(pricePerDay(prev.price, prev.term.days));
      }
    }
  });

  it('a bigger farm never pays less than a smaller one for the same plan', () => {
    for (const termId of TERM_IDS) {
      let previous = 0;
      for (const band of BANDS.filter(bandIsPriced)) {
        const price = priceFor(band, termId);
        expect(price, `${bandLabel(band)} / ${termId}`).toBeGreaterThanOrEqual(previous);
        previous = price;
      }
    }
  });

  it('prices a whole farm-size column and reports the per-day cost', () => {
    const plans = plansForBand('b06'); // 1,000–1,199 chicks
    expect(plans.map((p) => p.price)).toEqual([33000, 52800, 59400, 165000, 264000]);
    expect(plans.every((p) => p.band.id === 'b06')).toBe(true);
    expect(Math.round(pricePerDay(52800, 30))).toBe(1760);
    expect(Math.round(pricePerDay(33000, 15))).toBe(2200); // the short plan costs more per day
    expect(pricePerDay(0, 0)).toBeNull();
    expect(pricePerDay(null, 30)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* INVARIANT 4: a subscription against the batch it pays for            */
/* ------------------------------------------------------------------ */

describe('INVARIANT: whole batches fit inside the paid days', () => {
  const BATCH_DAYS = [1, 7, 14, 15, 16, 21, 28, 30, 31, 40, 41, 45, 60, 90, 180, 181, 365, 400];

  it('holds for every plan against every batch length', () => {
    for (const term of TERMS) {
      for (const batchDays of BATCH_DAYS) {
        const whole = batchesCovered(term.days, batchDays);
        const left = leftoverDays(term.days, batchDays);
        const label = `${term.name} / ${batchDays}-day batch`;

        expect(whole, label).toBe(Math.floor(term.days / batchDays));
        expect(whole * batchDays, label).toBeLessThanOrEqual(term.days);
        expect((whole + 1) * batchDays, label).toBeGreaterThan(term.days);
        expect(left, label).toBe(term.days - whole * batchDays);
        expect(left, label).toBeLessThan(batchDays);
        // a plan shorter than one batch covers none, and is not silently rounded up
        if (batchDays > term.days) expect(whole, label).toBe(0);
      }
    }
    expect(batchesCovered(30, 21)).toBe(1);
    expect(batchesCovered(180, 21)).toBe(8);   // a 6-month plan runs eight 21-day cycles
    expect(leftoverDays(180, 21)).toBe(12);
    expect(batchesCovered(180, 30)).toBe(6);
    expect(leftoverDays(180, 30)).toBe(0);
    expect(batchesCovered(15, 21)).toBe(0);    // too short: it must be extended
  });

  it('handles junk without inventing a batch or a cycle', () => {
    for (const junk of [0, -3, 1.5, NaN, null, undefined, '30', {}]) {
      expect(batchesCovered(junk, 21)).toBe(0);
      expect(batchesCovered(30, junk)).toBe(0);
      expect(leftoverDays(junk, 21)).toBe(0);
    }
  });

  it('recommends the shortest plan that can pay for the batch, and no shorter one', () => {
    for (let batchDays = 1; batchDays <= 500; batchDays++) {
      const term = recommendedTerm(batchDays);
      const label = `batch of ${batchDays} days`;
      expect(term, label).toBeTruthy();
      const covering = TERMS.filter((t) => t.days >= batchDays);
      if (covering.length) {
        // exactly the shortest of the plans that reach the batch's last day
        expect(term.days, label).toBe(Math.min(...covering.map((t) => t.days)));
        expect(batchesCovered(term.days, batchDays), label).toBeGreaterThanOrEqual(1);
      } else {
        // nothing on the sheet is long enough: the longest plan, and the screens
        // say the batch outlives it rather than pretending it fits
        expect(term.id, label).toBe('t1y');
        expect(batchesCovered(term.days, batchDays), label).toBe(0);
      }
    }
    expect(recommendedTerm(21).id).toBe('t30d');  // a chicken cycle
    expect(recommendedTerm(28).id).toBe('t30d');  // duck / turkey
    expect(recommendedTerm(40).id).toBe('t40d');
    expect(recommendedTerm(41).id).toBe('t6m');
    expect(recommendedTerm(400).id).toBe('t1y');  // nothing is long enough: the longest plan
    expect(recommendedTerm(0)).toBeNull();
    expect(recommendedTerm(null)).toBeNull();
  });
});

describe('INVARIANT: coverage agrees with the dates, always', () => {
  const NOW = '2026-09-11T09:00:00.000Z';
  const day = (n) => new Date(Date.parse(NOW) + n * 86400000).toISOString();
  const sub = (patch = {}) => ({
    planId: 't30d', bandId: 'b06', price: 52800,
    status: 'active', startDate: day(-5), endDate: day(25), batchesUsed: 1, ...patch,
  });
  const batch = (durationDays, startedDaysAgo = 5) => ({
    animal: 'chicken', durationDays, count: 1000, startDate: day(-startedDaysAgo),
  });

  it('a batch that ends inside the plan is covered; one that outlives it is not', () => {
    // 30-day plan, 21-day batch started 5 days ago: its last day is 15 days from
    // now, the plan has 25 — covered.
    expect(coverageFor(sub(), batch(21), NOW)).toMatchObject({ coversBatch: true, shortfallDays: 0 });
    // ... a 40-day batch started 5 days ago lasts to day 34, nine days past the plan.
    const long = coverageFor(sub(), batch(40), NOW);
    expect(long.coversBatch).toBe(false);
    expect(long.shortfallDays).toBe(9);
    expect(long.batchEndsAt).toBe(new Date(Date.parse(batch(40).startDate) + 39 * 86400000).toISOString());

    // Expiring on the batch's own last day is enough: the unit is still unlocked
    // on the day the cycle finishes.
    const toTheLastDay = coverageFor(
      sub({ startDate: day(-5), endDate: day(14) }),
      batch(20, 5),
      NOW
    );
    expect(toTheLastDay.coversBatch).toBe(true);
    expect(toTheLastDay.shortfallDays).toBe(0);
  });

  it('shortfall is exactly the days the plan is missing, for every combination', () => {
    for (const subDaysLeft of [0, 1, 5, 20, 100, 200, 364]) {
      for (const batchDays of [1, 7, 15, 21, 30, 40, 90, 180, 365]) {
        for (const batchAge of [0, 3, 14]) {
          if (batchAge >= batchDays) continue;
          const s = sub({ startDate: day(-1), endDate: day(subDaysLeft) });
          const b = batch(batchDays, batchAge);
          const c = coverageFor(s, b, NOW);
          // Whole days from today to the batch's last day, and the plan's own
          // last day: cover needs the plan to reach the batch's final day.
          const daysLeftInBatch = batchDays - batchAge;
          const lastDayOfBatch = daysLeftInBatch - 1;
          const expectedCovered = subDaysLeft >= lastDayOfBatch;
          const label = `left=${subDaysLeft} batch=${batchDays} age=${batchAge}`;
          expect(c.coversBatch, label).toBe(expectedCovered);
          expect(c.shortfallDays, label).toBe(expectedCovered ? 0 : lastDayOfBatch - subDaysLeft);
          expect(c.shortfallDays, label).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('reports the days spent and left of the plan, and never counts a batch twice', () => {
    expect(coverageFor(sub({ startDate: day(0), endDate: day(30) }), batch(21, 0), NOW))
      .toMatchObject({ daysLeft: 30, daysUsed: 0, termDays: 30 });
    expect(coverageFor(sub({ startDate: day(-1), endDate: day(29) }), batch(21, 1), NOW))
      .toMatchObject({ daysLeft: 29, daysUsed: 1 });
    // both ends of the plan's life are bounded by the plan's own length
    const past = coverageFor(sub({ startDate: day(-90), endDate: day(-60) }), null, NOW);
    expect(past.daysLeft).toBe(0);
    expect(past.expired).toBe(true);
    expect(past.daysUsed).toBe(30);
    const future = coverageFor(sub({ startDate: day(40), endDate: day(70) }), null, NOW);
    expect(future.daysLeft).toBe(70); // the days it actually has, extension or not
    expect(future.daysUsed).toBe(0);  // and none of it is spent yet
  });

  it('says how many batches the plan can still pay for', () => {
    const sixMonths = { planId: 't6m', startDate: day(0), endDate: day(180) };
    const first = coverageFor(sub({ ...sixMonths, batchesUsed: 1 }), batch(21), NOW);
    expect(first).toMatchObject({
      termDays: 180, paidDays: 180, batchesCovered: 8, batchesUsed: 1, batchesLeft: 7, isLastBatch: false, leftover: 12,
    });

    const last = coverageFor(sub({ ...sixMonths, batchesUsed: 8 }), batch(21), NOW);
    expect(last).toMatchObject({ batchesLeft: 0, isLastBatch: true });

    // A 15-day plan cannot pay for a 21-day cycle at all, however often it is renewed.
    const tooShort = coverageFor(sub({ planId: 't15d', startDate: day(0), endDate: day(15), batchesUsed: 0 }), batch(21), NOW);
    expect(tooShort).toMatchObject({ termDays: 15, paidDays: 15, batchesCovered: 0, batchesLeft: 0, isLastBatch: false });

    // An exact fit wastes nothing.
    expect(coverageFor(sub(sixMonths), batch(30), NOW).leftover).toBe(0);
  });

  it('a renewal that stacks extends the cover and its batch capacity', () => {
    const extended = coverageFor(
      sub({ planId: 't30d', startDate: day(-10), endDate: day(50), batchesUsed: 1 }),
      batch(21, 10),
      NOW
    );
    expect(extended.termDays).toBe(30);  // the plan last bought
    expect(extended.paidDays).toBe(60);  // two 30-day payments running together
    expect(extended.batchesCovered).toBe(2);
    expect(extended.coversBatch).toBe(true);
  });

  it('survives a device with no subscription and no batch', () => {
    const empty = coverageFor(null, null, NOW);
    expect(empty).toMatchObject({
      term: null, band: null, price: null, termDays: null, daysLeft: 0,
      coversBatch: false, shortfallDays: 0, batchesCovered: 0,
    });
    expect(coverageFor(sub(), null, NOW).coversBatch).toBe(false);
    expect(coverageFor(null, batch(21), NOW).shortfallDays).toBe(0); // nothing to compare
    expect(batchEnd(null, 21)).toBeNull();
    expect(batchEnd(NOW, 0)).toBeNull();
  });
});

describe('the farm size a device was registered with', () => {
  it('reads the recorded farm size, and only that', () => {
    expect(deviceChicks({ farmSize: 1200 })).toBe(1200);
    expect(deviceBand({ farmSize: 1200 }).id).toBe('b07');
    expect(deviceChicks({ farmSize: 0 })).toBeNull();
    expect(deviceBand({ farmSize: null })).toBeNull();
  });

  it('falls back to the running batch, and says that it is an estimate', () => {
    const guessed = { batch: { count: 800, durationDays: 21 } };
    expect(deviceChicks(guessed)).toBe(800);
    expect(deviceBand(guessed).id).toBe('b04');
    expect(farmSizeIsEstimated(guessed)).toBe(true);
    expect(farmSizeIsEstimated({ farmSize: 800, batch: { count: 800 } })).toBe(false);
    expect(deviceChicks({})).toBeNull();
    expect(farmSizeIsEstimated({})).toBe(false); // nothing at all to guess from
  });
});
