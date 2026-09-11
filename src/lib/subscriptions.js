/**
 * Broodiinnox subscriptions — the approved price list, and the arithmetic that
 * ties a subscription to the batches it pays for.
 *
 * SOURCE OF TRUTH: "Broodiinnox_Prices_Subscription.pdf" (AFRIINNOX LTD,
 * "Prices Based on Farm Sizes — Subscription Plan"), the sheet behind
 * https://afriinnox.com/solutions/broodiinnox#pricing.
 *
 * Farm size is the MAXIMUM number of chicks (or other livestock) brooded at
 * once — it is a property of the installation, recorded when the device is
 * registered, and it is what decides the price. Bigger farm, higher price.
 *
 * The sheet prints 36 farm-size bands and five plans for each. It gives the
 * 15-Day price per band; the other four columns are exact multiples of it —
 * 30-Day x1.6, 40-Day x1.8, 6-Month x5, 1-Year x8 — in every one of the 36
 * bands. src/tests/subscriptions.test.js pins that down against the printed
 * numbers, band by band, so the sheet and this file cannot drift apart. The
 * top band (16,000 chicks and above) is quoted "Customized": it has no list
 * price and cannot be bought in the app.
 *
 * A subscription is bought per batch, so a plan is judged by the batches it
 * can pay for: the batch the farmer starts, and — when the plan runs longer
 * than one batch — the following ones too. The helpers at the bottom of this
 * file answer exactly that question, and they are what the screens show.
 *
 * Pure data + pure functions: no React, no I/O.
 */

export const DAY_MS = 86400000;

/* ------------------------------------------------------------------ */
/* The five plans on the sheet                                         */
/* ------------------------------------------------------------------ */

/** Plan durations, with the multiplier the sheet applies to the 15-Day price. */
export const TERMS = [
  { id: 't15d', name: '15-Day Plan', days: 15, multiplier: 1, description: 'One short cycle' },
  { id: 't30d', name: '30-Day Plan', days: 30, multiplier: 1.6, description: 'One standard cycle' },
  { id: 't40d', name: '40-Day Plan', days: 40, multiplier: 1.8, description: 'One long cycle (ducks, turkeys)' },
  { id: 't6m', name: '6-Month Plan', days: 180, multiplier: 5, description: 'Several cycles in a row' },
  { id: 't1y', name: '1-Year Plan', days: 365, multiplier: 8, description: 'A full year of cycles' },
];

export const TERM_IDS = TERMS.map((t) => t.id);

/* ------------------------------------------------------------------ */
/* The 36 farm-size bands, with the sheet's 15-Day price               */
/* ------------------------------------------------------------------ */

/**
 * `min`/`max` are inclusive numbers of chicks; `max: null` is the open top band.
 * `base` is the sheet's 15-Day price in RWF, or null where the sheet says
 * "Customized".
 */
export const BANDS = [
  { id: 'b01', min: 1, max: 599, base: 25000 },
  { id: 'b02', min: 600, max: 699, base: 27000 },
  { id: 'b03', min: 700, max: 799, base: 28000 },
  { id: 'b04', min: 800, max: 899, base: 30000 },
  { id: 'b05', min: 900, max: 999, base: 31000 },
  { id: 'b06', min: 1000, max: 1199, base: 33000 },
  { id: 'b07', min: 1200, max: 1499, base: 36000 },
  { id: 'b08', min: 1500, max: 1699, base: 41000 },
  { id: 'b09', min: 1700, max: 1999, base: 44000 },
  { id: 'b10', min: 2000, max: 2199, base: 48000 },
  { id: 'b11', min: 2200, max: 2499, base: 51000 },
  { id: 'b12', min: 2500, max: 2699, base: 56000 },
  { id: 'b13', min: 2700, max: 2999, base: 59000 },
  { id: 'b14', min: 3000, max: 3299, base: 63000 },
  { id: 'b15', min: 3300, max: 3499, base: 68000 },
  { id: 'b16', min: 3500, max: 3699, base: 71000 },
  { id: 'b17', min: 3700, max: 3999, base: 74000 },
  { id: 'b18', min: 4000, max: 4499, base: 79000 },
  { id: 'b19', min: 4500, max: 4999, base: 86000 },
  { id: 'b20', min: 5000, max: 5499, base: 94000 },
  { id: 'b21', min: 5500, max: 5999, base: 102000 },
  { id: 'b22', min: 6000, max: 6499, base: 109000 },
  { id: 'b23', min: 6500, max: 6999, base: 117000 },
  { id: 'b24', min: 7000, max: 7499, base: 125000 },
  { id: 'b25', min: 7500, max: 7999, base: 132000 },
  { id: 'b26', min: 8000, max: 8499, base: 140000 },
  { id: 'b27', min: 8500, max: 8999, base: 148000 },
  { id: 'b28', min: 9000, max: 9499, base: 155000 },
  { id: 'b29', min: 9500, max: 9999, base: 163000 },
  { id: 'b30', min: 10000, max: 10999, base: 171000 },
  { id: 'b31', min: 11000, max: 11999, base: 186000 },
  { id: 'b32', min: 12000, max: 12999, base: 201000 },
  { id: 'b33', min: 13000, max: 13999, base: 217000 },
  { id: 'b34', min: 14000, max: 14999, base: 232000 },
  { id: 'b35', min: 15000, max: 15999, base: 247000 },
  { id: 'b36', min: 16000, max: null, base: null },
];

