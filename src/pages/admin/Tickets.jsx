import React, { useMemo, useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { Badge, Btn, Card, Field, Modal, Tabs } from '../../components/ui.jsx';
import { fmtDateTime } from '../../lib/time.js';
import { t } from '../../i18n/strings.js';

const STATUSES = ['new', 'open', 'in-progress', 'resolved', 'closed'];

export default function AdminTickets() {
  const { state, dispatch } = useStore();
  const lang = state.lang || 'en';
  const [filter, setFilter] = useState('open');
  const [sel, setSel] = useState(null);
  const farmers = useMemo(() => Object.fromEntries(state.farmers.map((f) => [f.id, f.name])), [state.farmers]);
  const admins = useMemo(() => Object.fromEntries(state.admins.map((a) => [a.id, a.name])), [state.admins]);

  const tickets = state.tickets.filter((tk) => filter === 'all' ? true : STATUSES.includes(filter) ? tk.status === filter : true);
  const counts = (s) => state.tickets.filter((tk) => tk.status === s).length;

  return (
    <div>
      <h1>{t('nav.tickets', lang)}</h1>
      <Tabs
        tabs={[
          { key: 'open', label: `Open (${counts('new') + counts('open') + counts('in-progress')})` },
          { key: 'all', label: 'All' },
          { key: 'resolved', label: `Resolved (${counts('resolved')})` },
          { key: 'closed', label: `Closed (${counts('closed')})` },
        ]}
        active={filter} onChange={setFilter}
      />

      <div className="grid cols-2" style={{ marginTop: 10 }}>
        {tickets.length === 0 && <div className="muted">No tickets in this view.</div>}
        {tickets.map((tk) => (
          <Card key={tk.id} title={`${tk.id} — ${tk.category}`}>
            <div style={{ fontWeight: 700 }}>{tk.subject}</div>
            <div className="muted small">{farmers[tk.farmerId] || '—'} · {fmtDateTime(tk.createdAt)} · {tk.messages.length} msg</div>
            <div className="row" style={{ margin: '8px 0' }}>
              <Badge tone={{ new: 'info', open: 'warn', 'in-progress': 'warn', resolved: 'ok', closed: 'off' }[tk.status] || 'info'}>{tk.status}</Badge>
              <span className="muted small">assigned: {admins[tk.assignee] || 'unassigned'}</span>
            </div>
            <Btn small variant="primary" onClick={() => setSel(tk)}>Open ticket</Btn>
          </Card>
        ))}
      </div>

      {sel && (
        <Modal title={`${sel.id} — ${sel.subject}`} onClose={() => setSel(null)} width="560px">
          <div className="muted small">{farmers[sel.farmerId]} · {sel.category} · created {fmtDateTime(sel.createdAt)}</div>
          {sel.messages.map((m, i) => (
            <div key={i} className="alert-line" style={{ marginTop: 8 }}>
              <b className="small">{m.author}</b>
              <div>
                <div>{m.text}</div>
                <div className="muted small">{fmtDateTime(m.at)}</div>
              </div>
            </div>
          ))}
          <div className="row" style={{ margin: '12px 0' }}>
            <Field label="Status">
              <select value={sel.status} onChange={(e) => { dispatch({ type: 'UPDATE_TICKET', id: sel.id, patch: { status: e.target.value } }); setSel({ ...sel, status: e.target.value }); }}>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Assign to">
              <select value={sel.assignee || ''} onChange={(e) => { dispatch({ type: 'UPDATE_TICKET', id: sel.id, patch: { assignee: e.target.value } }); setSel({ ...sel, assignee: e.target.value }); }}>
                <option value="">Unassigned</option>
                {state.admins.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.role})</option>)}
              </select>
            </Field>
          </div>
          <ReplyBox id={sel.id} dispatch={dispatch} />
        </Modal>
      )}
    </div>
  );
}

function ReplyBox({ id, dispatch }) {
  const { state } = useStore();
  const [text, setText] = useState('');
  const send = () => {
    if (!text.trim()) return;
    dispatch({ type: 'TICKET_MESSAGE', id, author: state.session.name, text });
    setText('');
  };
  return (
    <div>
      <Field label="Reply as Afriinnox"><input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Type a reply…" /></Field>
      <Btn small variant="primary" onClick={send}>Send reply</Btn>
    </div>
  );
}
