import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../../lib/store.jsx';
import { churnRisk, farmerDetailIssues, subscriptionState } from '../../lib/services.js';
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
  const [editOpen, setEditOpen] = useState(false);
  const [removeId, setRemoveId] = useState(null); // the system whose removal is being confirmed
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

  /* Who owns a system is the console's to change, and "nobody" is one of the
     answers: the system stays registered and keeps reporting - it is the farmer
     it is taken off, who then stops seeing it. */
  const reassign = (device, farmerId) => {
    const to = farmerId ? state.farmers.find((f) => f.id === farmerId) : null;
    dispatch({ type: 'ASSIGN_DEVICE', deviceId: device.id, farmerId: to ? to.id : null });
    dispatch({
      type: 'TOAST',
      msg: to ? `${device.serial} moved to ${to.name}.` : `${device.serial} is no longer assigned to any farmer.`,
    });
    setRemoveId(null);
  };

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
                <Btn small variant="primary" onClick={() => setEditOpen(true)}>Edit details</Btn>
                <Btn small variant="danger" onClick={() => { dispatch({ type: 'UPDATE_FARMER', id: selected.id, patch: { status: selected.status === 'active' ? 'inactive' : 'active' } }); dispatch({ type: 'TOAST', msg: 'Farmer status updated.' }); }}>
                  {selected.status === 'active' ? 'Deactivate' : 'Activate'}
                </Btn>
                <Btn small onClick={() => { dispatch({ type: 'TOAST', msg: 'Password reset email sent (demo).' }); }}>Reset password</Btn>
                <Btn small onClick={() => { dispatch({ type: 'TOAST', msg: 'Message sent (demo).' }); }}>Send message</Btn>
              </div>
              <h4 style={{ marginTop: 14 }}>Systems ({devicesOf(selected.id).length})</h4>
              {devicesOf(selected.id).map((d) => (
                <div key={d.id} style={{ borderBottom: '1px solid var(--border)', padding: '6px 0' }}>
                  <div className="row-between">
                    <span><b>{d.serial}</b> — {d.name}</span>
                    <Badge tone={d.subscription?.status === 'active' ? 'ok' : 'crit'}>{d.subscription?.status || 'none'}</Badge>
                  </div>
                  <div className="row" style={{ gap: 6, marginTop: 6, alignItems: 'center' }}>
                    <label className="muted small" htmlFor={`owner-${d.id}`}>Owner</label>
                    <select
                      id={`owner-${d.id}`}
                      className="field"
                      style={{ width: 'auto', marginBottom: 0 }}
                      value={d.farmerId || ''}
                      onChange={(e) => reassign(d, e.target.value)}
                    >
                      <option value="">— Unassigned —</option>
                      {state.farmers.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                    <Btn small variant="danger" onClick={() => setRemoveId(d.id)}>Remove from farmer</Btn>
                  </div>
                </div>
              ))}
              {!devicesOf(selected.id).length && (
                <div className="muted small">No system is assigned to this farmer. Register one, or give them one from the system's own page.</div>
              )}
              <h4 style={{ marginTop: 14 }}>Recent payments</h4>
              {state.payments.filter((p) => p.farmerId === selected.id).slice(0, 4).map((p) => (
                <div key={p.id} className="muted small">{fmtDateTime(p.createdAt)} · {fmtMoney(p.amount)} · {p.status}</div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {removeId && (() => {
        const dev = state.devices.find((x) => x.id === removeId);
        if (!dev) return null;
        return (
          <Modal title={`Remove ${dev.serial} from ${selected?.name}?`} onClose={() => setRemoveId(null)}>
            <p>The system stays registered and keeps reporting — it is only taken off this farmer, who stops seeing it. You can give it to another farmer at any time.</p>
            <div className="btn-row">
              <Btn variant="primary" onClick={() => reassign(dev, null)}>Remove it</Btn>
              <Btn onClick={() => setRemoveId(null)}>Keep it</Btn>
            </div>
          </Modal>
        );
      })()}

      {editOpen && selected && (
        <EditFarmerModal farmer={selected} farmers={state.farmers} dispatch={dispatch} onClose={() => setEditOpen(false)} />
      )}

      {addOpen && <AddFarmerModal dispatch={dispatch} onClose={() => setAddOpen(false)} />}
    </div>
  );
}

/**
 * A farmer's details, after they were registered.
 *
 * Everything the console needs to correct is here — the name, how to reach the
 * farmer, and where the farm is. The phone number and the email address are
 * checked with `farmerDetailIssues` because those two are the farmer's way IN:
 * auth.js signs someone in by matching exactly them, so two farmers holding one
 * address would mean the second to type it lands in the first one's account.
 */
function EditFarmerModal({ farmer, farmers, dispatch, onClose }) {
  const [form, setForm] = useState({
    name: farmer.name || '',
    phone: farmer.phone || '',
    email: farmer.email || '',
    district: farmer.district || '',
    sector: farmer.sector || '',
  });
  const [tried, setTried] = useState(false);
  const issues = farmerDetailIssues({ patch: form, farmers, selfId: farmer.id });
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const save = () => {
    setTried(true);
    if (Object.keys(issues).length) return; // nothing is written until the details are usable
    const name = form.name.trim();
    dispatch({
      type: 'UPDATE_FARMER',
      id: farmer.id,
      patch: {
        name,
        phone: form.phone.trim(),
        email: form.email.trim().toLowerCase(),
        district: form.district.trim(),
        sector: form.sector.trim(),
      },
    });
    dispatch({ type: 'TOAST', msg: `${name} — details updated.` });
    onClose();
  };

  return (
    <Modal title={`Edit ${farmer.name}`} onClose={onClose}>
      <Field label="Full name"><input value={form.name} onChange={set('name')} /></Field>
      {tried && issues.name && <div className="warn-banner" role="alert">{issues.name}</div>}
      <div className="grid cols-2" style={{ gap: 10 }}>
        <Field label="Phone"><input value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Email"><input value={form.email} onChange={set('email')} /></Field>
      </div>
      {tried && (issues.phone || issues.email || issues.identifier) && (
        <div className="warn-banner" role="alert">{issues.phone || issues.email || issues.identifier}</div>
      )}
      <div className="grid cols-2" style={{ gap: 10 }}>
        <Field label="District"><input value={form.district} onChange={set('district')} /></Field>
        <Field label="Sector"><input value={form.sector} onChange={set('sector')} /></Field>
      </div>
      <p className="muted small">The phone number and the email address are how this farmer signs in — changing either changes their sign-in.</p>
      <div className="btn-row">
        <Btn variant="primary" onClick={save}>Save details</Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </div>
    </Modal>
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
