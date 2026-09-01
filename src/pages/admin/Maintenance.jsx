import React, { useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { maintenanceDue } from '../../lib/services.js';
import { Badge, Btn, Card, DataTable, Field, Modal } from '../../components/ui.jsx';
import { fmtDate } from '../../lib/time.js';
import { t } from '../../i18n/strings.js';

export default function AdminMaintenance() {
  const { state, dispatch } = useStore();
  const lang = state.lang || 'en';
  const now = new Date().toISOString();
  const [addOpen, setAddOpen] = useState(false);
  const techs = state.admins.filter((a) => ['technical', 'operations', 'super'].includes(a.role));
  const due = state.maintenance.filter((m) => maintenanceDue(m, now) && m.status !== 'completed');

  return (
    <div>
      <div className="row-between">
        <h1>{t('nav.maintenance', lang)} <span className="pill">{due.length} due</span></h1>
        <Btn variant="primary" onClick={() => setAddOpen(true)}>+ Add maintenance record</Btn>
      </div>

      {due.length > 0 && (
        <div className="warn-banner" style={{ margin: '12px 0' }}>
          🔧 <div><b>{due.length} system(s) need servicing.</b> Afriinnox is alerted automatically when a system is due — assign a technician below.</div>
        </div>
      )}

      <h3 style={{ marginTop: 8 }}>Schedule</h3>
      <DataTable
        columns={[
          { key: 'deviceId', label: 'System', render: (r) => <b>{r.deviceId}</b> },
          { key: 'last', label: 'Last maintenance', render: (r) => fmtDate(r.lastMaintenance) },
          { key: 'next', label: 'Next due', render: (r) => {
            const overdue = maintenanceDue(r, now) && r.status !== 'completed';
            return <Badge tone={overdue ? 'crit' : r.status === 'scheduled' ? 'warn' : 'ok'}>{fmtDate(r.nextMaintenance)}{overdue ? ' (overdue)' : ''}</Badge>;
          } },
          { key: 'technician', label: 'Technician', render: (r) => r.technician || <span className="muted">unassigned</span> },
          { key: 'status', label: 'Status', render: (r) => <Badge tone={{ ok: 'ok', scheduled: 'warn', due: 'crit', overdue: 'crit', completed: 'off' }[r.status] || 'info'}>{r.status}</Badge> },
          { key: 'notes', label: 'Notes', render: (r) => <div className="muted small" style={{ maxWidth: 260 }}>{r.notes || '—'}</div> },
          { key: 'actions', label: '', render: (r) => (
            <div className="btn-row">
              <select className="field" style={{ width: 'auto', marginBottom: 0, padding: '4px 8px' }} value="" onChange={(e) => {
                if (e.target.value) {
                  dispatch({ type: 'MAINTENANCE_UPDATE', id: r.id, patch: { technician: e.target.value, status: 'scheduled' } });
                  dispatch({ type: 'TOAST', msg: `Technician assigned to ${r.deviceId}.` });
                }
              }}>
                <option value="">Assign tech…</option>
                {techs.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
              <Btn small onClick={() => { dispatch({ type: 'MAINTENANCE_UPDATE', id: r.id, patch: { status: 'completed', nextMaintenance: new Date(Date.now() + 90 * 86400000).toISOString() } }); dispatch({ type: 'TOAST', msg: 'Maintenance completed.' }); }}>Complete</Btn>
            </div>
          )},
        ]}
        rows={state.maintenance.map((m) => ({ ...m, _key: m.id }))}
      />

      {addOpen && <AddMaintenanceModal devices={state.devices} techs={techs} dispatch={dispatch} onClose={() => setAddOpen(false)} />}
    </div>
  );
}

function AddMaintenanceModal({ devices, techs, dispatch, onClose }) {
  const [deviceId, setDeviceId] = useState(devices[0]?.id || '');
  const [technician, setTechnician] = useState('');
  const [notes, setNotes] = useState('');
  const [next, setNext] = useState(new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10));
  const save = () => {
    dispatch({ type: 'MAINTENANCE_ADD', record: { deviceId, technician: technician || null, notes, lastMaintenance: new Date().toISOString(), nextMaintenance: new Date(`${next}T09:00:00`).toISOString(), status: 'ok', installer: state.session.name } });
    dispatch({ type: 'TOAST', msg: 'Maintenance record added.' });
    onClose();
  };
  return (
    <Modal title="Add maintenance record" onClose={onClose}>
      <Field label="System"><select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>{devices.map((d) => <option key={d.id} value={d.id}>{d.serial} — {d.name}</option>)}</select></Field>
      <div className="grid cols-2" style={{ gap: 10 }}>
        <Field label="Technician"><select value={technician} onChange={(e) => setTechnician(e.target.value)}><option value="">Unassigned</option>{techs.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}</select></Field>
        <Field label="Next due date"><input type="date" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      </div>
      <Field label="Notes"><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Components replaced, observations…" /></Field>
      <div className="btn-row"><Btn variant="primary" onClick={save}>Save record</Btn><Btn onClick={onClose}>Cancel</Btn></div>
    </Modal>
  );
}
