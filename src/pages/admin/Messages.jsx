import React, { useMemo, useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { subscriptionState } from '../../lib/services.js';
import { Badge, Btn, Card, DataTable, Field, Modal } from '../../components/ui.jsx';
import { fmtDateTime } from '../../lib/time.js';
import { t } from '../../i18n/strings.js';

const SEGMENTS = [
  { key: 'all', label: 'All farmers' },
  { key: 'active', label: 'Active farmers' },
  { key: 'inactive', label: 'Inactive farmers' },
  { key: 'expired', label: 'Farmers with expired subscriptions' },
  { key: 'expiring', label: 'Subscriptions expiring soon (≤7 days)' },
  { key: 'offline', label: 'Farmers with offline systems' },
  { key: 'kigali', label: 'Farmers in Kigali' },
];

export default function AdminMessages() {
  const { state, dispatch } = useStore();
  const lang = state.lang || 'en';
  const now = new Date().toISOString();
  const [segment, setSegment] = useState('all');
  const [text, setText] = useState('');
  const [channels, setChannels] = useState({ inapp: true, email: false, whatsapp: false, sms: false });
  const [compose, setCompose] = useState(false);

  const segmentCount = useMemo(() => {
    const farmers = state.farmers;
    const devices = state.devices;
    if (segment === 'all') return farmers.length;
    if (segment === 'active') return farmers.filter((f) => f.status === 'active').length;
    if (segment === 'inactive') return farmers.filter((f) => f.status === 'inactive').length;
    if (segment === 'expired') return devices.filter((d) => d.subscription?.status === 'active' && subscriptionState(d.subscription.endDate, now) !== 'active').length;
    if (segment === 'expiring') return devices.filter((d) => d.subscription?.status === 'active' && subscriptionState(d.subscription.endDate, now) === 'active' && Math.ceil((new Date(d.subscription.endDate) - new Date(now)) / 86400000) <= 7).length;
    if (segment === 'offline') return devices.filter((d) => d.lastSeen && (new Date(now) - new Date(d.lastSeen)) / 60000 > 15).length;
    if (segment === 'kigali') return farmers.filter((f) => f.district === 'Kigali').length;
    return 0;
  }, [segment, state, now]);

  const send = () => {
    if (!text.trim()) return;
    const ch = Object.entries(channels).filter(([, v]) => v).map(([k]) => k.toUpperCase()).join(' + ');
    dispatch({ type: 'SEND_MESSAGE', msg: { audience: SEGMENTS.find((s) => s.key === segment)?.label, text, channel: ch || 'In-app', recipients: segmentCount } });
    dispatch({ type: 'TOAST', msg: `Message sent to ${segmentCount} recipient(s).` });
    setText('');
    setCompose(false);
  };

  return (
    <div>
      <div className="row-between">
        <h1>{t('nav.messages', lang)}</h1>
        <Btn variant="primary" onClick={() => setCompose(true)}>+ Compose message</Btn>
      </div>
      <p className="muted">Send campaigns to farmer segments. Every message is recorded.</p>

      <h3 style={{ marginTop: 8 }}>Segments</h3>
      <div className="grid cols-3">
        {SEGMENTS.map((s) => {
          const count = s.key === segment ? segmentCount : 0;
          return (
            <button key={s.key} className="btn" style={{ justifyContent: 'space-between' }} onClick={() => setSegment(s.key)}>
              <span>{s.label}</span>
              <Badge tone="info">{count === 0 ? '…' : count}</Badge>
            </button>
          );
        })}
      </div>

      <h3 style={{ marginTop: 20 }}>Sent messages</h3>
      <DataTable
        columns={[
          { key: 'audience', label: 'Audience', render: (r) => <b>{r.audience}</b> },
          { key: 'text', label: 'Message', render: (r) => <div style={{ maxWidth: 420 }}>{r.text}</div> },
          { key: 'channel', label: 'Channel' },
          { key: 'recipients', label: 'Recipients' },
          { key: 'sentAt', label: 'Sent', render: (r) => fmtDateTime(r.sentAt) },
        ]}
        rows={state.messages.map((m) => ({ ...m, _key: m.id }))}
      />

      {compose && (
        <Modal title="Compose message" onClose={() => setCompose(false)}>
          <Field label="Segment">
            <select value={segment} onChange={(e) => setSegment(e.target.value)}>
              {SEGMENTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Message"><textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write your message…" /></Field>
          <div className="row" style={{ margin: '8px 0' }}>
            {Object.entries(channels).map(([k, v]) => (
              <label key={k} className="chip" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={v} onChange={(e) => setChannels({ ...channels, [k]: e.target.checked })} /> {k === 'inapp' ? 'In-app' : k.charAt(0).toUpperCase() + k.slice(1)}
              </label>
            ))}
          </div>
          <div className="btn-row"><Btn variant="primary" onClick={send}>Send to {segmentCount} recipient(s)</Btn><Btn onClick={() => setCompose(false)}>Cancel</Btn></div>
        </Modal>
      )}
    </div>
  );
}
