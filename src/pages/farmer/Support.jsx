import React, { useMemo, useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { Badge, Btn, Card, EmptyState, Field, Modal, Tabs } from '../../components/ui.jsx';
import { Icon } from '../../components/icons.jsx';
import { fmtDateTime } from '../../lib/time.js';
import { t } from '../../i18n/strings.js';

const CATEGORIES = ['Technical problem', 'Sensor problem', 'Payment problem', 'Subscription problem', 'Device offline', 'General inquiry'];

export default function FarmerSupport() {
  const { state, dispatch } = useStore();
  const lang = state.lang || 'en';
  const [tab, setTab] = useState('tickets');
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(null);
  const myTickets = useMemo(() => state.tickets.filter((tk) => tk.farmerId === state.session.id), [state.tickets, state.session.id]);

  return (
    <div>
      <div className="row-between">
        <h1>{t('nav.support', lang)}</h1>
        <Btn variant="primary" onClick={() => setOpen(true)}>+ New support request</Btn>
      </div>
      <p className="muted">Report technical problems, faulty sensors or device issues. Each request generates a ticket.</p>

      <Tabs tabs={[{ key: 'tickets', label: `My tickets (${myTickets.length})` }, { key: 'info', label: 'How to reach us' }]} active={tab} onChange={setTab} />

      {tab === 'tickets' && (
        myTickets.length === 0 ? <EmptyState icon="ticket" text="No tickets yet." /> : (
          <div className="grid cols-2">
            {myTickets.map((tk) => (
              <Card key={tk.id} title={`Ticket ${tk.id}`}>
                <div style={{ fontWeight: 700 }}>{tk.subject}</div>
                <div className="row" style={{ margin: '8px 0' }}>
                  <Badge tone={{ new: 'info', open: 'warn', 'in-progress': 'warn', resolved: 'ok', closed: 'off' }[tk.status] || 'info'}>{tk.status}</Badge>
                  <span className="muted small">{tk.category}</span>
                </div>
                <div className="muted small">{fmtDateTime(tk.createdAt)} · {tk.messages.length} message(s)</div>
                <div style={{ marginTop: 8 }}><Btn small onClick={() => setView(tk)}>View & reply</Btn></div>
              </Card>
            ))}
          </div>
        )
      )}

      {tab === 'info' && (
        <div className="grid cols-2">
          <Card title="Contact Afriinnox">
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Icon name="phone" size={16} /> +250 788 123 456</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 6 }}><Icon name="mail" size={16} /> support@afriinnox.com</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 6 }}><Icon name="pin" size={16} /> KN 112 St, Kigali, Rwanda</div>
            <div className="muted small" style={{ marginTop: 8 }}>For locked devices or subscription issues, renew in the Subscriptions tab — the device unlocks automatically after MoMo confirmation.</div>
          </Card>
          <Card title="Emergency">
            <div style={{ fontWeight: 700, color: 'var(--crit)' }}>Failsafe heating is automatic.</div>
            <p className="muted small">If all sensors fail the heater stays ON and the buzzer sounds — the brood is never left cold. For immediate help, call the number above (available 24/7 for critical alerts).</p>
          </Card>
        </div>
      )}

      {open && (
        <Modal title="New support request" onClose={() => setOpen(false)}>
          <NewTicketForm dispatch={dispatch} onDone={() => setOpen(false)} />
        </Modal>
      )}

      {view && (
        <Modal title={`Ticket ${view.id}`} onClose={() => setView(null)}>
          <div className="muted small">{view.category} · status <Badge tone="warn">{view.status}</Badge></div>
          {view.messages.map((m, i) => (
            <div key={i} className="alert-line" style={{ marginTop: 8 }}>
              <b className="small">{m.author}</b>
              <div>
                <div>{m.text}</div>
                <div className="muted small">{fmtDateTime(m.at)}</div>
              </div>
            </div>
          ))}
          <ReplyBox id={view.id} dispatch={dispatch} />
        </Modal>
      )}
    </div>
  );
}

function NewTicketForm({ dispatch, onDone }) {
  const { state } = useStore();
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [text, setText] = useState('');
  const submit = () => {
    if (!subject.trim() || !text.trim()) return;
    dispatch({ type: 'ADD_TICKET', ticket: { farmerId: state.session.id, subject, category, messages: [{ author: state.session.name, at: new Date().toISOString(), text }] } });
    dispatch({ type: 'TOAST', msg: `Ticket created — we'll get back to you soon.` });
    onDone();
  };
  return (
    <>
      <Field label="Subject"><input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Sensor 2 showing abnormal temperature" /></Field>
      <Field label="Category"><select value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
      <Field label="Describe the problem"><textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="What happened? Which system? Since when?" /></Field>
      <div className="btn-row"><Btn variant="primary" onClick={submit}>Submit ticket</Btn><Btn onClick={onDone}>Cancel</Btn></div>
    </>
  );
}

function ReplyBox({ id, dispatch }) {
  const [text, setText] = useState('');
  const { state } = useStore();
  const send = () => {
    if (!text.trim()) return;
    dispatch({ type: 'TICKET_MESSAGE', id, author: state.session.name, text });
    setText('');
  };
  return (
    <div style={{ marginTop: 12 }}>
      <Field label="Reply"><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message…" onKeyDown={(e) => e.key === 'Enter' && send()} /></Field>
      <Btn small variant="primary" onClick={send}>Send</Btn>
    </div>
  );
}
