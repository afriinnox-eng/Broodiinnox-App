import React, { useMemo, useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { batchDay, batchRemaining } from '../../lib/services.js';
import { ANIMALS } from '../../lib/presets.js';
import { fmtDate } from '../../lib/time.js';
import { Badge, Btn, Card, EmptyState, Field, Modal, Progress, Tabs } from '../../components/ui.jsx';
import { Icon } from '../../components/icons.jsx';
import { t } from '../../i18n/strings.js';

export default function FarmerBatches() {
  const { state, dispatch } = useStore();
  const lang = state.lang || 'en';
  const now = new Date().toISOString();
  const myDevices = useMemo(() => state.devices.filter((d) => d.farmerId === state.session.id), [state.devices, state.session.id]);
  const [tab, setTab] = useState('current');
  const [modal, setModal] = useState(false);

  const current = myDevices.filter((d) => d.batch && d.batch.status === 'running' && batchRemaining(d.batch.startDate, d.batch.durationDays, now) > 0);
  const past = myDevices.filter((d) => (d.batch && d.batch.status === 'ended') || (!d.batch && d.lastBatchEnd));

  return (
    <div>
      <h1>{t('nav.batches', lang)}</h1>
      <div className="row-between">
        <p className="muted">The system calculates the batch day and remaining days automatically.</p>
        <Btn variant="green" onClick={() => setModal(true)}><Icon name="egg" size={16} /> Start new batch</Btn>
      </div>

      <Tabs tabs={[{ key: 'current', label: `Current (${current.length})` }, { key: 'past', label: `History (${past.length})` }]} active={tab} onChange={setTab} />

      {tab === 'current' && (
        current.length === 0 ? <EmptyState icon="egg" text="No active batches." /> :
        <div className="grid cols-2">
          {current.map((d) => {
            const day = batchDay(d.batch.startDate, d.batch.durationDays, now);
            const rem = batchRemaining(d.batch.startDate, d.batch.durationDays, now);
            return (
              <Card key={d.id} title={`${d.name} (${d.serial})`}>
                <div className="row-between">
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>{ANIMALS[d.batch.animal]?.label}</div>
                    <div className="muted small">Started {fmtDate(d.batch.startDate)} · {d.batch.count} animals</div>
                  </div>
                  <Badge tone="ok">Day {day}/{d.batch.durationDays}</Badge>
                </div>
                <div style={{ margin: '10px 0 4px' }}><Progress value={(day / d.batch.durationDays) * 100} /></div>
                <div className="row-between">
                  <span className="muted small">{rem} days remaining</span>
                  <span className="muted small">ends {fmtDate(new Date(new Date(d.batch.startDate).getTime() + (d.batch.durationDays - 1) * 86400000).toISOString())}</span>
                </div>
                <div className="btn-row" style={{ marginTop: 10 }}>
                  <Btn variant="danger" small onClick={() => { dispatch({ type: 'END_BATCH', deviceId: d.id }); dispatch({ type: 'TOAST', msg: 'Batch ended.' }); }}>End batch</Btn>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {tab === 'past' && (
        past.length === 0 ? <EmptyState icon="clock" text="No past batches yet." /> :
        <div className="grid cols-2">
          {past.map((d) => (
            <Card key={d.id} title={`${d.name} (${d.serial})`}>
              {d.lastBatchEnd && (
                <div className="muted small">Last cycle ended {fmtDate(d.lastBatchEnd)}</div>
              )}
              {d.batch?.status === 'ended' && (
                <div className="muted small">Last batch: {ANIMALS[d.batch.animal]?.label}, {d.batch.count} animals, started {fmtDate(d.batch.startDate)}</div>
              )}
            </Card>
          ))}
        </div>
      )}

      {modal && (
        <Modal title="Start a new brooding batch" onClose={() => setModal(false)}>
          <NewBatchForm devices={myDevices} dispatch={dispatch} onDone={() => setModal(false)} />
        </Modal>
      )}
    </div>
  );
}

function NewBatchForm({ devices, dispatch, onDone }) {
  const [deviceId, setDeviceId] = useState(devices[0]?.id || '');
  const [animal, setAnimal] = useState('chicken');
  const [duration, setDuration] = useState(21);
  const [count, setCount] = useState(500);
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  if (!devices.length) return <div className="muted">You have no systems to start a batch on.</div>;
  const preset = ANIMALS[animal];
  return (
    <>
      <Field label="System"><select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>{devices.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.serial})</option>)}</select></Field>
      <Field label="Animal type">
        <select value={animal} onChange={(e) => { setAnimal(e.target.value); setDuration(ANIMALS[e.target.value].durationDays); }}>
          {Object.values(ANIMALS).map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
        </select>
      </Field>
      <div className="grid cols-3" style={{ gap: 10 }}>
        <Field label="Duration (days)"><input type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></Field>
        <Field label="Animals"><input type="number" value={count} onChange={(e) => setCount(Number(e.target.value))} /></Field>
        <Field label="Start date"><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
      </div>
      <p className="muted small">Recommended: {preset.baseMin}–{preset.baseMax}°C for {preset.durationDays} days. Targets auto-adjust with age.</p>
      <div className="btn-row">
        <Btn variant="green" onClick={() => {
          dispatch({ type: 'START_BATCH', deviceId, animal, durationDays: duration, count, startDate: new Date(`${start}T06:00:00`).toISOString() });
          dispatch({ type: 'TOAST', msg: 'Batch started.' });
          onDone();
        }}>Start batch</Btn>
        <Btn onClick={onDone}>Cancel</Btn>
      </div>
    </>
  );
}