export const BAND_IDS = BANDS.map((b) => b.id);

/* ------------------------------------------------------------------ */
/* Lookups                                                            */
/* ------------------------------------------------------------------ */

export function termById(id) {
  return TERMS.find((t) => t.id === id) || null;
}

export function bandById(id) {
  return BANDS.find((b) => b.id === id) || null;
}

/** The band a farm falls in, from the number of chicks it broods at once. */
export function bandForChicks(chicks) {
  if (typeof chicks !== 'number' || !Number.isInteger(chicks) || chicks < 1) return null;
  return BANDS.find((b) => chicks >= b.min && (b.max === null || chicks <= b.max)) || null;
}

/** A readable farm size, e.g. "1,000–1,199 chicks" or "16,000+ chicks". */
export function bandLabel(band) {
  if (!band) return '';
  const thousands = (n) => n.toLocaleString('en-US');
  if (band.min <= 1) return `Up to ${thousands(band.max)} chicks`;
  if (band.max === null) return `${thousands(band.min)}+ chicks`;
  return `${thousands(band.min)}–${thousands(band.max)} chicks`;
}

/** True where the sheet quotes a price rather than "Customized". */
export function bandIsPriced(band) {
  return !!band && typeof band === 'object' && typeof band.base === 'number' && Number.isFinite(band.base);
}

/** A resolved band / term is accepted in place of an id, but only a real one. */
function isBand(v) {
  return !!v && typeof v === 'object' && typeof v.min === 'number' && (v.base === null || typeof v.base === 'number');
}

function isTerm(v) {
  return !!v && typeof v === 'object' && typeof v.days === 'number' && typeof v.multiplier === 'number';
}

/**
 * What one plan costs on one farm-size band. Returns null where the sheet says
 * "Customized" (the top band) or the band/term is unknown — never a guess.
 * Accepts an id or an already-resolved band/term object; anything else is null.
 */
export function priceFor(bandId, termId) {
  const band = isBand(bandId) ? bandId : bandById(bandId);
  const term = isTerm(termId) ? termId : termById(termId);
  if (!band || !term || !bandIsPriced(band)) return null;
  const price = Math.round(band.base * term.multiplier);
  return Number.isFinite(price) ? price : null;
}

/**
 * The same for a plan as the app stores it (state.plans: durationDays +
 * multiplier), including a plan an admin created that has no sheet id.
 */
export function priceForPlan(bandId, plan) {
  const band = isBand(bandId) ? bandId : bandById(bandId);
  const multiplier = typeof plan?.multiplier === 'number' && plan.multiplier > 0 ? plan.multiplier : null;
  if (!band || !bandIsPriced(band) || multiplier === null) return null;
  const price = Math.round(band.base * multiplier);
  return Number.isFinite(price) ? price : null;
}

/** The same, straight from a number of chicks. */
export function planPrice(termId, chicks) {
  return priceFor(bandForChicks(chicks), termId);
}

/** Every plan priced for one farm size: [{ term, price }] — price may be null. */
export function plansForBand(bandId) {
  const band = typeof bandId === 'object' && bandId !== null ? bandId : bandById(bandId);
  return TERMS.map((term) => ({ term, band, price: priceFor(band, term) }));
}

