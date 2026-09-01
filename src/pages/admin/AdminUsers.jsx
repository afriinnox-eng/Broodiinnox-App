import React, { useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { Badge, Btn, Card, DataTable, Field, Modal } from '../../components/ui.jsx';
import { fmtDate } from '../../lib/time.js';
import { t } from '../../i18n/strings.js';

const ROLES = [
  { key: 'super', label: 'Super Admin', desc: 'Full access — accounts, permissions, everything.' },
  { key: 'operations', label: 'Operations Admin', desc: 'Devices, farmers, monitoring and support.' },
  { key: 'finance', label: 'Finance Admin', desc: 'Payments, subscriptions and financial reports.' },
  { key: 'technical', label: 'Technical Admin', desc: 'Devices, sensors, configurations, technical controls.' },
  { key: 'support', label: 'Support Staff', desc: 'Farmers, communication and support tickets.' },
];

export default function AdminUsers() {
  const { state, dispatch } = useStore();
  const lang = state.lang || 'en';
  const [addOpen, setAddOpen] = useState(false);
  const me = state.session;

  return (
    <div>
      <div className="row-between">
        <h1>{t('nav.admins', lang)} <span className="pill">{state.admins.length}</span></h1>
        <Btn variant="primary" onClick={() => setAddOpen(true)}>+ Create admin account</Btn>
      </div>

      <h3 style={{ marginTop: 8 }}>Roles</h3>
      <div className="grid cols-3">
        {ROLES.map((r) => (
          <Card key={r.key} title={r.label}>
            <p className="muted small">{r.desc}</p>
            <Badge tone={state.admins.filter((a) => a.role === r.key).length ? 'ok' : 'off'}>{state.admins.filter((a) => a.role === r.key).length} account(s)</Badge>
          </Card>
        ))}
      </div>

      <h3 style={{ marginTop: 20 }}>Accounts</h3>
      <DataTable
        columns={[
          { key: 'name', label: 'Name', render: (r) => <div><b>{r.name}</b>{r.id === me.id && <Badge tone="info" >you</Badge>}</div> },
          { key: 'email', label: 'Email' },
          { key: 'role', label: 'Role', render: (r) => <Badge tone="info">{ROLES.find((x) => x.key === r.role)?.label || r.role}</Badge> },
          { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'active' ? 'ok' : 'off'}>{r.status}</Badge> },
          { key: 'createdAt', label: 'Created', render: (r) => fmtDate(r.createdAt) },
          { key: 'actions', label: '', render: (r) => (
            <div className="btn-row">
              <Btn small onClick={() => { dispatch({ type: 'UPDATE_ADMIN', id: r.id, patch: { status: r.status === 'active' ? 'inactive' : 'active' } }); dispatch({ type: 'TOAST', msg: 'Admin account updated.' }); }}>
                {r.status === 'active' ? 'Disable' : 'Enable'}
              </Btn>
              <Btn small onClick={() => { dispatch({ type: 'TOAST', msg: 'Password reset sent (demo).' }); }}>Reset pwd</Btn>
            </div>
          )},
        ]}
        rows={state.admins.map((a) => ({ ...a, _key: a.id }))}
      />

      {addOpen && <AddAdminModal dispatch={dispatch} onClose={() => setAddOpen(false)} />}
    </div>
  );
}

function AddAdminModal({ dispatch, onClose }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('support');
  const save = () => {
    if (!name.trim() || !email.trim()) return;
    dispatch({ type: 'ADD_ADMIN', admin: { name, email, role } });
    dispatch({ type: 'TOAST', msg: `Admin ${name} created (${role}).` });
    onClose();
  };
  return (
    <Modal title="Create admin account" onClose={onClose}>
      <Field label="Full name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Email"><input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Role">
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
      </Field>
      <p className="muted small">Don't make every administrator a super admin — assign the least privilege that fits the job.</p>
      <div className="btn-row"><Btn variant="primary" onClick={save}>Create</Btn><Btn onClick={onClose}>Cancel</Btn></div>
    </Modal>
  );
}
