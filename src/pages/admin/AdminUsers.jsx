import React, { useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { farmerDetailIssues } from '../../lib/services.js';
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
  const [editId, setEditId] = useState(null);
  const me = state.session;

  /* Every account that can sign in. A console account signs in on the same
     screen as a farmer and with the same two identifiers, so this list is what
     decides whether the address or number someone is typing is already taken. */
  const accounts = [...state.farmers, ...state.admins];

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
          { key: 'phone', label: 'Phone', render: (r) => r.phone || <span className="muted">—</span> },
          { key: 'role', label: 'Role', render: (r) => <Badge tone="info">{ROLES.find((x) => x.key === r.role)?.label || r.role}</Badge> },
          { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'active' ? 'ok' : 'off'}>{r.status}</Badge> },
          { key: 'createdAt', label: 'Created', render: (r) => fmtDate(r.createdAt) },
          { key: 'actions', label: '', render: (r) => (
            <div className="btn-row">
              <Btn small variant="primary" onClick={() => setEditId(r.id)}>Edit</Btn>
              <Btn small onClick={() => { dispatch({ type: 'UPDATE_ADMIN', id: r.id, patch: { status: r.status === 'active' ? 'inactive' : 'active' } }); dispatch({ type: 'TOAST', msg: 'Admin account updated.' }); }}>
                {r.status === 'active' ? 'Disable' : 'Enable'}
              </Btn>
              <Btn small onClick={() => { dispatch({ type: 'TOAST', msg: 'Password reset sent (demo).' }); }}>Reset pwd</Btn>
            </div>
          )},
        ]}
        rows={state.admins.map((a) => ({ ...a, _key: a.id }))}
      />

      {editId && (() => {
        const account = state.admins.find((a) => a.id === editId);
        if (!account) return null;
        return <EditAdminModal account={account} accounts={accounts} dispatch={dispatch} onClose={() => setEditId(null)} />;
      })()}

      {addOpen && <AddAdminModal dispatch={dispatch} accounts={accounts} onClose={() => setAddOpen(false)} />}
    </div>
  );
}

function AddAdminModal({ dispatch, accounts, onClose }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('support');
  const [tried, setTried] = useState(false);
  const issues = farmerDetailIssues({ patch: { name, email, phone }, farmers: accounts });
  const save = () => {
    setTried(true);
    if (Object.keys(issues).length) return;
    dispatch({ type: 'ADD_ADMIN', admin: { name: name.trim(), email: email.trim().toLowerCase(), phone: phone.trim(), role } });
    dispatch({ type: 'TOAST', msg: `Admin ${name.trim()} created (${role}).` });
    onClose();
  };
  return (
    <Modal title="Create admin account" onClose={onClose}>
      <Field label="Full name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid cols-2" style={{ gap: 10 }}>
        <Field label="Email"><input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Phone"><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0788 123 456" /></Field>
      </div>
      {tried && (issues.name || issues.email || issues.phone || issues.identifier) && (
        <div className="warn-banner" role="alert">{issues.name || issues.email || issues.phone || issues.identifier}</div>
      )}
      <Field label="Role">
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
      </Field>
      <p className="muted small">An administrator signs in on the same screen as a farmer: with the email address or the phone number recorded here.</p>
      <p className="muted small">Don't make every administrator a super admin — assign the least privilege that fits the job.</p>
      <div className="btn-row"><Btn variant="primary" onClick={save}>Create</Btn><Btn onClick={onClose}>Cancel</Btn></div>
    </Modal>
  );
}

/**
 * A console account's own details, after it was created.
 *
 * The point of this form is the phone number. A console account could only ever
 * sign in with its email address, because nothing anywhere could give it a
 * number - while the sign-in screen offers "Email or phone number" and every
 * farmer signs in either way. Whoever holds the account types their own number
 * here; nothing invents one for them, because a phone number IS a way in.
 */
function EditAdminModal({ account, accounts, dispatch, onClose }) {
  const [form, setForm] = useState({
    name: account.name || '',
    email: account.email || '',
    phone: account.phone || '',
  });
  const [tried, setTried] = useState(false);
  const issues = farmerDetailIssues({ patch: form, farmers: accounts, selfId: account.id });
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const save = () => {
    setTried(true);
    if (Object.keys(issues).length) return; // nothing is written until the details are usable
    dispatch({
      type: 'UPDATE_ADMIN',
      id: account.id,
      patch: { name: form.name.trim(), email: form.email.trim().toLowerCase(), phone: form.phone.trim() },
    });
    dispatch({ type: 'TOAST', msg: `${form.name.trim()} — account updated.` });
    onClose();
  };

  return (
    <Modal title={`Edit ${account.name}`} onClose={onClose}>
      <Field label="Full name"><input value={form.name} onChange={set('name')} /></Field>
      {tried && issues.name && <div className="warn-banner" role="alert">{issues.name}</div>}
      <div className="grid cols-2" style={{ gap: 10 }}>
        <Field label="Email"><input value={form.email} onChange={set('email')} /></Field>
        <Field label="Phone"><input value={form.phone} onChange={set('phone')} placeholder="0788 123 456" /></Field>
      </div>
      {tried && (issues.email || issues.phone || issues.identifier) && (
        <div className="warn-banner" role="alert">{issues.email || issues.phone || issues.identifier}</div>
      )}
      <p className="muted small">This account signs in with either of these — leave the phone empty to keep it email-only. The number is a way into the console, so it has to be yours.</p>
      <div className="btn-row">
        <Btn variant="primary" onClick={save}>Save details</Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </div>
    </Modal>
  );
}
