import React, { useMemo } from 'react';
import { useStore } from '../../lib/store.jsx';
import { avgTemp, deviceStatus, batchDay } from '../../lib/services.js';
import { ANIMALS } from '../../lib/presets.js';
import { Card, StatusBadge } from '../../components/ui.jsx';
import { Icon } from '../../components/icons.jsx';
import { timeAgo } from '../../lib/time.js';
import { t } from '../../i18n/strings.js';

/** Live monitoring — every system's telemetry, refreshed by the store ticker. */
export default function AdminLive() {
  const { state } = useStore();
  const lang = state.lang || 'en';
  const now = new Date().toISOString();
  const farmers = useMemo(() => Object.fromEntries(state.farmers.map((f) => [f.id, f.name])), [state.farmers]);

  return (
    <div>
      <h1>{t('nav.live', lang)} <span className="chip" style={{ color: 'var(--ok)' }}><Icon name="pulse" size={15} /> LIVE</span></h1>
      <p className="muted">Real-time telemetry from every Broodiinnox system. Data refreshes every 5 seconds.</p>
      <div className="grid cols-3" style={{ marginTop: 14 }}>
        {state.devices.map((d) => {
          const avg = avgTemp(d.sensors);
          const day = d.batch ? batchDay(d.batch.startDate, d.batch.durationDays, now) : null;
          const status = deviceStatus(d, now);
          return (
            <Card key={d.id} title={`${d.serial} — ${d.name}`}>
              <div className="row-between">
                <StatusBadge status={status} />
                <span className="muted small">{status === 'online' ? `updated ${timeAgo(d.lastSeen, now)} ago` : `last seen ${timeAgo(d.lastSeen, now)} ago`}</span>
              </div>
              <div className="row" style={{ margin: '10px 0', gap: 20 }}>
                <div>
                  <div className="muted small">Temp</div>
                  <div className="big" style={{ color: 'var(--brand-blue)' }}>{avg === null ? '—' : `${avg.toFixed(1)}°C`}</div>
                </div>
                <div>
                  <div className="muted small">Heater</div>
                  <div style={{ fontWeight: 800 }}>{d.heaterOn ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="flame" size={16} /> ON</span> : 'OFF'}</div>
                </div>
                <div>
                  <div className="muted small">Batch</div>
                  <div style={{ fontWeight: 700 }}>{d.batch ? `${ANIMALS[d.batch.animal]?.label} · D${day}` : '—'}</div>
                </div>
              </div>
              <div className="muted small">Farmer: {farmers[d.farmerId] || 'unassigned'} · {d.location?.district}</div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