/** A positive whole count, or null: a string or a fraction is not a farm size. */
function asCount(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/** The farm size a device was registered with, however it was recorded. */
export function deviceChicks(device) {
  const declared = asCount(device?.farmSize);
  if (declared !== null) return declared;
  // Units registered before farm sizes existed: the current batch is the only
  // honest hint we have, and the screens label it as such.
  return asCount(device?.batch?.count);
}

export function deviceBand(device) {
  return bandForChicks(deviceChicks(device));
}

/** Was the farm size recorded, or merely inferred from the running batch? */
export function farmSizeIsEstimated(device) {
  return asCount(device?.farmSize) === null && asCount(device?.batch?.count) !== null;
}

/* ------------------------------------------------------------------ */
/* The price sheet as DATA — what the admin console edits              */
/* ------------------------------------------------------------------ */

/**
 * The published sheet as editable data: one row per farm size, one price per
 * plan in that row, plus the size label the row is shown under.
 *
 * BANDS/TERMS above stay the published SHEET OF RECORD — the numbers the PDF
 * prints, and what `publishedSheet()` rebuilds and what "Reset" restores. What
 * the app shows and charges is `state.sheet`, which starts as this and can be
 * edited in the admin console.
 *
 * A cell is a number (the price in RWF), or null for "Customized": the sheet
 * quotes nothing for that pair and the app must never invent one. A cell that
 * is ABSENT is different from null — it means the sheet has no opinion (a plan
 * created after the sheet was published), and the price falls back to the
 * row's reference price times that plan's multiplier.
 */
export const SHEET_SOURCE = 'Broodiinnox_Prices_Subscription.pdf';

/** The largest price the sheet will accept, in RWF — above this is a typo. */
export const MAX_PRICE = 100000000;

export function publishedSheet() {
  return {
    source: SHEET_SOURCE,
    updatedAt: null,
    updatedBy: null,
    bands: BANDS.map((b) => ({
      id: b.id,
      min: b.min,
      max: b.max,
      label: bandLabel(b),
      prices: Object.fromEntries(TERMS.map((t) => [t.id, priceFor(b, t)])),
    })),
  };
}

function isSheetBand(v) {
  return !!v && typeof v === 'object'
    && typeof v.id === 'string'
    && Number.isInteger(v.min) && v.min >= 1
    && (v.max === null || (Number.isInteger(v.max) && v.max >= v.min))
    && typeof v.label === 'string'
    && !!v.prices && typeof v.prices === 'object' && !Array.isArray(v.prices);
}

/** A sheet that is missing or half-built falls back to the published one. */
export function sheetOf(sheet) {
  const bands = Array.isArray(sheet?.bands) ? sheet.bands.filter(isSheetBand) : [];
  return bands.length === BANDS.length ? { ...sheet, bands } : publishedSheet();
}

export function sheetBands(sheet) {
  return sheetOf(sheet).bands;
}

export function sheetBandById(sheet, bandId) {
  return sheetBands(sheet).find((b) => b.id === bandId) || null;
}

/** The band a farm falls in, under the sheet as the admin has it right now. */
export function sheetBandForChicks(sheet, chicks) {
  if (typeof chicks !== 'number' || !Number.isInteger(chicks) || chicks < 1) return null;
  return sheetBands(sheet).find((b) => chicks >= b.min && (b.max === null || chicks <= b.max)) || null;
}

/** The row's label, however the admin renamed it. */
export function sheetBandLabel(sheet, band) {
  const b = typeof band === 'object' && band !== null ? band : sheetBandById(sheet, band);
  if (!b) return '';
  return typeof b.label === 'string' && b.label.trim() !== '' ? b.label : bandLabel(b);
}

/** True when the row quotes at least one price, rather than "Customized". */
export function sheetBandIsPriced(sheet, band) {
  const b = typeof band === 'object' && band !== null ? band : sheetBandById(sheet, band);
  if (!b) return false;
  return Object.values(b.prices || {}).some((v) => typeof v === 'number' && Number.isFinite(v));
}

/**
 * The row's reference price — the 15-Day price the sheet is built on, and what
 * a plan with no cell of its own is priced as a multiple of.
 */
export function sheetBandBase(sheet, band) {
  const b = typeof band === 'object' && band !== null ? band : sheetBandById(sheet, band);
  if (!b) return null;
  const fifteen = b.prices?.[TERMS[0].id];
  if (typeof fifteen === 'number' && Number.isFinite(fifteen)) return fifteen;
  const published = bandById(b.id);
  if (published && bandIsPriced(published)) return published.base;
  const priced = Object.values(b.prices || {}).filter((v) => typeof v === 'number' && Number.isFinite(v));
  return priced.length ? Math.min(...priced) : null;
}

/**
 * What one plan costs on one farm size, as the sheet stands now. A price the
 * admin typed wins; a "Customized" cell is null; a plan the sheet has no cell
 * for is the row's reference price times that plan's multiplier.
 *
 * Accepts a plan object (the app's own, with durationDays + multiplier) or just
 * its id, the way `priceFor` accepts a band or a band id.
 */
export function sheetPrice(sheet, band, plan) {
  const b = typeof band === 'object' && band !== null ? band : sheetBandById(sheet, band);
  if (!b) return null;
  const id = typeof plan === 'string' ? plan : plan?.id;
  const cell = id && b.prices ? b.prices[id] : undefined;
  if (cell === null) return null;
  if (typeof cell === 'number') return Number.isFinite(cell) && cell >= 0 ? cell : null;
  // no cell of its own: a plan created after the list was published is priced
  // as a multiple of the row's reference price
  const own = typeof plan?.multiplier === 'number' && plan.multiplier > 0 ? plan.multiplier : null;
  const published = typeof plan === 'string' ? termById(plan)?.multiplier ?? null : null;
  const multiplier = own ?? published;
  const base = sheetBandBase(sheet, b);
  if (multiplier === null || base === null) return null;
  const price = Math.round(base * multiplier);
  return Number.isFinite(price) ? price : null;
}

/** Every plan priced for one farm size: [{ plan, band, price }]. */
export function sheetPlansForBand(sheet, band, plans) {
  const list = Array.isArray(plans) && plans.length ? plans : TERMS;
  return list.map((plan) => ({ plan, band, price: sheetPrice(sheet, band, plan) }));
}

/** The plan an id refers to: the app's own plans first, the published terms second. */
export function planFrom(plans, id) {
  const list = Array.isArray(plans) ? plans : [];
  return list.find((p) => p.id === id) || termById(id) || null;
}

/* ---------------------------- editing ------------------------------ */

/** Why this price cannot be saved, or null when it can. */
export function priceEditError(price) {
  if (price === null) return null; // "Customized" — the sheet quotes nothing
  if (typeof price !== 'number' || !Number.isFinite(price)) return 'A price must be a number, or empty for "Customized".';
  if (!Number.isInteger(price)) return 'A price must be a whole number of RWF.';
  if (price < 0) return 'A price cannot be negative.';
  if (price > MAX_PRICE) return `That price is above the largest the sheet accepts (RWF ${MAX_PRICE.toLocaleString('en-US')}) — check for a typo.`;
  return null;
}

/**
 * Why these bands are not a usable price list, or null when they are.
 *
 * Every chick count must fall in exactly ONE band, so the rows have to tile the
 * range: whole numbers, sorted, starting at 1, each row picking up where the
 * last one stopped, and only the top row open-ended. A gap would leave a farm
 * size with no price at all; an overlap would give it two.
 */
export function sheetTilingError(bands) {
  if (!Array.isArray(bands) || bands.length !== BANDS.length) return 'The price list must keep one row per farm size.';
  if (new Set(bands.map((b) => b.id)).size !== bands.length) return 'Two rows share the same farm size.';
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  if (sorted[0].min !== 1) return 'The first row must start at 1 chick.';
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    if (prev.max === null) return `Only the top row can be open-ended — ${sheetBandLabel(null, prev)} has no upper limit.`;
    if (sorted[i].min !== prev.max + 1) {
      return `The rows must run without a gap or an overlap: ${sheetBandLabel(null, prev)} ends at ${prev.max.toLocaleString('en-US')}, the next row starts at ${sorted[i].min.toLocaleString('en-US')}.`;
    }
  }
  if (sorted[sorted.length - 1].max !== null) return 'The top row must stay open-ended (16,000+ chicks and above).';
  return null;
}

