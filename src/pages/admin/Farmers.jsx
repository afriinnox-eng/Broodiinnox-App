import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../../lib/store.jsx';
import { churnRisk, subscriptionState } from '../../lib/services.js';
import { Badge, Btn, Card, DataTable, EmptyState, Field, Modal } from '../../components/ui.jsx';
import { fmtDate, fmtDateTime } from '../../lib/time.js';
import { fmtMoney, t } from '../../i18n/strings.js';

export default function AdminFarmers() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state, dispatch } = useStore();
  const lang = state.lang || 'en';
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('all');
  const [addOpen, setAddOpen] = useState(false);
  const now = new Date().toISOString();

  const farmers = useMemo(() => {
    let list = state.farmers;
    if (q.trim()) {
      const n = q.toLowerCase();
      list = list.filter((f) => `${f.name} ${f.phone} ${f.email} ${f.district}`.toLowerCase().includes(n));
    }
    if (statusF !== 'all') list = list.filter((f) => f.status === statusF);
    return list;
  }, [state.farmers, q, statusF]);

  const devicesOf = (fid) => state.devices.filter((d) => d.farmerId === fid);
  const selected = id ? state.farmers.find((f) => f.id === id) : null;

  return (
    <div>
      <div className="row-between">
        <h1>{t('nav.farmers', lang)} <span className="pill">{farmers.length}</span></h1>
        <Btn variant="primary" onClick={() => setAddOpen(true)}>+ Register farmer</Btn>
      </div>
      <div className="row" style={{ margin: '12px 0' }}>
        <input className="topbar-search" placeholder="Search name, phone, email, district…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, maxWidth: 360 }} />
        <select className="field" style={{ width: 'auto', marginBottom: 0 }} value={statusF} onChange={(e) => setStatusF(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <DataTable
        columns={[
          { key: 'name', label: 'Farmer', render: (r) => <div><b>{r.name}</b><div className="muted small">{r.phone} · {r.email}</div></div> },
          { key: 'district', label: 'Location', render: (r) => `${r.district}, ${r.sector}` },
          { key: 'systems', label: 'Systems', render: (r) => devicesOf(r.id).length },
          { key: 'sub', label: 'Subscriptions', render: (r) => {
            const subs = devicesOf(r.id).filter((d) => d.subscription?.status === 'active' && subscriptionState(d.subscription.endDate, now) === 'active').length;
            return <Badge tone={subs ? 'ok' : 'off'}>{subs} active</Badge>;
          } },
          { key: 'risk', label: 'Churn risk', render: (r) => { const c = churnRisk(r.lastActiveBatchEnd, now); return <Badge tone={c.level === 'high' ? 'crit' : c.level === 'medium' ? 'warn' : c.level === 'low' ? 'info' : 'ok'}>{c.label}</Badge>; } },
          { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'active' ? 'ok' : 'off'}>{r.status}</Badge> },
        ]}
        rows={farmers.map((f) => ({ ...f, _key: f.id, _id: f.id }))}
        onRowClick={(r) => navigate(`/admin/farmers/${r._id}`)}
      />

      {selected && (
        <Card title={`${selected.name} — details`} style={{ marginTop: 16 }} actions={<Btn small onClick={() => navigate('/admin/farmers')}>Close</Btn>}>
          <div className="grid cols-2">
            <div>
              <div className="muted small">Contact</div>
              <div>{selected.phone} · {selected.email}</div>
              <div className="muted small" style={{ marginTop: 8 }}>Location</div>
              <div>{selected.district}, {selected.sector}</div>
              <div className="muted small" style={{ marginTop: 8 }}>Created</div>
              <div>{fmtDate(selected.createdAt)}</div>
            </div>
            <div>
              <div className="btn-row" style={{ marginTop: 0 }}>
                <Btn small variant="danger" onClick={() => { dispatch({ type: 'UPDATE_FARMER', id: selected.id, patch: { status: selected.status === 'active' ? 'inactive' : 'active' } }); dispatch({ type: 'TOAST', msg: 'Farmer status updated.' }); }}>
                  {selected.status === 'active' ? 'Deactivate' : 'Activate'}
                </Btn>
                <Btn small onClick={() => { dispatch({ type: 'TOAST', msg: 'Password reset email sent (demo).' }); }}>Reset password</Btn>
                <Btn small onClick={() => { dispatch({ type: 'TOAST', msg: 'Message sent (demo).' }); }}>Send message</Btn>
              </div>
              <h4 style={{ marginTop: 14 }}>Systems ({devicesOf(selected.id).length})</h4>
              {devicesOf(selected.id).map((d) => (
                <div key={d.id} className="row-between" style={{ borderBottom: '1px solid var(--border)', padding: '6px 0' }}>
                  <span><b>{d.serial}</b> — {d.name}</span>
                  <Badge tone={d.subscription?.status === 'active' ? 'ok' : 'crit'}>{d.subscription?.status || 'none'}</Badge>
                </div>
              ))}
              <h4 style={{ marginTop: 14 }}>Recent payments</h4>
              {state.payments.filter((p) => p.farmerId === selected.id).slice(0, 4).map((p) => (
                <div key={p.id} className="muted small">{fmtDateTime(p.createdAt)} · {fmtMoney(p.amount)} · {p.status}</div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {addOpen && <AddFarmerModal dispatch={dispatch} onClose={() => setAddOpen(false)} />}
    </div>
  );
}

function AddFarmerModal({ dispatch, onClose }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [district, setDistrict] = useState('Kigali');
  const [sector, setSector] = useState('Gasabo');
  const save = () => {
    if (!name.trim() || !phone.trim()) return;
    dispatch({ type: 'REGISTER_FARMER', farmer: { name, phone, email, district, sector } });
    dispatch({ type: 'TOAST', msg: `Farmer ${name} registered — invitation sent.` });
    onClose();
  };
  return (
    <Modal title="Register a farmer" onClose={onClose}>
      <Field label="Full name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid cols-2" style={{ gap: 10 }}>
        <Field label="Phone"><input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Email"><input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      </div>
      <div className="grid cols-2" style={{ gap: 10 }}>
        <Field label="District"><input value={district} onChange={(e) => setDistrict(e.target.value)} /></Field>
        <Field label="Sector"><input value={sector} onChange={(e) => setSector(e.target.value)} /></Field>
      </div>
      <p className="muted small">The farmer receives an invitation by SMS/email and creates their password.</p>
      <div className="btn-row"><Btn variant="primary" onClick={save}>Register</Btn><Btn onClick={onClose}>Cancel</Btn></div>
    </Modal>
  );
}
