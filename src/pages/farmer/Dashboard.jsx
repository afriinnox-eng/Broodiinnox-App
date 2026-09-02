import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../../lib/store.jsx';
import { SystemCard } from '../../components/SystemCard.jsx';
import { Card, Stat, SeverityBadge, EmptyState } from '../../components/ui.jsx';
import { Icon } from '../../components/icons.jsx';
import { deviceStatus, avgTemp, batchRemaining } from '../../lib/services.js';
import { fmtDateTime, timeAgo } from '../../lib/time.js';
import { t } from '../../i18n/strings.js';

export default function FarmerDashboard() {
  const { state } = useStore();
  const lang = state.lang || 'en';
  const me = state.session;
  const devices = useMemo(() => state.devices.filter((d) => d.farmerId === me.id), [state.devices, me.id]);
  const now = new Date().toISOString();
  const online = devices.filter((d) => deviceStatus(d, now) === 'online').length;
  const attention = devices.filter((d) => ['warning', 'critical', 'locked'].includes(deviceStatus(d, now))).length;
  const activeBatches = devices.filter((d) => d.batch && batchRemaining(d.batch.startDate, d.batch.durationDays, now) > 0).length;
  const avg = avgTemp(devices.flatMap((d) => d.sensors));
  const alerts = state.alerts.filter((a) => devices.some((d) => d.id === a.deviceId) && !a.read).slice(0, 6);

  return (
    <div>
      <h1>{t('nav.dashboard', lang)}, {me.name.split(' ')[0]}</h1>
      <p className="muted">Here is how your chicks are doing right now.</p>

      <div className="grid cols-4" style={{ margin: '16px 0' }}>
        <Stat icon="cpu" label="Systems" value={devices.length} />
        <Stat icon="wifi" label="Online" value={online} tone="ok" />
        <Stat icon="alert" label="Attention" value={attention} tone={attention ? 'crit' : undefined} />
        <Stat icon="egg" label="Active batches" value={activeBatches} tone="green" />
      </div>

      <div className="grid cols-2" style={{ marginBottom: 20 }}>
        <Card title="My systems">
          {devices.length === 0 && <EmptyState icon="cpu" text="No systems assigned yet. Contact Afriinnox." />}
          <div className="grid cols-2" style={{ gap: 12 }}>
            {devices.map((d) => <SystemCard key={d.id} device={d} lang={lang} />)}
          </div>
        </Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title="Recent alerts">
            {alerts.length === 0 && <div className="muted">All clear</div>}
            {alerts.map((a) => (
              <div key={a.id} className="alert-line">
                <SeverityBadge severity={a.severity} />
                <div>
                  <div style={{ fontWeight: 600 }}>{a.message}</div>
                  <div className="muted small">{fmtDateTime(a.at)}</div>
                </div>
              </div>
            ))}
            <Link to="/farmer/alerts" className="btn small" style={{ marginTop: 8 }}>View all alerts <Icon name="chevronRight" size={14} /></Link>
          </Card>
          <Card title="Quick actions">
            <div className="btn-row">
              <Link to="/farmer/batches" className="btn green small"><Icon name="egg" size={15} /> Start a batch</Link>
              <Link to="/farmer/subscriptions" className="btn primary small"><Icon name="card" size={15} /> Renew subscription</Link>
              <Link to="/farmer/support" className="btn small"><Icon name="help" size={15} /> Get support</Link>
              <Link to="/farmer/tips" className="btn small"><Icon name="book" size={15} /> Brooding tips</Link>
            </div>
          </Card>
        </div>
      </div>

      {avg !== null && (
        <Card title="Fleet average temperature">
          <div className="big" style={{ color: 'var(--brand-blue)' }}>{avg.toFixed(1)}°C</div>
          <div className="muted small">Average across all your online systems · updated {timeAgo(now)} ago</div>
        </Card>
      )}
    </div>
  );
}