/** Why this edit to one row cannot be saved, or null when it can. */
export function bandEditError(sheet, bandId, patch = {}) {
  const band = sheetBandById(sheet, bandId);
  if (!band) return 'That farm size is not on the sheet.';
  if (patch.label !== undefined && String(patch.label).trim() === '') return 'A farm size needs a name.';
  for (const key of ['min', 'max']) {
    const value = patch[key];
    if (value === undefined || value === band[key]) continue;
    if (value === null && key === 'max') continue;
    if (!Number.isInteger(value) || value < 1) return key === 'min' ? 'The smallest farm size must be a whole number of chicks, at least 1.' : 'The largest farm size must be a whole number of chicks.';
  }
  const patched = sheetBands(sheet).map((b) => (b.id === bandId ? { ...b, ...patch } : b));
  const min = patched.find((b) => b.id === bandId).min;
  const max = patched.find((b) => b.id === bandId).max;
  if (max !== null && max < min) return 'The largest farm size cannot be below the smallest.';
  return sheetTilingError(patched);
}

/** The sheet with one price changed, or null when the edit is not allowed. */
export function sheetWithPrice(sheet, bandId, planId, price) {
  const s = sheetOf(sheet);
  const band = s.bands.find((b) => b.id === bandId);
  if (!band || typeof planId !== 'string' || planId === '') return null;
  if (priceEditError(price) !== null) return null;
  return { ...s, bands: s.bands.map((b) => (b.id === bandId ? { ...b, prices: { ...b.prices, [planId]: price } } : b)) };
}

