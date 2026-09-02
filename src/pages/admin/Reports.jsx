import React, { useMemo, useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { subscriptionState, deviceStatus, batchDay } from '../../lib/services.js';
import { Badge, Btn, Card, DataTable, downloadCsv, Tabs } from '../../components/ui.jsx';
import { Icon } from '../../components/icons.jsx';
import { BarChart } from '../../components/charts.jsx';
import { fmtDate, fmtDateTime } from '../../lib/time.js';
import { fmtMoney, t } from '../../i18n/strings.js';

export default function AdminReports() {
  const { state } = useStore();
  const lang = state.lang || 'en';
  const now = new Date().toISOString();
  const [tab, setTab] = useState('devices');
  const farmers = useMemo(() => Object.fromEntries(state.farmers.map((f) => [f.id, f.name])), [state.farmers]);

  const deviceRows = state.devices.map((d) => ({
    Serial: d.serial, Name: d.name, Farmer: farmers[d.farmerId] || '—', District: d.location?.district || '—',
    Status: deviceStatus(d, now), Firmware: d.firmware, Installed: fmtDate(d.installedAt),
  }));
  const farmerRows = state.farmers.map((f) => ({
    Name: f.name, Phone: f.phone, Email: f.email, District: f.district, Status: f.status, Systems: state.devices.filter((d) => d.farmerId === f.id).length,
  }));
  const subRows = state.devices.filter((d) => d.subscription).map((d) => ({
    System: d.serial, Farmer: farmers[d.farmerId] || '—',
    Plan: state.plans.find((p) => p.id === d.subscription.planId)?.name || '—',
    Status: subscriptionState(d.subscription.endDate, now), Expires: fmtDate(d.subscription.endDate),
  }));
  const finRows = state.payments.map((p) => ({
    Date: fmtDateTime(p.createdAt), System: p.deviceId, Farmer: farmers[p.farmerId] || '—',
    Amount: p.amount, Status: p.status,
  }));
  const batchRows = state.devices.filter((d) => d.batch).map((d) => ({
    System: d.serial, Animal: d.batch.animal, Day: `${batchDay(d.batch.startDate, d.batch.durationDays, now)}/${d.batch.durationDays}`,
    Count: d.batch.count, Started: fmtDate(d.batch.startDate), Status: d.batch.status,
  }));

  const revByMonth = useMemo(() => {
    const out = [];
    const nowD = new Date();
    for (let m = 5; m >= 0; m--) {
      const d = new Date(nowD.getFullYear(), nowD.getMonth() - m, 1);
      const nxt = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const v = state.payments.filter((p) => p.status === 'successful' && new Date(p.confirmedAt || p.createdAt) >= d && new Date(p.confirmedAt || p.createdAt) < nxt).reduce((a, p) => a + p.amount, 0);
      out.push({ label: d.toLocaleDateString('en', { month: 'short' }), value: Math.round(v / 1000) });
    }
    return out;
  }, [state.payments]);

  const totals = {
    devices: state.devices.length,
    activeDevices: state.devices.filter((d) => deviceStatus(d, now) === 'online').length,
    farmers: state.farmers.length,
    activeFarmers: state.farmers.filter((f) => f.status === 'active').length,
    activeSubs: state.devices.filter((d) => d.subscription?.status === 'active' && subscriptionState(d.subscription.endDate, now) === 'active').length,
    expiredSubs: state.devices.filter((d) => d.subscription?.status === 'active' && subscriptionState(d.subscription.endDate, now) !== 'active').length,
    revenue: state.payments.filter((p) => p.status === 'successful').reduce((a, p) => a + p.amount, 0),
  };

  const views = {
    devices: <DataTable columns={[{ key: 'Serial', label: 'Serial' }, { key: 'Name', label: 'Name' }, { key: 'Farmer', label: 'Farmer' }, { key: 'District', label: 'District' }, { key: 'Status', label: 'Status', render: (r) => <Badge tone={r.Status === 'online' ? 'ok' : r.Status === 'locked' ? 'off' : 'warn'}>{r.Status}</Badge> }, { key: 'Firmware', label: 'Firmware' }]} rows={deviceRows} />,
    farmers: <DataTable columns={[{ key: 'Name', label: 'Name' }, { key: 'Phone', label: 'Phone' }, { key: 'Email', label: 'Email' }, { key: 'District', label: 'District' }, { key: 'Status', label: 'Status' }, { key: 'Systems', label: 'Systems' }]} rows={farmerRows} />,
    subscriptions: <DataTable columns={[{ key: 'System', label: 'System' }, { key: 'Farmer', label: 'Farmer' }, { key: 'Plan', label: 'Plan' }, { key: 'Status', label: 'Status', render: (r) => <Badge tone={r.Status === 'active' ? 'ok' : 'crit'}>{r.Status}</Badge> }, { key: 'Expires', label: 'Expires' }]} rows={subRows} />,
    financial: <DataTable columns={[{ key: 'Date', label: 'Date' }, { key: 'System', label: 'System' }, { key: 'Farmer', label: 'Farmer' }, { key: 'Amount', label: 'Amount', render: (r) => fmtMoney(r.Amount) }, { key: 'Status', label: 'Status', render: (r) => <Badge tone={r.Status === 'successful' ? 'ok' : r.Status === 'pending' ? 'warn' : 'crit'}>{r.Status}</Badge> }]} rows={finRows} />,
    batches: <DataTable columns={[{ key: 'System', label: 'System' }, { key: 'Animal', label: 'Animal' }, { key: 'Day', label: 'Day' }, { key: 'Count', label: 'Animals' }, { key: 'Started', label: 'Started' }, { key: 'Status', label: 'Status' }]} rows={batchRows} />,
  };

  return (
    <div>
      <h1>{t('nav.reports', lang)}</h1>
      <Tabs
        tabs={[
          { key: 'devices', label: `Devices (${totals.devices})` },
          { key: 'farmers', label: `Farmers (${totals.farmers})` },
          { key: 'subscriptions', label: `Subscriptions (${totals.activeSubs} active)` },
          { key: 'financial', label: `Financial (${fmtMoney(totals.revenue)})` },
          { key: 'batches', label: 'Batches' },
        ]}
        active={tab} onChange={setTab}
      />

      <div className="grid cols-3" style={{ margin: '14px 0' }}>
        <Card title="Active / online devices"><div className="big">{totals.activeDevices}/{totals.devices}</div><div className="muted small">online right now</div></Card>
        <Card title="Active farmers"><div className="big">{totals.activeFarmers}/{totals.farmers}</div><div className="muted small">registered</div></Card>
        <Card title="Subscriptions"><div className="big">{totals.activeSubs}</div><div className="muted small">{totals.expiredSubs} expired</div></Card>
      </div>

      <Card title="Revenue by month (RWF ’000)">
        <BarChart data={revByMonth} />
      </Card>

      <div className="row-between" style={{ margin: '14px 0' }}>
        <h3 style={{ margin: 0 }}>Details</h3>
        <Btn small onClick={() => downloadCsv(`broodiinnox-${tab}.csv`, tab === 'devices' ? deviceRows : tab === 'farmers' ? farmerRows : tab === 'subscriptions' ? subRows : tab === 'financial' ? finRows : batchRows)}><Icon name="download" size={15} /> Export CSV</Btn>
      </div>
      {views[tab]}
    </div>
  );
}
