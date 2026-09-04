import React, { useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { subscriptionState } from '../../lib/services.js';
import { Badge, Btn, Card, DataTable, Field, Modal } from '../../components/ui.jsx';
import { fmtDate } from '../../lib/time.js';
import { fmtMoney, t } from '../../i18n/strings.js';

export default function AdminSubscriptions() {
  const { state, dispatch } = useStore();
  const lang = state.lang || 'en';
  const now = new Date().toISOString();
  const [edit, setEdit] = useState(null); // plan being edited
  const [create, setCreate] = useState(false);
  const farmers = Object.fromEntries(state.farmers.map((f) => [f.id, f.name]));
  const activeSubs = state.devices.filter((d) => d.subscription?.status === 'active' && subscriptionState(d.subscription.endDate, now) === 'active');

  return (
    <div>
      <h1>{t('nav.subscriptions', lang)}</h1>

      <h3 style={{ marginTop: 8 }}>Plans <span className="pill">{state.plans.length}</span></h3>
      <div className="grid cols-3">
        {state.plans.map((p) => (
          <Card key={p.id} title={p.name}>
            <div className="big" style={{ color: 'var(--brand-green)' }}>{fmtMoney(p.price)}</div>
            <div className="muted small">{p.durationDays} days · {p.description}</div>
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
        ))}
        <button className="btn" style={{ minHeight: 120, justifyContent: 'center' }} onClick={() => setCreate(true)}>+ Create plan</button>
      </div>

      <h3 style={{ marginTop: 20 }}>Active subscriptions <span className="pill">{activeSubs.length}</span></h3>
      <DataTable
        columns={[
          { key: 'system', label: 'System', render: (r) => <b>{r.serial}</b> },
          { key: 'farmer', label: 'Farmer', render: (r) => farmers[r.farmerId] || '—' },
          { key: 'plan', label: 'Plan', render: (r) => state.plans.find((p) => p.id === r.subscription.planId)?.name || '—' },
          { key: 'start', label: 'Started', render: (r) => fmtDate(r.subscription.startDate) },
          { key: 'end', label: 'Expires', render: (r) => fmtDate(r.subscription.endDate) },
          { key: 'left', label: 'Days left', render: (r) => {
            const d = Math.ceil((new Date(r.subscription.endDate) - new Date(now)) / 86400000);
            return <Badge tone={d <= 7 ? 'warn' : 'ok'}>{d}</Badge>;
          } },
        ]}
        rows={activeSubs.map((d) => ({ ...d, _key: d.id }))}
      />

      {edit && <PlanModal plan={edit} dispatch={dispatch} onClose={() => setEdit(null)} />}
      {create && <PlanModal dispatch={dispatch} onClose={() => setCreate(false)} />}
    </div>
  );
}

function PlanModal({ plan, dispatch, onClose }) {
  const [name, setName] = useState(plan?.name || '');
  const [durationDays, setDuration] = useState(String(plan?.durationDays || 30));
  const [price, setPrice] = useState(String(plan?.price || 25000));
  const [description, setDescription] = useState(plan?.description || '');
  const durNum = Number(durationDays);
  const priceNum = Number(price);
  const formValid = Number.isInteger(durNum) && durNum >= 1
    && Number.isFinite(priceNum) && priceNum >= 0 && name.trim() !== '';
  const save = () => {
    if (!formValid) return;
    if (plan) {
      dispatch({ type: 'UPDATE_PLAN', id: plan.id, patch: { name, durationDays: durNum, price: priceNum, description } });
    } else {
      dispatch({ type: 'CREATE_PLAN', plan: { name, durationDays: durNum, price: priceNum, description } });
    }
    dispatch({ type: 'TOAST', msg: 'Plan saved. Historical transactions keep the original price paid.' });
    onClose();
  };
  return (
    <Modal title={plan ? 'Edit plan' : 'Create plan'} onClose={onClose}>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 45-Day" /></Field>
      <div className="grid cols-2" style={{ gap: 10 }}>
        <Field label="Duration (days)"><input type="number" min={1} value={durationDays} onChange={(e) => setDuration(e.target.value)} /></Field>
        <Field label="Price (RWF)"><input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
      </div>
      <Field label="Description"><input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div className="btn-row"><Btn variant="primary" disabled={!formValid} onClick={save}>Save</Btn><Btn onClick={onClose}>Cancel</Btn></div>
    </Modal>
  );
}
