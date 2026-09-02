import React, { useMemo, useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { Badge, Btn, downloadCsv, DataTable, Tabs } from '../../components/ui.jsx';
import { fmtDateTime } from '../../lib/time.js';
import { Icon } from '../../components/icons.jsx';
import { t } from '../../i18n/strings.js';

export default function AdminAudit() {
  const { state } = useStore();
  const lang = state.lang || 'en';
  const [roleF, setRoleF] = useState('all');
  const [actionF, setActionF] = useState('all');
  const roles = useMemo(() => [...new Set(state.audit.map((a) => a.role))], [state.audit]);
  const actions = useMemo(() => [...new Set(state.audit.map((a) => a.action))], [state.audit]);
  const rows = state.audit.filter((a) => (roleF === 'all' || a.role === roleF) && (actionF === 'all' || a.action === actionF));

  return (
    <div>
      <div className="row-between">
        <h1>{t('nav.audit', lang)} <span className="pill">{state.audit.length}</span></h1>
        <Btn small onClick={() => downloadCsv('broodiinnox-audit.csv', rows.map((a) => ({ User: a.user, Role: a.role, Action: a.action, Details: a.details, Date: fmtDateTime(a.at) })))}><Icon name="download" size={15} /> Export CSV</Btn>
      </div>
      <p className="muted">Every important action is recorded — who, what, when, and the before/after values.</p>
      <div className="row" style={{ margin: '10px 0' }}>
        <select className="field" style={{ width: 'auto', marginBottom: 0 }} value={roleF} onChange={(e) => setRoleF(e.target.value)}>
          <option value="all">All roles</option>
          {roles.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className="field" style={{ width: 'auto', marginBottom: 0 }} value={actionF} onChange={(e) => setActionF(e.target.value)}>
          <option value="all">All actions</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      <DataTable
        columns={[
          { key: 'at', label: 'When', render: (r) => fmtDateTime(r.at) },
          { key: 'user', label: 'User', render: (r) => <div><b>{r.user}</b><div className="muted small">{r.role}</div></div> },
          { key: 'action', label: 'Action', render: (r) => <Badge tone="info">{r.action}</Badge> },
          { key: 'details', label: 'Details', render: (r) => <div style={{ maxWidth: 360 }}>{r.details}</div> },
          { key: 'prevNext', label: 'Before → After', render: (r) => {
            const fmt = (v) => v ? JSON.stringify(v) : '—';
            return <span className="muted small">{fmt(r.prev)} → {fmt(r.next)}</span>;
          } },
        ]}
        rows={rows.map((a) => ({ ...a, _key: a.id }))}
      />
    </div>
  );
}
