import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store.jsx';
import { avgTemp, batchDay, batchRemaining, deviceLocked, deviceStatus, stepDownTargets } from '../lib/services.js';
import { ANIMALS } from '../lib/presets.js';
import { fmtDate, timeAgo } from '../lib/time.js';
import { StatusBadge } from './ui.jsx';
import { Icon } from './icons.jsx';

export function SystemCard({ device, lang }) {
  const { state } = useStore();
  const navigate = useNavigate();
  const now = new Date().toISOString();
  const avg = avgTemp(device.sensors);
  const day = device.batch ? batchDay(device.batch.startDate, device.batch.durationDays, now) : null;
  const { min, max } = stepDownTargets(device.baseMin, device.baseMax, day || 1);
  const status = deviceStatus(device, now);
  const locked = deviceLocked(device, now);
  const sub = device.subscription;
  const farmer = state.farmers.find((f) => f.id === device.farmerId);

  return (
    <div className="card" style={{ cursor: 'pointer' }} onClick={() => navigate(`/${state.session?.role === 'admin' ? 'admin' : 'farmer'}/systems/${device.id}`)}>
      <div className="row-between">
        <div>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Broodiinnox — {device.name}</div>
          <div className="muted small">{device.serial} · {farmer?.district || 'Unassigned'}</div>
        </div>
        <StatusBadge status={status} label={status} />
      </div>

      <div className="grid cols-2" style={{ marginTop: 12, gap: 8 }}>
        <div>
          <div className="muted small">Animal / Batch</div>
          <div style={{ fontWeight: 700 }}>
            {device.batch ? `${ANIMALS[device.batch.animal]?.label || device.batch.animal} · Day ${day}/${device.batch.durationDays}` : 'No active batch'}
          </div>
          {device.batch && (
            <div className="muted small">{batchRemaining(device.batch.startDate, device.batch.durationDays, now)} days remaining</div>
          )}
        </div>
        <div>
          <div className="muted small">Temperature</div>
          <div style={{ fontWeight: 800, fontSize: 17 }}>
            {avg === null ? '—' : `${avg.toFixed(1)}°C`}
            <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}> / target {min}–{max}°C</span>
          </div>
        </div>
        <div>
          <div className="muted small">Heater</div>
          <div style={{ fontWeight: 700 }}>{device.heaterOn ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="flame" size={14} /> ON</span> : 'OFF'}</div>
        </div>
        <div>
          <div className="muted small">Subscription</div>
          {sub?.status === 'active' && !locked ? (
            <div style={{ color: 'var(--ok)', fontWeight: 700 }}>Active · expires {fmtDate(sub.endDate)}</div>
          ) : (
            <div style={{ color: 'var(--crit)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="lock" size={13} /> Locked</div>
          )}
        </div>
      </div>

      <div className="row-between" style={{ marginTop: 12 }}>
        <span className={`chip ${status === 'online' ? '' : ''}`}>
          <span className="status-dot ok" style={{ opacity: status === 'online' ? 1 : 0.25 }} />
          {status === 'online' ? `${lang === 'fr' ? 'Mis à jour' : 'Updated'} ${timeAgo(device.lastSeen)} ${lang === 'fr' ? 'il y a' : 'ago'}` : `Last seen ${timeAgo(device.lastSeen)} ago`}
        </span>
        <span className="btn small primary">{lang === 'fr' ? 'Ouvrir' : lang === 'rw' ? 'Fungura' : 'Open'} <Icon name="chevronRight" size={14} /></span>
      </div>
    </div>
  );
}
