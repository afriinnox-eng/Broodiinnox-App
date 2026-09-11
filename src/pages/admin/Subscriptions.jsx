import React, { useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { subscriptionState } from '../../lib/services.js';
import { BANDS, TERMS, bandForChicks, bandLabel, coverageFor, deviceBand, priceForPlan, termById } from '../../lib/subscriptions.js';
import { Badge, Btn, Card, DataTable, Field, Modal } from '../../components/ui.jsx';
import { fmtDate } from '../../lib/time.js';
import { fmtMoney, t } from '../../i18n/strings.js';

/**
 * Afriinnox's view of subscriptions.
 *
 * A plan is a duration, and its PRICE comes from the approved sheet by farm
 * size, so this page shows the sheet itself (every farm-size band against every
 * plan) rather than a list of hand-typed prices, and it lists what each running
 * subscription is actually paying and whether it reaches the end of its batch.
 */
export default function AdminSubscriptions() {
  const { state, dispatch } = useStore();
  const lang = state.lang || 'en';
  const now = new Date().toISOString();
  const [edit, setEdit] = useState(null); // plan term being edited
  const [create, setCreate] = useState(false);
  const farmers = Object.fromEntries(state.farmers.map((f) => [f.id, f.name]));
  const activeSubs = state.devices.filter((d) => d.subscription?.status === 'active' && subscriptionState(d.subscription.endDate, now) === 'active');
  const termOf = (id) => state.plans.find((p) => p.id === id) || TERMS.find((x) => x.id === id);
  /** A plan is named the same way everywhere: "15-Day Plan", not "15-Day". */
  const planLabel = (plan) => termById(plan.id)?.name || plan.name;

  /** Every published price of one plan, cheapest farm size first. */
  const planPrices = (plan) => BANDS
    .map((band) => ({ band, price: priceForPlan(band, plan) }))
    .filter((r) => r.price !== null);

  return (
    <div>
      <h1>{t('nav.subscriptions', lang)}</h1>

      <h3 style={{ marginTop: 8 }}>Plans <span className="pill">{state.plans.length}</span></h3>
      <p className="muted small">
        A plan is a duration. What it costs is set by the farm size it is bought for, from the approved
        price sheet below — so no price is stored on the plan itself.
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
                  {fmtMoney(cheapest.price)} for {bandLabel(cheapest.band)} — {fmtMoney(dearest.price)} for{' '}
                  {bandLabel(dearest.band)}. Above 15,999 chicks quoted individually.
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
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Farm size</th>
              {state.plans.map((p) => <th key={p.id}>{planLabel(p)}</th>)}
            </tr>
          </thead>
          <tbody>
            {BANDS.map((band) => (
              <tr key={band.id}>
                <td><b>{bandLabel(band)}</b></td>
                {state.plans.map((p) => {
                  const price = priceForPlan(band, p);
                  return <td key={p.id}>{price === null ? 'Customized' : fmtMoney(price)}</td>;
                })}
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
            const band = deviceBand(r);
            return <div>{r.farmSize ? r.farmSize.toLocaleString('en-US') : '—'}<div className="muted small">{band ? bandLabel(band) : 'not set'}</div></div>;
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

      {edit && <PlanModal plan={edit} dispatch={dispatch} onClose={() => setEdit(null)} />}
      {create && <PlanModal dispatch={dispatch} onClose={() => setCreate(false)} />}
    </div>
  );
}

/**
 * Editing a plan means editing its DURATION (and the multiplier the sheet applies
 * to it) — never an absolute price, which only exists per farm size.
 */
function PlanModal({ plan, dispatch, onClose }) {
  const [name, setName] = useState(plan?.name || '');
  const [durationDays, setDuration] = useState(String(plan?.durationDays || 30));
  const [multiplier, setMultiplier] = useState(String(plan?.multiplier ?? 1.6));
  const [description, setDescription] = useState(plan?.description || '');
  const durNum = Number(durationDays);
  const multNum = Number(multiplier);
  const formValid = Number.isInteger(durNum) && durNum >= 1
    && Number.isFinite(multNum) && multNum > 0 && name.trim() !== '';
  const example = bandForChicks(1000); // 1,000–1,199 chicks, for the live preview
  const save = () => {
    if (!formValid) return;
    if (plan) {
      dispatch({ type: 'UPDATE_PLAN', id: plan.id, patch: { name, durationDays: durNum, multiplier: multNum, description } });
    } else {
      dispatch({ type: 'CREATE_PLAN', plan: { name, durationDays: durNum, multiplier: multNum, description } });
    }
    dispatch({ type: 'TOAST', msg: 'Plan saved. Prices come from the sheet by farm size; transactions already made keep the price paid.' });
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
        On a farm of {bandLabel(example)} this plan would cost{' '}
        <b>{Number.isFinite(multNum) ? fmtMoney(Math.round(example.base * multNum)) : '—'}</b>{' '}
        (the sheet's 15-Day price for that size is {fmtMoney(example.base)}, and every plan is a multiple of it).
      </p>
      <div className="btn-row"><Btn variant="primary" disabled={!formValid} onClick={save}>Save</Btn><Btn onClick={onClose}>Cancel</Btn></div>
    </Modal>
  );
}
