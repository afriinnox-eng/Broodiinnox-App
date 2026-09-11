import React, { useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { subscriptionState } from '../../lib/services.js';
import {
  SHEET_SOURCE, coverageFor, describeChange, deviceChicks, draftError, publishImpact,
  sheetBandForChicks, sheetBandIsPriced, sheetBandLabel, sheetBands, sheetChanges, sheetPrice,
} from '../../lib/subscriptions.js';
import { Badge, Btn, Card, DataTable, Field, Modal } from '../../components/ui.jsx';
import { fmtDate, fmtDateTime } from '../../lib/time.js';
import { fmtMoney, t } from '../../i18n/strings.js';

/**
 * Afriinnox's view of subscriptions, and the price list itself.
 *
 * The list is what the whole app reads: the plans a farmer is shown, the amount
 * MoMo is asked for, and the farm-size names on both pages. It is edited in two
 * steps, deliberately:
 *
 *   EDIT   the table turns into fields (behind one Edit button, top right)
 *   SAVE   the result is a DRAFT: this console shows it, farmers do not
 *   PUBLISH the draft becomes the published list, farmers see it, and every
 *          farmer it concerns is notified of what changed
 *
 * A subscription already sold keeps the price and the farm size it was bought
 * at, so none of this rewrites what someone has already paid.
 */
export default function AdminSubscriptions() {
  const { state, dispatch } = useStore();
  const lang = state.lang || 'en';
  const now = new Date().toISOString();

  const published = { bands: sheetBands(state.sheet), plans: state.plans };
  const draft = state.sheetDraft || null;
  const shown = draft ? { bands: draft.bands, plans: draft.plans } : published;

  const [mode, setMode] = useState('view');   // 'view' | 'edit'
  const [working, setWorking] = useState(null);
  const [planEdit, setPlanEdit] = useState(null);
  const [publishOpen, setPublishOpen] = useState(false);

  const editing = mode === 'edit' && !!working;
  const view = editing ? working : shown;                       // the bands + plans on screen
  const sheet = { ...state.sheet, bands: view.bands };
  const bands = view.bands;
  const plans = view.plans;
  const topBand = bands[bands.length - 1];

  const pending = draft ? sheetChanges(published, draft) : [];
  const pendingImpact = draft ? publishImpact(state.devices, pending, draft) : [];
  const farmers = Object.fromEntries(state.farmers.map((f) => [f.id, f.name]));
  const activeSubs = state.devices.filter((d) => d.subscription?.status === 'active' && subscriptionState(d.subscription.endDate, now) === 'active');
  const planOf = (id) => plans.find((p) => p.id === id) || published.plans.find((p) => p.id === id) || null;

  /** Every price of one plan on screen, cheapest farm size first. */
  const planPrices = (plan) => bands
    .map((band) => ({ band, price: sheetPrice(sheet, band, plan) }))
    .filter((r) => r.price !== null);

  /* ---------------------------- editing ---------------------------- */

  const startEdit = () => {
    setWorking({
      bands: shown.bands.map((b) => ({ ...b, prices: { ...b.prices } })),
      plans: shown.plans.map((p) => ({ ...p })),
    });
    setMode('edit');
  };
  const cancelEdit = () => { setWorking(null); setMode('view'); };
  const save = () => {
    const reason = draftError(published, working);
    if (reason) {
      dispatch({ type: 'TOAST', msg: reason, kind: 'error' });
      return;
    }
    dispatch({ type: 'SHEET_SAVE', bands: working.bands, plans: working.plans });
    dispatch({ type: 'TOAST', msg: 'Saved. Farmers keep seeing the published list until you publish.' });
    setWorking(null);
    setMode('view');
  };
  const setCell = (bandId, planId, value) => setWorking((w) => ({
    ...w,
    bands: w.bands.map((b) => (b.id === bandId ? { ...b, prices: { ...b.prices, [planId]: value } } : b)),
  }));
  const setLabel = (bandId, label) => setWorking((w) => ({
    ...w,
    bands: w.bands.map((b) => (b.id === bandId ? { ...b, label } : b)),
  }));
  const putPlan = (plan) => setWorking((w) => ({
    ...w,
    plans: w.plans.some((p) => p.id === plan.id) ? w.plans.map((p) => (p.id === plan.id ? plan : p)) : [...w.plans, plan],
  }));

  /** What a cell holds while editing: the number, empty for Customized, or the derived price. */
  const cellValue = (band, plan) => {
    const v = band.prices ? band.prices[plan.id] : undefined;
    if (v === null) return '';
    if (v !== undefined) return String(v);
    const derived = sheetPrice(sheet, band, plan);
    return derived === null ? '' : String(derived);
  };
  const parseCell = (raw) => {
    const text = raw.trim();
    if (text === '') return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : raw;   // an unparseable value is kept so Save can refuse it by name
  };

  const statusLine = editing
    ? 'Editing — nothing changes until you press Save, and farmers see nothing until you publish.'
    : draft
      ? `Saved by ${draft.savedBy} on ${fmtDateTime(draft.savedAt)} — not published yet, so farmers still see the published list.`
      : state.sheet.publishedBy
        ? `Published by ${state.sheet.publishedBy} on ${fmtDateTime(state.sheet.publishedAt)} · from ${SHEET_SOURCE}`
        : `As published — ${SHEET_SOURCE}`;

  return (
    <div>
      <h1>{t('nav.subscriptions', lang)}</h1>

      <div className="row-between" style={{ marginTop: 8 }}>
        <h3 style={{ margin: 0 }}>Plans <span className="pill">{plans.length}</span></h3>
      </div>
      <p className="muted small">
        A plan is a duration. What it costs is set by the farm size it is bought for, from the price list
        below — no price is stored on the plan itself. These are the five plans the approved sheet prints,
        so the list shows five columns and no more.
      </p>
      <div className="grid cols-3">
        {plans.map((p) => {
          const rows = planPrices(p);
          const cheapest = rows[0];
          const dearest = rows[rows.length - 1];
          const changed = draft && changedPlanIds(pending).has(p.id);
          return (
            <Card key={p.id} title={p.name}>
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
                {changed && <Badge tone="warn">changed, not published</Badge>}
              </div>
            </Card>
          );
        })}
      </div>

      <div className="row-between" style={{ marginTop: 20, alignItems: 'flex-end' }}>
        <div>
          <h3 style={{ margin: 0 }}>Price list by farm size (chicks)</h3>
          <div className="muted small" style={{ marginTop: 4 }}>{statusLine}</div>
        </div>
        <div className="btn-row">
          {editing ? (
            <>
              <Btn variant="primary" onClick={save}>Save</Btn>
              <Btn onClick={cancelEdit}>Cancel</Btn>
            </>
          ) : (
            <>
              {draft && (
                <Btn variant="green" disabled={pending.length === 0} onClick={() => setPublishOpen(true)}>
                  Publish{pending.length ? ` (${pending.length})` : ''}
                </Btn>
              )}
              {draft && <Btn onClick={() => dispatch({ type: 'SHEET_DISCARD' })}>Discard</Btn>}
              <Btn variant={draft ? undefined : 'primary'} onClick={startEdit}>Edit</Btn>
            </>
          )}
        </div>
      </div>
      <p className="muted small">
        Press <b>Edit</b>, change what you need, then <b>Save</b>. A saved list is yours alone — farmers keep
        seeing the published one until you <b>Publish</b>, which makes it live and notifies every farmer it
        concerns. Leave a price empty for <b>Customized</b>. A subscription already sold keeps the price it
        was sold at.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ minWidth: 210 }}>Farm size</th>
              {plans.map((p) => (
                <th key={p.id}>
                  {editing
                    ? <Btn small title="Rename this plan or change how long it lasts" onClick={() => setPlanEdit(p)}>{p.name}</Btn>
                    : p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bands.map((band) => (
              <tr key={band.id}>
                <td>
                  {editing ? (
                    <input
                      className="cell-input name"
                      aria-label="Farm size name"
                      value={band.label}
                      onChange={(e) => setLabel(band.id, e.target.value)}
                    />
                  ) : <b>{sheetBandLabel(sheet, band)}</b>}
                </td>
                {plans.map((plan) => (
                  <td key={plan.id}>
                    {editing ? (
                      <input
                        className="cell-input price"
                        aria-label={`${plan.name} — ${band.label}`}
                        placeholder="Customized"
                        inputMode="numeric"
                        value={cellValue(band, plan)}
                        onChange={(e) => setCell(band.id, plan.id, parseCell(e.target.value))}
                      />
                    ) : (
                      fmtOrCustomized(sheetPrice(sheet, band, plan))
                    )}
                  </td>
                ))}
              </tr>
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
            const band = sheetBandForChicks(state.sheet, deviceChicks(r));
            return <div>{r.farmSize ? r.farmSize.toLocaleString('en-US') : '—'}<div className="muted small">{band ? sheetBandLabel(state.sheet, band) : 'not set'}</div></div>;
          } },
          { key: 'plan', label: 'Plan', render: (r) => (
            <div>
              {planOf(r.subscription.planId)?.name || '—'}
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

      {planEdit && (
        <PlanModal
          plan={planEdit}
          onSave={(plan) => { putPlan(plan); setPlanEdit(null); }}
          onClose={() => setPlanEdit(null)}
        />
      )}

      {publishOpen && (
        <Modal title="Publish the price list" onClose={() => setPublishOpen(false)}>
          <p className="muted small">
            This becomes the list every farmer is shown and what MoMo charges from now on.
            Subscriptions already sold keep the price they were sold at.
          </p>
          <ul style={{ margin: '8px 0 8px 18px' }} className="small">
            {pending.map((change, i) => <li key={i}>{describeChange(change, draft)}</li>)}
          </ul>
          <p className="muted small">
            {pendingImpact.length === 0
              ? 'No farmer is affected by these changes, so nobody is notified.'
              : `${pendingImpact.length} farmer(s) will be notified: ${pendingImpact.map((i) => farmers[i.farmerId] || i.farmerId).join(', ')}.`}
          </p>
          <div className="btn-row">
            <Btn variant="green" onClick={() => { dispatch({ type: 'SHEET_PUBLISH' }); setPublishOpen(false); }}>Publish</Btn>
            <Btn onClick={() => setPublishOpen(false)}>Cancel</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

const fmtOrCustomized = (price) => (price === null ? 'Customized' : fmtMoney(price));

/** The plans whose own definition (name, duration, description) is changed in the draft. */
function changedPlanIds(changes) {
  return new Set(changes
    .filter((c) => c.kind === 'plan.name' || c.kind === 'plan.days' || c.kind === 'plan.description')
    .map((c) => c.planId));
}

/**
 * A plan's name, how long it lasts, what it says to the farmer, and whether it
 * is on sale. This edits the working copy only: nothing reaches the store until
 * Save, and nothing reaches a farmer until Publish.
 *
 * It edits ONE OF THE FIVE the sheet prints — the list is those five plans, so
 * there is nothing here to add a sixth. How a plan is priced is its farm sizes,
 * never a multiplier typed in by hand.
 */
function PlanModal({ plan, onSave, onClose }) {
  const [name, setName] = useState(plan.name || '');
  const [durationDays, setDuration] = useState(String(plan.durationDays || 30));
  const [description, setDescription] = useState(plan.description || '');
  const [active, setActive] = useState(plan.active !== false);
  const durNum = Number(durationDays);
  const valid = name.trim() !== '' && Number.isInteger(durNum) && durNum >= 1;

  return (
    <Modal title="Edit plan" onClose={onClose}>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 45-Day Plan" /></Field>
      <Field label="Duration (days)"><input type="number" min={1} value={durationDays} onChange={(e) => setDuration(e.target.value)} /></Field>
      <Field label="Description"><input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        On sale (a farmer can choose it)
      </label>
      <div className="btn-row">
        <Btn
          variant="primary"
          disabled={!valid}
          onClick={() => onSave({
            id: plan.id,
            name: name.trim(),
            durationDays: durNum,
            description,
            active,
            multiplier: plan.multiplier ?? 1,
          })}
        >
          Save to the list
        </Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </div>
    </Modal>
  );
}