/** The sheet with one row renamed, or re-ranged, or null when that is invalid. */
export function sheetWithBand(sheet, bandId, patch = {}) {
  const s = sheetOf(sheet);
  if (bandEditError(s, bandId, patch) !== null) return null;
  const next = {};
  if (patch.label !== undefined) next.label = String(patch.label).trim();
  if (patch.min !== undefined) next.min = patch.min;
  if (patch.max !== undefined) next.max = patch.max;
  return { ...s, bands: s.bands.map((b) => (b.id === bandId ? { ...b, ...next } : b)) };
}

/* ------------------------------------------------------------------ */
/* A subscription against the batch it is paying for                   */
/* ------------------------------------------------------------------ */

/** A positive whole number of days, or null: '30', 1.5, null and {} are not. */
function asDays(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/** The last day of a batch (the app's convention: start + duration - 1 days). */
export function batchEnd(startIso, durationDays) {
  const start = Date.parse(startIso || '');
  const days = asDays(durationDays);
  if (!Number.isFinite(start) || days === null) return null;
  return new Date(start + (days - 1) * DAY_MS).toISOString();
}

/**
 * How many whole batches of `batchDays` a plan of `termDays` can pay for.
 * A plan shorter than a single batch covers none — it must be renewed or
 * extended before that batch finishes.
 */
export function batchesCovered(termDays, batchDays) {
  const t = asDays(termDays);
  const b = asDays(batchDays);
  if (t === null || b === null) return 0;
  return Math.floor(t / b);
}

/** Days left over once whole batches are paid for (0 when the fit is exact). */
export function leftoverDays(termDays, batchDays) {
  const t = asDays(termDays);
  const b = asDays(batchDays);
  if (t === null || b === null) return 0;
  return t % b;
}

/** The shortest, cheapest plan that can pay for a whole batch of this length. */
export function recommendedTerm(batchDays) {
  const b = asDays(batchDays);
  if (b === null) return null;
  return TERMS.find((t) => t.days >= b) || TERMS[TERMS.length - 1];
}

/**
 * The same, over the plans the app actually sells right now — an admin may have
 * changed a duration — falling back to the published terms.
 */
export function recommendedPlan(plans, batchDays) {
  const b = asDays(batchDays);
  if (b === null) return null;
  const list = (Array.isArray(plans) && plans.length ? plans : TERMS)
    .filter((p) => typeof (p.durationDays ?? p.days) === 'number')
    .slice()
    .sort((x, y) => (x.durationDays ?? x.days) - (y.durationDays ?? y.days));
  if (!list.length) return null;
  return list.find((p) => (p.durationDays ?? p.days) >= b) || list[list.length - 1];
}

/**
 * What a plan would do for a batch of `batchDays` if it were bought today:
 * how many whole cycles it pays for, how many days it leaves over, and whether
 * it is too short to pay for even one.
 */
export function planFit(termDays, batchDays) {
  const t = asDays(termDays);
  const b = asDays(batchDays);
  if (t === null || b === null) return null;
  const cycles = Math.floor(t / b);
  return { termDays: t, batchDays: b, cycles, spareDays: t - cycles * b, tooShort: cycles === 0 };
}

/** Days still to run on a batch that is already under way (at least 1). */
export function batchDaysRemaining(batch, nowIso) {
  const days = asDays(batch?.durationDays);
  if (days === null) return null;
  const end = batchEnd(batch.startDate, days);
  const now = Date.parse(nowIso || '') || Date.now();
  const endTs = Date.parse(end || '');
  if (!Number.isFinite(endTs)) return null;
  return Math.max(0, Math.ceil((endTs - now) / DAY_MS));
}

/**
 * Everything the screens need about one subscription against one batch:
 * what was bought, how much of it is spent, and whether it reaches the end of
 * the batch it is paying for.
 *
 * `sub`   a device's subscription ({ planId, bandId, price, startDate, endDate, status, batchesUsed })
 * `batch` the batch it is paying for ({ startDate, durationDays, animal, count }), or null
 * `nowIso` the clock
 */
export function coverageFor(sub, batch, nowIso) {
  const now = Date.parse(nowIso || '') || Date.now();
  const term = termById(sub?.planId);
  const band = bandById(sub?.bandId);
  const termDays = term?.days ?? null;
  const start = Date.parse(sub?.startDate || '');
  const end = Date.parse(sub?.endDate || '');

  const daysLeft = Number.isFinite(end) ? Math.max(0, Math.ceil((end - now) / DAY_MS)) : 0;
  const daysUsed = termDays === null
    ? null
    : Number.isFinite(start) ? Math.min(termDays, Math.max(0, termDays - daysLeft)) : null;

  // Cover is the window the subscription actually holds — which is longer than
  // its plan when a renewal was stacked on top of days that were still running.
  const paidDays = Number.isFinite(start) && Number.isFinite(end) && end > start
    ? Math.max(1, Math.ceil((end - start) / DAY_MS))
    : termDays;

  const batchDays = Number.isInteger(batch?.durationDays) && batch.durationDays > 0 ? batch.durationDays : null;
  const batchEndsAt = batchDays ? batchEnd(batch.startDate, batchDays) : null;
  const batchEndTs = Date.parse(batchEndsAt || '');
  const subEndTs = Number.isFinite(end) ? end : null;

  // Does the subscription reach the last day of this batch?
  const coversBatch = !!(batchEndsAt && subEndTs && subEndTs >= batchEndTs);
  const shortfallDays = coversBatch || !batchEndsAt || !subEndTs
    ? 0
    : Math.max(1, Math.ceil((batchEndTs - subEndTs) / DAY_MS));

  const capacity = paidDays !== null && batchDays ? batchesCovered(paidDays, batchDays) : 0;
  const batchesUsed = Number.isInteger(sub?.batchesUsed) && sub.batchesUsed >= 0 ? sub.batchesUsed : 0;

  return {
    term,
    band,
    price: typeof sub?.price === 'number' ? sub.price : null,
    termDays,
    paidDays,
    startDate: sub?.startDate || null,
    endDate: sub?.endDate || null,
    expired: !!(subEndTs && subEndTs < now),
    daysLeft,
    daysUsed,
    batchDays,
    batchEndsAt: batchEndsAt || null,
    coversBatch,
    shortfallDays,
    batchesCovered: capacity,
    batchesUsed,
    /** How many more whole batches this plan can still pay for. */
    batchesLeft: Math.max(0, capacity - batchesUsed),
    /** True when the batch being paid for is the last one the plan can serve. */
    isLastBatch: capacity > 0 && batchesUsed + 1 >= capacity,
    /** Days of the plan that no whole batch will use (the fit is not exact). */
    leftover: paidDays !== null && batchDays ? leftoverDays(paidDays, batchDays) : 0,
  };
}

/** Cost per day — the number that shows why a longer plan is cheaper per cycle. */
export function pricePerDay(price, termDays) {
  if (typeof price !== 'number' || typeof termDays !== 'number') return null;
  if (!Number.isFinite(price) || !Number.isFinite(termDays) || termDays <= 0) return null;
  return price / termDays;
}
