import React, { useMemo, useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { Badge, Btn, Card, DataTable, downloadCsv, Stat } from '../../components/ui.jsx';
import { fmtDateTime } from '../../lib/time.js';
import { fmtMoney, t } from '../../i18n/strings.js';

export default function AdminPayments() {
  const { state } = useStore();
  const lang = state.lang || 'en';
  const [statusF, setStatusF] = useState('all');
  const farmers = useMemo(() => Object.fromEntries(state.farmers.map((f) => [f.id, f.name])), [state.farmers]);
  const payments = useMemo(() => {
    let list = state.payments;
    if (statusF !== 'all') list = list.filter((p) => p.status === statusF);
    return list;
  }, [state.payments, statusF]);

  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(dayStart.getFullYear(), dayStart.getMonth(), 1);
  const rev = (from) => state.payments.filter((p) => p.status === 'successful' && new Date(p.confirmedAt || p.createdAt) >= from).reduce((a, p) => a + p.amount, 0);
  const successful = state.payments.filter((p) => p.status === 'successful');
  const pending = state.payments.filter((p) => p.status === 'pending').length;
  const failed = state.payments.filter((p) => p.status === 'failed').length;

  const exportRows = payments.map((p) => ({
    Date: fmtDateTime(p.createdAt), Farmer: farmers[p.farmerId] || p.farmerId, System: p.deviceId,
    Plan: state.plans.find((x) => x.id === p.planId)?.name || '', Amount: p.amount, Method: p.method,
    Status: p.status, 'Provider ref': p.providerRef || '', Phone: p.phone || '',
  }));

  return (
    <div>
      <h1>{t('nav.payments', lang)}</h1>
      <div className="grid cols-4" style={{ margin: '14px 0' }}>
        <Stat icon="💵" label="Revenue today" value={fmtMoney(rev(dayStart))} tone="green" />
        <Stat icon="📅" label="Revenue this month" value={fmtMoney(rev(monthStart))} tone="green" />
        <Stat icon="✅" label="Successful txs" value={successful.length} tone="ok" />
        <Stat icon="⏳" label="Pending / failed" value={`${pending} / ${failed}`} tone={pending ? 'warn' : undefined} />
      </div>

      <div className="row-between">
        <div className="row">
          <select className="field" style={{ width: 'auto', marginBottom: 0 }} value={statusF} onChange={(e) => setStatusF(e.target.value)}>
            <option value="all">All statuses</option>
            {['successful', 'pending', 'failed', 'cancelled', 'refunded'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <Btn small onClick={() => downloadCsv('broodiinnox-payments.csv', exportRows)}>⬇ Export CSV</Btn>
      </div>

      <div style={{ marginTop: 12 }}>
        <DataTable
          columns={[
            { key: 'date', label: 'Date', render: (r) => fmtDateTime(r.createdAt) },
            { key: 'farmer', label: 'Farmer', render: (r) => farmers[r.farmerId] || r.farmerId },
            { key: 'system', label: 'System', render: (r) => <b>{r.deviceId}</b> },
            { key: 'plan', label: 'Plan', render: (r) => state.plans.find((x) => x.id === r.planId)?.name || '—' },
            { key: 'amount', label: 'Amount', render: (r) => <b>{fmtMoney(r.amount)}</b> },
            { key: 'method', label: 'Method', render: (r) => `${r.method}${r.phone ? ` · ${r.phone}` : ''}` },
            { key: 'status', label: 'Status', render: (r) => <Badge tone={{ successful: 'ok', pending: 'warn', failed: 'crit', cancelled: 'off', refunded: 'off' }[r.status] || 'off'}>{r.status}</Badge> },
            { key: 'ref', label: 'Provider ref', render: (r) => <span className="muted small">{r.providerRef || '—'}</span> },
          ]}
          rows={payments.map((p) => ({ ...p, _key: p.id }))}
        />
      </div>
    </div>
  );
}
