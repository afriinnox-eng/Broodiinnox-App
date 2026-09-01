import React, { useMemo, useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { Btn, EmptyState, SeverityBadge, Tabs } from '../../components/ui.jsx';
import { fmtDateTime } from '../../lib/time.js';
import { t } from '../../i18n/strings.js';

export default function FarmerAlerts() {
  const { state, dispatch } = useStore();
  const lang = state.lang || 'en';
  const [filter, setFilter] = useState('all');
  const myDevices = useMemo(() => state.devices.filter((d) => d.farmerId === state.session.id).map((d) => d.id), [state.devices, state.session.id]);
  const alerts = state.alerts.filter((a) => myDevices.includes(a.deviceId));
  const shown = filter === 'all' ? alerts : alerts.filter((a) => a.severity === filter);
  const unread = alerts.filter((a) => !a.read).length;

  return (
    <div>
      <div className="row-between">
        <h1>{t('nav.alerts', lang)} <span className="pill">{unread} unread</span></h1>
        <Btn small onClick={() => dispatch({ type: 'MARK_ALL_ALERTS_READ' })}>Mark all read</Btn>
      </div>
      <Tabs
        tabs={[{ key: 'all', label: 'All' }, { key: 'critical', label: '🔴 Critical' }, { key: 'warning', label: '🟠 Warning' }, { key: 'info', label: '🔵 Info' }]}
        active={filter} onChange={setFilter}
      />
      {shown.length === 0 ? <EmptyState icon="🔔" text="No alerts here." /> :
        shown.map((a) => (
          <div key={a.id} className="alert-line" style={{ opacity: a.read ? 0.65 : 1 }}>
            <SeverityBadge severity={a.severity} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{a.message}</div>
              <div className="muted small">{a.deviceId} · {fmtDateTime(a.at)}</div>
            </div>
            {!a.read && <Btn small onClick={() => dispatch({ type: 'MARK_ALERT_READ', id: a.id })}>Mark read</Btn>}
          </div>
        ))}
    </div>
  );
}
