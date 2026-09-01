import React, { useMemo, useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { Btn, Card, EmptyState, Field } from '../../components/ui.jsx';
import { fmtDateTime } from '../../lib/time.js';
import { t } from '../../i18n/strings.js';

export default function FarmerNotifications() {
  const { state, dispatch } = useStore();
  const lang = state.lang || 'en';
  const mine = useMemo(() => state.notifications.filter((n) => n.farmerId === state.session.id), [state.notifications, state.session.id]);
  const me = state.farmers.find((f) => f.id === state.session.id);
  const prefs = me?.notifPrefs || { email: true, whatsapp: true, sms: false, critical: true, reminders: true };
  const [saved, setSaved] = useState(false);

  const setPref = (key, val) => {
    dispatch({ type: 'UPDATE_FARMER', id: me.id, patch: { notifPrefs: { ...prefs, [key]: val } } });
  };

  return (
    <div>
      <div className="row-between">
        <h1>{t('nav.notifications', lang)}</h1>
        <Btn small onClick={() => dispatch({ type: 'MARK_ALL_NOTIF_READ' })}>Mark all read</Btn>
      </div>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <Card title="Notifications">
          {mine.length === 0 ? <EmptyState icon="📨" text="No notifications." /> : mine.slice(0, 20).map((n) => (
            <div key={n.id} className="alert-line" style={{ opacity: n.read ? 0.6 : 1, cursor: 'pointer' }} onClick={() => dispatch({ type: 'MARK_NOTIF_READ', id: n.id })}>
              <span>{n.severity === 'critical' ? '🔴' : n.severity === 'warning' ? '🟠' : '🔵'}</span>
              <div>
                <div style={{ fontWeight: 700 }}>{n.title}</div>
                <div className="muted small">{n.body}</div>
                <div className="muted small">{fmtDateTime(n.at)}</div>
              </div>
            </div>
          ))}
        </Card>

        <Card title="Notification preferences">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[['email', 'Email notifications'], ['whatsapp', 'WhatsApp notifications'], ['sms', 'SMS notifications'], ['critical', 'Critical alerts (always recommended)'], ['reminders', 'Subscription reminders']].map(([k, label]) => (
              <label key={k} className="row" style={{ justifyContent: 'space-between', cursor: 'pointer' }}>
                <span>{label}</span>
                <input type="checkbox" checked={prefs[k]} onChange={(e) => setPref(k, e.target.checked)} />
              </label>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <Btn small variant="green" onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 2000); }}>
              {saved ? 'Saved ✓' : 'Save preferences'}
            </Btn>
          </div>
        </Card>
      </div>
    </div>
  );
}
