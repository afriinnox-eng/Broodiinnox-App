import React, { useMemo, useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { Btn, DataTable, downloadCsv, SeverityBadge, Tabs } from '../../components/ui.jsx';
import { fmtDateTime } from '../../lib/time.js';
import { Icon } from '../../components/icons.jsx';
import { t } from '../../i18n/strings.js';

export default function AdminAlerts() {
  const { state, dispatch } = useStore();
  const lang = state.lang || 'en';
  const [filter, setFilter] = useState('all');
  const alerts = useMemo(() => {
    let list = state.alerts;
    if (filter !== 'all') list = list.filter((a) => a.severity === filter);
    return list;
  }, [state.alerts, filter]);

  return (
    <div>
      <div className="row-between">
        <h1>{t('nav.alerts', lang)} <span className="pill">{state.alerts.filter((a) => !a.read).length} unread</span></h1>
        <Btn small onClick={() => dispatch({ type: 'MARK_ALL_ALERTS_READ' })}>Mark all read</Btn>
      </div>
      <Tabs tabs={[{ key: 'all', label: 'All' }, { key: 'critical', label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="status-dot crit" />Critical</span> }, { key: 'warning', label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="status-dot warn" />Warning</span> }, { key: 'info', label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="status-dot info" />Info</span> }]} active={filter} onChange={setFilter} />
      <div className="row-between" style={{ margin: '10px 0' }}>
        <span className="muted small">{alerts.length} alert(s)</span>
        <Btn small onClick={() => downloadCsv('broodiinnox-alerts.csv', alerts.map((a) => ({ Device: a.deviceId, Severity: a.severity, Message: a.message, Date: fmtDateTime(a.at), Read: a.read })))}><Icon name="download" size={15} /> Export CSV</Btn>
      </div>
      <DataTable
        columns={[
          { key: 'severity', label: 'Severity', render: (r) => <SeverityBadge severity={r.severity} /> },
          { key: 'device', label: 'System', render: (r) => <b>{r.deviceId}</b> },
          { key: 'message', label: 'Message', render: (r) => <div style={{ maxWidth: 420 }}>{r.message}</div> },
          { key: 'at', label: 'When', render: (r) => fmtDateTime(r.at) },
          { key: 'read', label: 'Read', render: (r) => <Btn small onClick={() => dispatch({ type: 'MARK_ALERT_READ', id: r.id })}>{r.read ? <><Icon name="check" size={13} /> Read</> : 'Mark read'}</Btn> },
        ]}
        rows={alerts.map((a) => ({ ...a, _key: a.id }))}
      />
    </div>
  );
}
