import React, { useEffect, useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { subscriptionState } from '../../lib/services.js';
import {
  SHEET_SOURCE, coverageFor, deviceChicks, planFrom, sheetBandBase, sheetBandForChicks,
  sheetBandIsPriced, sheetBandLabel, sheetBands, sheetPrice,
} from '../../lib/subscriptions.js';
import { Badge, Btn, Card, DataTable, Field, Modal } from '../../components/ui.jsx';
import { fmtDate, fmtDateTime } from '../../lib/time.js';
import { fmtMoney, t } from '../../i18n/strings.js';

/**
 * Afriinnox's view of subscriptions, and the price list itself.
 *
 * A plan is a duration; what it costs is decided by the farm size it is bought
 * for. This page therefore shows — and EDITS — the price sheet, because the
 * sheet is what the whole app reads: every plan the farmer is shown, every
 * amount charged, and every farm-size label. A sale already made keeps the price
 * it was sold at, so editing the sheet changes what is quoted from now on, never
 * what was paid.
 */
export default function AdminSubscriptions() {
  const { state, dispatch } = useStore();
  const lang = state.lang || 'en';
  const now = new Date().toISOString();
  const [edit, setEdit] = useState(null); // plan term being edited
  const [create, setCreate] = useState(false);
  const sheet = state.sheet;
  const bands = sheetBands(sheet);
  const topBand = bands[bands.length - 1];
  const farmers = Object.fromEntries(state.farmers.map((f) => [f.id, f.name]));
  const activeSubs = state.devices.filter((d) => d.subscription?.status === 'active' && subscriptionState(d.subscription.endDate, now) === 'active');
  const termOf = (id) => planFrom(state.plans, id);
  /** Plans are named the way the admin named them — the whole list renames with it. */
  const planLabel = (plan) => plan?.name || '';

  /** Every published price of one plan, cheapest farm size first. */
  const planPrices = (plan) => bands
    .map((band) => ({ band, price: sheetPrice(sheet, band, plan) }))
    .filter((r) => r.price !== null);

  return (
    <div>
      <h1>{t('nav.subscriptions', lang)}</h1>

      <h3 style={{ marginTop: 8 }}>Plans <span className="pill">{state.plans.length}</span></h3>
      <p className="muted small">
        A plan is a duration. What it costs is set by the farm size it is bought for, from the price list
        below — so no price is stored on the plan itself, and renaming a plan renames it everywhere.
      </p>
      <div className="grid cols-3">
        {state.plans.map((p) => {
          const rows = planPrices(p);
          const cheapest = rows[0];
          const dearest = rows[rows.length - 1];
          return (
            <Card key={p.id} title={planLabel(p)}>
              <div className="big" style={{ color: 'var(--brand-green)' }}>
                {cheapest ? fmtMoney(cheapest.price) : 'No price'}
                {cheapest && dearest.price !== cheapest.price ? ` – ${fmtMoney(dearest.price)}` : ''}
              </div>
              <div className="muted small">{p.durationDays} days · {p.description}</div>
              {cheapest && (
                <div className="muted small" style={{ marginTop: 6 }}>
                  {fmtMoney(cheapest.price)} for {sheetBandLabel(sheet, cheapest.band)} — {fmtMoney(dearest.price)} for{' '}
                  {sheetBandLabel(sheet, dearest.band)}.{' '}
                  {sheetBandIsPriced(sheet, topBand)
                    ? `${sheetBandLabel(sheet, topBand)} is priced on this list too.`
                    : `Above ${(topBand.min - 1).toLocaleString('en-US')} chicks quoted individually.`}
                </div>
              )}
              <div className="row" style={{ marginTop: 8 }}>
                <Badge tone={p.active ? 'ok' : 'off'}>{p.active ? 'active' : 'inactive'}</Badge>
              </div>
              <div className="btn-row" style={{ marginTop: 10 }}>
                <Btn small onClick={() => setEdit(p)}>Edit</Btn>
                <Btn small onClick={() => { dispatch({ type: 'UPDATE_PLAN', id: p.id, patch: { active: !p.active } }); dispatch({ type: 'TOAST', msg: 'Plan updated.' }); }}>
                  {p.active ? 'Deactivate' : 'Activate'}
                </Btn>
              </div>
            </Card>
          );
        })}
        <button className="btn" style={{ minHeight: 120, justifyContent: 'center' }} onClick={() => setCreate(true)}>+ Create plan</button>
      </div>

      <h3 style={{ marginTop: 20 }}>Price list by farm size (chicks)</h3>
      <p className="muted small">
        This list is what the whole app reads: the plans a farmer is shown, the amount MoMo is asked for,
        and the farm-size names on both pages. Type in a cell and it saves when you leave it. Leave a price
        empty for <b>Customized</b> — the app then quotes nothing rather than inventing a number. Rename a
        farm size or move its range in the first column; a subscription already sold keeps the price and the
        size it was sold at, so editing here changes what is quoted from now on, never what was paid.
      </p>
      <div className="row-between" style={{ marginTop: 6 }}>
        <div className="muted small">
          {sheet.updatedBy
            ? `Last changed by ${sheet.updatedBy} on ${fmtDateTime(sheet.updatedAt)}`
            : `As published — ${SHEET_SOURCE}`}
        </div>
        <Btn small onClick={() => dispatch({ type: 'SHEET_RESET' })}>Reset to the published list</Btn>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ minWidth: 210 }}>Farm size</th>
              {state.plans.map((p) => (
                <th key={p.id}>
                  <Btn small title="Rename this plan, or change its duration" onClick={() => setEdit(p)}>
                    {planLabel(p)}
                  </Btn>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bands.map((band) => (
              <BandRow key={band.id} band={band} plans={state.plans} sheet={sheet} dispatch={dispatch} />
            ))}
          </tbody>
        </table>
      </div>

      <h3 style={{ marginTop: 20 }}>Active subscriptions <span className="pill">{activeSubs.length}</span></h3>
      <DataTable
        columns={[
          { key: 'system', label: 'System', render: (r) => <b>{r.serial}</b> },
          { key: 'farmer', label: 'Farmer', render: (r) => farmers[r.farmerId] || '—' },
          { key: 'farmSize', label: 'Farm size', render: (r) => {
            const band = sheetBandForChicks(sheet, deviceChicks(r));
            return <div>{r.farmSize ? r.farmSize.toLocaleString('en-US') : '—'}<div className="muted small">{band ? sheetBandLabel(sheet, band) : 'not set'}</div></div>;
          } },
          { key: 'plan', label: 'Plan', render: (r) => (
            <div>
              {termOf(r.subscription.planId)?.name || '—'}
              <div className="muted small">{typeof r.subscription.price === 'number' ? fmtMoney(r.subscription.price) : '—'}</div>
            </div>
          ) },
          { key: 'start', label: 'Started', render: (r) => fmtDate(r.subscription.startDate) },
          { key: 'end', label: 'Expires', render: (r) => fmtDate(r.subscription.endDate) },
          { key: 'left', label: 'Days left', render: (r) => {
            const d = Math.ceil((new Date(r.subscription.endDate) - new Date(now)) / 86400000);
            return <Badge tone={d <= 7 ? 'warn' : 'ok'}>{d}</Badge>;
          } },
          { key: 'batch', label: 'Batch cover', render: (r) => {
            const c = coverageFor(r.subscription, r.batch, now);
            if (!c.batchDays) return <span className="muted small">no batch running</span>;
            if (!c.coversBatch) {
              return <Badge tone="crit">{`ends ${c.shortfallDays}d before the ${c.batchDays}-day batch`}</Badge>;
            }
            return <Badge tone="ok">{c.batchesCovered > 1 ? `covers it · batch ${c.batchesUsed} of ${c.batchesCovered}` : 'covers it'}</Badge>;
          } },
        ]}
        rows={activeSubs.map((d) => ({ ...d, _key: d.id }))}
      />

      {edit && <PlanModal plan={edit} sheet={sheet} dispatch={dispatch} onClose={() => setEdit(null)} />}
      {create && <PlanModal sheet={sheet} dispatch={dispatch} onClose={() => setCreate(false)} />}
    </div>
  );
}

/**
 * Editing a plan means editing its NAME, its DURATION and what it says to the
 * farmer. The multiplier only seeds a brand-new plan: a plan that already has
 * cells on the price list is priced by those cells, and they are typed over in
 * the list itself. A change never re-prices a subscription already sold.
 */
function PlanModal({ plan, sheet, dispatch, onClose }) {
  const [name, setName] = useState(plan?.name || '');
  const [durationDays, setDuration] = useState(String(plan?.durationDays || 30));
  const [multiplier, setMultiplier] = useState(String(plan?.multiplier ?? 1.6));
  const [description, setDescription] = useState(plan?.description || '');
  const durNum = Number(durationDays);
  const multNum = Number(multiplier);
  const formValid = Number.isInteger(durNum) && durNum >= 1
    && Number.isFinite(multNum) && multNum > 0 && name.trim() !== '';
  const example = sheetBandForChicks(sheet, 1000); // 1,000–1,199 chicks, for the live preview
  const exampleBase = example ? sheetBandBase(sheet, example) : null;
  const examplePrice = example && Number.isFinite(multNum) && exampleBase !== null
    ? Math.round(exampleBase * multNum)
    : null;
  const save = () => {
    if (!formValid) return;
    if (plan) {
      dispatch({ type: 'UPDATE_PLAN', id: plan.id, patch: { name, durationDays: durNum, multiplier: multNum, description } });
    } else {
      dispatch({ type: 'CREATE_PLAN', plan: { name, durationDays: durNum, multiplier: multNum, description } });
    }
    dispatch({ type: 'TOAST', msg: 'Plan saved. Prices come from the price list by farm size; transactions already made keep the price paid.' });
    onClose();
  };
  return (
    <Modal title={plan ? 'Edit plan' : 'Create plan'} onClose={onClose}>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 45-Day" /></Field>
      <div className="grid cols-2" style={{ gap: 10 }}>
        <Field label="Duration (days)"><input type="number" min={1} value={durationDays} onChange={(e) => setDuration(e.target.value)} /></Field>
        <Field label="Price multiplier (x the 15-Day price)"><input type="number" min={0.1} step={0.1} value={multiplier} onChange={(e) => setMultiplier(e.target.value)} /></Field>
      </div>
      <Field label="Description"><input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <p className="muted small">
        On a farm of {sheetBandLabel(sheet, example)}, the 15-Day column is{' '}
        <b>{exampleBase === null ? 'not priced' : fmtMoney(exampleBase)}</b>
        {examplePrice === null
          ? '.'
          : <>, and a plan priced as this multiple of it would be <b>{fmtMoney(examplePrice)}</b> — a plan with
            cells of its own on the price list is priced by those cells, which you type over in the list.</>}
      </p>
      <div className="btn-row"><Btn variant="primary" disabled={!formValid} onClick={save}>Save</Btn><Btn onClick={onClose}>Cancel</Btn></div>
    </Modal>
  );
}

/**
 * One row of the price list: the farm size it covers, and one price per plan.
 *
 * Every field saves when it is LEFT (blur or Enter), so a typo is not written on
 * each keystroke, and a value the list refuses leaves the row exactly as the
 * sheet has it — the store is the only truth here.
 */
function BandRow({ sheet, band, plans, dispatch }) {
  const [label, setLabel] = useState(band.label);
  const [min, setMin] = useState(String(band.min));
  const [max, setMax] = useState(band.max === null ? '' : String(band.max));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (focused) return;
    setLabel(band.label);
    setMin(String(band.min));
    setMax(band.max === null ? '' : String(band.max));
  }, [band.label, band.min, band.max, focused]);

  const commitLabel = () => {
    setFocused(false);
    if (label.trim() !== band.label.trim()) dispatch({ type: 'SHEET_SET_BAND', bandId: band.id, patch: { label } });
  };
  const commitRange = () => {
    setFocused(false);
    const nextMin = min.trim() === '' ? NaN : Number(min);
    const nextMax = max.trim() === '' ? null : Number(max);
    if (nextMin === band.min && nextMax === band.max) return;
    dispatch({ type: 'SHEET_SET_BAND', bandId: band.id, patch: { min: nextMin, max: nextMax } });
  };
  const onKey = (e) => { if (e.key === 'Enter') e.currentTarget.blur(); };

  return (
    <tr>
      <td>
        <input
          className="cell-input name"
          aria-label="Farm size name"
          value={label}
          onFocus={() => setFocused(true)}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={onKey}
        />
        <div className="row" style={{ gap: 4, alignItems: 'center', marginTop: 4 }}>
          <input
            className="cell-input tiny"
            aria-label={`${label} — chicks from`}
            inputMode="numeric"
            value={min}
            onFocus={() => setFocused(true)}
            onChange={(e) => setMin(e.target.value)}
            onBlur={commitRange}
            onKeyDown={onKey}
          />
          <span className="muted small">to</span>
          <input
            className="cell-input tiny"
            aria-label={`${label} — chicks to`}
            placeholder="and above"
            inputMode="numeric"
            value={max}
            onFocus={() => setFocused(true)}
            onChange={(e) => setMax(e.target.value)}
            onBlur={commitRange}
            onKeyDown={onKey}
          />
          <span className="muted small">chicks</span>
        </div>
      </td>
      {plans.map((plan) => (
        <td key={plan.id}>
          <PriceCell band={band} plan={plan} price={sheetPrice(sheet, band, plan)} dispatch={dispatch} />
        </td>
      ))}
    </tr>
  );
}

/** One RWF cell: a whole number of RWF, or empty for "Customized". */
function PriceCell({ band, plan, price, dispatch }) {
  const [draft, setDraft] = useState(price === null ? '' : String(price));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (focused) return;
    setDraft(price === null ? '' : String(price));
  }, [price, focused]);

  const commit = () => {
    setFocused(false);
    const raw = draft.trim();
    const next = raw === '' ? null : Number(raw);
    if (next === price) return;
    dispatch({ type: 'SHEET_SET_PRICE', bandId: band.id, planId: plan.id, price: next });
  };

  return (
    <input
      className="cell-input price"
      aria-label={`${plan.name} — ${band.label}`}
      placeholder="Customized"
      inputMode="numeric"
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
}
