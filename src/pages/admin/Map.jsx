import React, { useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { avgTemp, deviceStatus } from '../../lib/services.js';
import { Card, Modal, StatusBadge } from '../../components/ui.jsx';
import { fmtDate, timeAgo } from '../../lib/time.js';
import { t } from '../../i18n/strings.js';

const W = 640;
const H = 420;
const LON0 = 28.7, LON1 = 31.0, LAT0 = -2.9, LAT1 = -1.0;
const xOf = (lng) => ((lng - LON0) / (LON1 - LON0)) * W;
const yOf = (lat) => (1 - (lat - LAT0) / (LAT1 - LAT0)) * H;
const COLORS = { online: '#2e7d32', offline: '#6b7280', warning: '#b26a00', critical: '#c62828', locked: '#16181f' };
const STATUS_LABEL = { online: 'Online', offline: 'Offline', warning: 'Attention', critical: 'Critical', locked: 'Locked' };

/** Map view — every Broodiinnox system positioned by registered GPS coordinates. */
export default function AdminMap() {
  const { state } = useStore();
  const lang = state.lang || 'en';
  const now = new Date().toISOString();
  const [sel, setSel] = useState(null);
  const farmers = Object.fromEntries(state.farmers.map((f) => [f.id, f.name]));

  return (
    <div>
      <h1>{t('nav.map', lang)}</h1>
      <p className="muted">All Broodiinnox systems across Rwanda. Click a pin for details.</p>
      <Card style={{ marginTop: 14 }}>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ background: 'linear-gradient(180deg,#e8ecf9, #e9efe4)', borderRadius: 12, display: 'block' }}>
          <text x={W / 2} y={24} textAnchor="middle" fontSize="16" fontWeight="800" fill="#1c3a96" opacity="0.7">RWANDA — Broodiinnox network</text>
          <g stroke="#1c3a96" strokeOpacity="0.12" strokeWidth="1">
            {[0.2, 0.4, 0.6, 0.8].map((f) => (
              <line key={`v${f}`} x1={f * W} y1={0} x2={f * W} y2={H} />
            ))}
            {[0.2, 0.4, 0.6, 0.8].map((f) => (
              <line key={`h${f}`} x1={0} y1={f * H} x2={W} y2={f * H} />
            ))}
          </g>
          {state.devices.map((d) => {
            const lat = d.location?.lat ?? -1.95;
            const lng = d.location?.lng ?? 30.06;
            const status = deviceStatus(d, now);
            return (
              <g key={d.id} onClick={() => setSel(d)} style={{ cursor: 'pointer' }}>
                <circle cx={xOf(lng)} cy={yOf(lat)} r="11" fill={COLORS[status]} opacity="0.25" />
                <circle cx={xOf(lng)} cy={yOf(lat)} r="5.5" fill={COLORS[status]} stroke="#fff" strokeWidth="1.5" />
                <text x={xOf(lng) + 9} y={yOf(lat) + 4} fontSize="10.5" fontWeight="700" fill="#16181f">{d.serial}</text>
              </g>
            );
          })}
        </svg>
        <div className="row" style={{ marginTop: 10, gap: 14 }}>
          {Object.entries(STATUS_LABEL).map(([k, label]) => (
            <span key={k} className="chip"><span className="status-dot" style={{ background: COLORS[k] }} />{label} ({state.devices.filter((d) => deviceStatus(d, now) === k).length})</span>
          ))}
        </div>
      </Card>

      {sel && (
        <Modal title={`${sel.serial} — ${sel.name}`} onClose={() => setSel(null)}>
          <StatusBadge status={deviceStatus(sel, now)} />
          <div className="muted small" style={{ marginTop: 8 }}>
            Farmer: {farmers[sel.farmerId] || 'unassigned'} · {sel.location?.district}, {sel.location?.sector}
          </div>
          <div className="row" style={{ margin: '10px 0', gap: 16 }}>
            <div><span className="muted small">Temp </span><b>{avgTemp(sel.sensors) === null ? '—' : `${avgTemp(sel.sensors).toFixed(1)}°C`}</b></div>
            <div><span className="muted small">Heater </span><b>{sel.heaterOn ? 'ON' : 'OFF'}</b></div>
            <div><span className="muted small">Last seen </span><b>{timeAgo(sel.lastSeen, now)} ago</b></div>
            <div><span className="muted small">Installed </span><b>{fmtDate(sel.installedAt)}</b></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
