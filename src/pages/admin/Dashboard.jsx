import React, { useMemo } from 'react';
import { useStore } from '../../lib/store.jsx';
import { Card, Stat, SeverityBadge, Badge } from '../../components/ui.jsx';
import { Icon } from '../../components/icons.jsx';
import { Donut, BarChart } from '../../components/charts.jsx';
import { churnRisk, deviceStatus, subscriptionState, avgTemp } from '../../lib/services.js';
import { fmtMoney } from '../../i18n/strings.js';
import { t } from '../../i18n/strings.js';
import { fmtDateTime } from '../../lib/time.js';

export default function AdminDashboard() {
  const { state } = useStore();
  const lang = state.lang || 'en';
  const now = new Date().toISOString();
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(dayStart.getFullYear(), dayStart.getMonth(), 1);
  const yearStart = new Date(dayStart.getFullYear(), 0, 1);

  const devices = state.devices;
  const online = devices.filter((d) => deviceStatus(d, now) === 'online').length;
  const offline = devices.filter((d) => deviceStatus(d, now) === 'offline').length;
  const locked = devices.filter((d) => deviceStatus(d, now) === 'locked').length;
  const attention = devices.filter((d) => ['warning', 'critical'].includes(deviceStatus(d, now))).length;
  const activeBatches = devices.filter((d) => d.batch && d.batch.status === 'running').length;
  const expiredSubs = devices.filter((d) => d.subscription?.status === 'active' && subscriptionState(d.subscription.endDate, now) !== 'active').length;

  const revenue = (from) => state.payments.filter((p) => p.status === 'successful' && new Date(p.confirmedAt || p.createdAt) >= from).reduce((a, p) => a + p.amount, 0);
  const pendingPayments = state.payments.filter((p) => p.status === 'pending').length;
  const criticalAlerts = state.alerts.filter((a) => a.severity === 'critical' && !a.read).length;
  const openTickets = state.tickets.filter((tk) => ['new', 'open', 'in-progress'].includes(tk.status)).length;

  const statusSegments = [
    { label: 'Online', value: online, color: '#2e7d32' },
    { label: 'Offline', value: offline, color: '#6b7280' },
    { label: 'Attention', value: attention, color: '#b26a00' },
    { label: 'Locked', value: locked, color: '#16181f' },
  ];

  const revByMonth = useMemo(() => {
    const out = [];
    for (let m = 5; m >= 0; m--) {
      const d = new Date(yearStart.getFullYear(), monthStart.getMonth() - m, 1);
      const nxt = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const v = state.payments.filter((p) => p.status === 'successful' && new Date(p.confirmedAt || p.createdAt) >= d && new Date(p.confirmedAt || p.createdAt) < nxt).reduce((a, p) => a + p.amount, 0);
      out.push({ label: d.toLocaleDateString('en', { month: 'short' }), value: Math.round(v / 1000) });
    }
    return out;
  }, [state.payments]);

  const churn = state.farmers.map((f) => ({ farmer: f, risk: churnRisk(f.lastActiveBatchEnd, now) })).filter((c) => c.risk.level !== 'none');
  const avg = avgTemp(devices.flatMap((d) => d.sensors));

  return (
    <div>
      <h1>{t('nav.dashboard', lang)}</h1>
      <p className="muted">Complete overview of the Broodiinnox network.</p>

      <div className="grid cols-4" style={{ margin: '14px 0' }}>
        <Stat icon="users" label="Farmers" value={state.farmers.length} />
        <Stat icon="cpu" label="Systems" value={devices.length} />
        <Stat icon="wifi" label="Online" value={online} tone="ok" />
        <Stat icon="wifiOff" label="Offline" value={offline} />
      </div>
      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Stat icon="egg" label="Active batches" value={activeBatches} tone="green" />
        <Stat icon="lock" label="Expired subs" value={expiredSubs} tone="crit" />
        <Stat icon="wallet" label="Revenue today" value={fmtMoney(revenue(dayStart))} tone="green" />
        <Stat icon="calendar" label="Revenue this month" value={fmtMoney(revenue(monthStart))} tone="green" />
      </div>
      <div className="grid cols-4" style={{ marginBottom: 20 }}>
        <Stat icon="chart" label="Revenue this year" value={fmtMoney(revenue(yearStart))} />
        <Stat icon="clock" label="Pending payments" value={pendingPayments} tone="warn" />
        <Stat icon="alert" label="Critical alerts" value={criticalAlerts} tone={criticalAlerts ? 'crit' : undefined} />
        <Stat icon="ticket" label="Open tickets" value={openTickets} tone="warn" />
      </div>

      <div className="grid cols-2" style={{ marginBottom: 20 }}>
        <Card title="Device status">
          <Donut segments={statusSegments} label={devices.length} />
        </Card>
        <Card title="Revenue by month (RWF ’000)">
          <BarChart data={revByMonth} />
        </Card>
      </div>

      <div className="grid cols-2">
        <Card title="Churn risk — farmers needing follow-up">
          {churn.length === 0 && <div className="muted">No farmers need follow-up right now.</div>}
          {churn.map(({ farmer, risk }) => (
            <div key={farmer.id} className="row-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <b>{farmer.name}</b>
                <div className="muted small">{farmer.district} · last batch {risk.label} ago</div>
              </div>
              <Badge tone={risk.level === 'high' ? 'crit' : risk.level === 'medium' ? 'warn' : 'info'}>{risk.level}</Badge>
            </div>
          ))}
        </Card>
        <Card title="Recent activity (audit)">
          {state.audit.slice(0, 7).map((a) => (
            <div key={a.id} className="alert-line">
              <Icon name={a.role === 'farmer' ? 'users' : 'shield'} size={16} style={{ flex: 'none', marginTop: 2 }} />
              <div>
                <div className="small" style={{ fontWeight: 600 }}><b>{a.user}</b> — {a.details}</div>
                <div className="muted small">{fmtDateTime(a.at)}</div>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
