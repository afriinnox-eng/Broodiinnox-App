import React, { useMemo, useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { batchDay, batchRemaining } from '../../lib/services.js';
import { ANIMALS } from '../../lib/presets.js';
import { Badge, Btn, Card, DataTable, Field, Modal } from '../../components/ui.jsx';
import { fmtDate } from '../../lib/time.js';
import { t } from '../../i18n/strings.js';

export default function AdminBatches() {
  const { state, dispatch } = useStore();
  const lang = state.lang || 'en';
  const now = new Date().toISOString();
  const [addOpen, setAddOpen] = useState(false);
  const farmers = useMemo(() => Object.fromEntries(state.farmers.map((f) => [f.id, f.name])), [state.farmers]);
  const running = state.devices.filter((d) => d.batch && d.batch.status === 'running');
  const ended = state.devices.filter((d) => d.batch?.status === 'ended' || d.lastBatchEnd);

  return (
    <div>
      <div className="row-between">
        <h1>{t('nav.batches', lang)} <span className="pill">{running.length} running</span></h1>
        <Btn variant="green" onClick={() => setAddOpen(true)}>+ Start batch</Btn>
      </div>

      <div className="grid cols-4" style={{ margin: '14px 0' }}>
        {['chicken', 'duck', 'turkey', 'pig'].map((a) => (
          <Card key={a} title={ANIMALS[a].label}>
            <div className="big" style={{ color: 'var(--brand-green)' }}>{running.filter((d) => d.batch.animal === a).length}</div>
            <div className="muted small">active batches</div>
          </Card>
        ))}
      </div>

      <h3>Running batches</h3>
      <DataTable
        columns={[
          { key: 'device', label: 'System', render: (r) => <b>{r.id}</b> },
          { key: 'farmer', label: 'Farmer', render: (r) => farmers[r.farmerId] || '—' },
          { key: 'animal', label: 'Animal', render: (r) => ANIMALS[r.batch.animal]?.label },
          { key: 'day', label: 'Day', render: (r) => `${batchDay(r.batch.startDate, r.batch.durationDays, now)}/${r.batch.durationDays}` },
          { key: 'remaining', label: 'Remaining', render: (r) => batchRemaining(r.batch.startDate, r.batch.durationDays, now) },
          { key: 'count', label: 'Animals', render: (r) => r.batch.count },
          { key: 'start', label: 'Started', render: (r) => fmtDate(r.batch.startDate) },
          { key: 'actions', label: '', render: (r) => <Btn small variant="danger" onClick={() => { dispatch({ type: 'END_BATCH', deviceId: r.id }); dispatch({ type: 'TOAST', msg: 'Batch ended.' }); }}>End</Btn> },
        ]}
        rows={running.map((d) => ({ ...d, _key: d.id }))}
      />

      <h3 style={{ marginTop: 20 }}>Completed / past batches</h3>
      {ended.length === 0 ? <div className="muted">No completed batches yet.</div> : (
        <DataTable
          columns={[
            { key: 'device', label: 'System', render: (r) => <b>{r.id}</b> },
            { key: 'farmer', label: 'Farmer', render: (r) => farmers[r.farmerId] || '—' },
            { key: 'animal', label: 'Animal', render: (r) => r.batch ? ANIMALS[r.batch.animal]?.label : '—' },
            { key: 'count', label: 'Animals', render: (r) => r.batch?.count || '—' },
            { key: 'end', label: 'Ended', render: (r) => fmtDate(r.lastBatchEnd) },
          ]}
          rows={ended.map((d) => ({ ...d, _key: d.id }))}
        />
      )}

      {addOpen && <AddBatchModal devices={state.devices} dispatch={dispatch} onClose={() => setAddOpen(false)} />}
    </div>
  );
}

function AddBatchModal({ devices, dispatch, onClose }) {
  const [deviceId, setDeviceId] = useState(devices.find((d) => !d.batch)?.id || devices[0]?.id || '');
  const [animal, setAnimal] = useState('chicken');
  const [duration, setDuration] = useState('21');
  const [count, setCount] = useState('500');
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const durNum = Number(duration);
  const cntNum = Number(count);
  const formValid = Number.isInteger(durNum) && durNum >= 1 && Number.isInteger(cntNum) && cntNum >= 1;
  return (
    <Modal title="Start a batch (admin)" onClose={onClose}>
      <Field label="System">
        <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
          {devices.map((d) => <option key={d.id} value={d.id} disabled={!!d.batch}>{d.serial} — {d.name}{d.batch ? ' (has batch)' : ''}</option>)}
        </select>
      </Field>
      <Field label="Animal type">
        <select value={animal} onChange={(e) => { setAnimal(e.target.value); setDuration(String(ANIMALS[e.target.value].durationDays)); }}>
          {Object.values(ANIMALS).map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
        </select>
      </Field>
      <div className="grid cols-3" style={{ gap: 10 }}>
        <Field label="Duration"><input type="number" min={1} value={duration} onChange={(e) => setDuration(e.target.value)} /></Field>
        <Field label="Animals"><input type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} /></Field>
        <Field label="Start"><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
      </div>
      <div className="btn-row">
        <Btn variant="green" disabled={!formValid} onClick={() => {
          dispatch({ type: 'START_BATCH', deviceId, animal, durationDays: durNum, count: cntNum, startDate: new Date(`${start}T06:00:00`).toISOString() });
          dispatch({ type: 'TOAST', msg: 'Batch started.' });
          onClose();
        }}>Start</Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </div>
    </Modal>
  );
}
