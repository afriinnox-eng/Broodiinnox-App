import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore } from '../../lib/store.jsx';
import {
  avgTemp, batchDay, batchRemaining, controlAllowed, deviceLocked, deviceStatus,
  maintenanceDue, stepDownTargets, subscriptionState,
} from '../../lib/services.js';
import { ANIMALS } from '../../lib/presets.js';
import { fmtDate, fmtDateTime, timeAgo } from '../../lib/time.js';
import { LineChart } from '../../components/charts.jsx';
import { Badge, Btn, Card, Field, Modal, Progress, StatusBadge } from '../../components/ui.jsx';
import { t } from '../../i18n/strings.js';

/** Deterministic pseudo-history so the chart is stable across re-renders. */
function historyFor(device) {
  const seed = [...device.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const avg = avgTemp(device.sensors) ?? 35;
  const out = [];
  for (let i = 47; i >= 0; i--) {
    const wob = Math.sin(i / 4 + seed) * 0.8 + ((Math.sin(i * 12.9898 + seed) * 43758.5453) % 1) * 0.5;
    out.push({ t: Date.now() - i * 1800000, v: Math.round((avg + wob) * 10) / 10 });
  }
  return out;
}

export default function FarmerSystemDetail() {
  const { id } = useParams();
  const { state, dispatch } = useStore();
  const lang = state.lang || 'en';
  const device = state.devices.find((d) => d.id === id && d.farmerId === state.session.id);
  const now = new Date().toISOString();

  const [minV, setMinV] = useState(device?.baseMin ?? 35);
  const [maxV, setMaxV] = useState(device?.baseMax ?? 37);
  const [confirm, setConfirm] = useState(null); // {type, label}
  const [startBatch, setStartBatch] = useState(false);

  const avg = avgTemp(device?.sensors);
  const day = device?.batch ? batchDay(device.batch.startDate, device.batch.durationDays, now) : 1;
  const { min, max } = stepDownTargets(device?.baseMin ?? 35, device?.baseMax ?? 37, day);
  const status = device ? deviceStatus(device, now) : null;
  const locked = device ? deviceLocked(device, now) : true;
  const canControl = device ? controlAllowed(device, now, avg) : false;
  const sub = device?.subscription;
  const preset = device?.batch ? ANIMALS[device.batch.animal] || null : null;
  const maint = state.maintenance.find((m) => m.deviceId === device?.id);
  const history = useMemo(() => (device ? historyFor(device) : []), [device]);
  const alerts = state.alerts.filter((a) => a.deviceId === device?.id).slice(0, 5);

  if (!device) return <div className="empty">System not found.</div>;

  const outsideRange = !!preset && (minV < preset.baseMin - 3 || maxV > preset.baseMax + 3);
  const saveTargets = () => {
    dispatch({ type: 'SET_TARGETS', deviceId: device.id, min: Number(minV), max: Number(maxV) });
    dispatch({ type: 'TOAST', msg: 'Temperature targets saved.' });
  };
  const doConfirm = () => {
    if (confirm.type === 'restart') dispatch({ type: 'RESTART_DEVICE', deviceId: device.id });
    if (confirm.type === 'sync') dispatch({ type: 'SYNC_TIME', deviceId: device.id });
    dispatch({ type: 'TOAST', msg: `${confirm.label} sent to ${device.name}.` });
    setConfirm(null);
  };
  const daysLeft = sub?.endDate ? Math.ceil((new Date(sub.endDate) - new Date(now)) / 86400000) : 0;

  return (
    <div>
      <div className="row-between">
        <div>
          <Link to="/farmer/systems" className="muted small">← My systems</Link>
          <h1 style={{ marginTop: 4 }}>Broodiinnox — {device.name}</h1>
          <div className="muted small">{device.serial} · firmware {device.firmware}</div>
        </div>
        <StatusBadge status={status} label={status} />
      </div>

      {locked && (
        <div className="warn-banner" style={{ margin: '12px 0' }}>
          <span>🔒</span>
          <div>
            <b>Device locked.</b> The subscription linked to this system has lapsed. Renew to unlock the heater,
            alarm and buttons. {avg !== null && avg < (device.safetyFloor || 20) && <span style={{ fontWeight: 800 }}>Temperature is below the safety floor — failsafe heating stays available.</span>}
            <div style={{ marginTop: 8 }}><Link className="btn primary small" to="/farmer/subscriptions">💳 Renew now</Link></div>
          </div>
        </div>
      )}

      {maint && maintenanceDue(maint, now) && maint.status !== 'completed' && (
        <div className="warn-banner" style={{ margin: '12px 0', background: 'var(--brand-blue-soft)', color: 'var(--brand-blue)' }}>
          <span>🔧</span>
          <div><b>Maintenance due.</b> Next service was due {fmtDate(maint.nextMaintenance)}. Afriinnox has been notified.</div>
        </div>
      )}

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title="Live temperature">
            <div className="row" style={{ gap: 22, marginBottom: 8 }}>
              <div>
                <div className="muted small">Current</div>
                <div className="big" style={{ color: avg < min - 1 ? 'var(--crit)' : avg > max + 1 ? 'var(--warn)' : 'var(--brand-green)' }}>
                  {avg === null ? '—' : `${avg.toFixed(1)}°C`}
                </div>
              </div>
              <div>
                <div className="muted small">Target range (day {day})</div>
                <div style={{ fontWeight: 800 }}>{min} – {max}°C</div>
              </div>
              <div>
                <div className="muted small">Heater</div>
                <div style={{ fontWeight: 800 }}>{device.heaterOn ? '🔥 ON' : 'OFF'}</div>
              </div>
              <div>
                <div className="muted small">Status</div>
                <div><Badge tone={status === 'online' ? 'ok' : 'warn'}>{status === 'online' ? `Live · updated ${timeAgo(device.lastSeen)} ago` : `Last seen ${timeAgo(device.lastSeen)} ago`}</Badge></div>
              </div>
            </div>
            <LineChart points={history} color="#1c3a96" />
          </Card>

          <Card title="Sensors">
            <div className="grid cols-2" style={{ gap: 8 }}>
              {device.sensors.map((s) => (
                <div key={s.id} className="row-between" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
                  <div>
                    <div className="small muted">Sensor {s.id}</div>
                    <b>{s.enabled && typeof s.lastReading === 'number' ? `${s.lastReading.toFixed(1)}°C` : '—'}</b>
                  </div>
                  <button className="btn small" disabled={locked} onClick={() => dispatch({ type: 'SET_SENSOR', deviceId: device.id, sensorId: s.id, enabled: !s.enabled })}>
                    {s.enabled ? 'ON' : 'OFF'}
                  </button>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Recent alerts for this system">
            {alerts.length === 0 && <div className="muted">No alerts.</div>}
            {alerts.map((a) => (
              <div key={a.id} className="alert-line">
                <span>{a.severity === 'critical' ? '🔴' : a.severity === 'warning' ? '🟠' : '🔵'}</span>
                <div>
                  <div style={{ fontWeight: 600 }}>{a.message}</div>
                  <div className="muted small">{fmtDateTime(a.at)}</div>
                </div>
              </div>
            ))}
          </Card>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title="Remote control">
            <div className="grid cols-2" style={{ gap: 10 }}>
              <Field label="Min temperature (°C)"><input type="number" value={minV} onChange={(e) => setMinV(e.target.value)} disabled={!canControl} /></Field>
              <Field label="Max temperature (°C)"><input type="number" value={maxV} onChange={(e) => setMaxV(e.target.value)} disabled={!canControl} /></Field>
            </div>
            {outsideRange && (
              <div className="warn-banner" style={{ marginBottom: 10 }}>
                ⚠️ The temperature you've entered is outside the recommended range for {preset.label.toLowerCase()} ({preset.baseMin}–{preset.baseMax}°C).
              </div>
            )}
            <Btn variant="primary" disabled={!canControl} onClick={saveTargets}>Save targets</Btn>
            <div className="row" style={{ marginTop: 12 }}>
              <Btn variant="danger" disabled={!canControl} onClick={() => setConfirm({ type: 'restart', label: 'Restart' })}>↻ Restart</Btn>
              <Btn disabled={!canControl} onClick={() => setConfirm({ type: 'sync', label: 'Synchronize time' })}>🕐 Sync time</Btn>
            </div>
            {!canControl && <div className="muted small" style={{ marginTop: 8 }}>Controls are disabled while the device is locked.</div>}
          </Card>

          <Card title="Batch">
            {device.batch ? (
              <>
                <div className="row-between">
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>{ANIMALS[device.batch.animal]?.label} batch</div>
                    <div className="muted small">Started {fmtDate(device.batch.startDate)} · {device.batch.count} animals</div>
                  </div>
                  <Badge tone="ok">Day {day}/{device.batch.durationDays}</Badge>
                </div>
                <div style={{ margin: '10px 0 4px' }}><Progress value={(day / device.batch.durationDays) * 100} /></div>
                <div className="muted small">{batchRemaining(device.batch.startDate, device.batch.durationDays, now)} days remaining</div>
                <div className="btn-row" style={{ marginTop: 10 }}>
                  <Btn variant="danger" small onClick={() => { dispatch({ type: 'END_BATCH', deviceId: device.id }); dispatch({ type: 'TOAST', msg: 'Batch ended.' }); }}>End batch</Btn>
                </div>
              </>
            ) : (
              <div className="muted" style={{ marginBottom: 10 }}>No active batch.</div>
            )}
            <Btn variant="green" small onClick={() => setStartBatch(true)}>🐣 {device.batch ? 'Start new batch' : 'Start a batch'}</Btn>
          </Card>

          <Card title="Subscription">
            {sub?.status === 'active' && subscriptionState(sub.endDate, now) === 'active' ? (
              <>
                <div className="row-between">
                  <div>
                    <div style={{ fontWeight: 800 }}>{state.plans.find((p) => p.id === sub.planId)?.name || 'Plan'} plan</div>
                    <div className="muted small">Expires {fmtDate(sub.endDate)}</div>
                  </div>
                  <Badge tone="ok">{daysLeft} days left</Badge>
                </div>
                {daysLeft <= 7 && <div className="warn-banner" style={{ marginTop: 8 }}>⏳ Expires soon — renew to avoid the device locking.</div>}
              </>
            ) : (
              <div>
                <div style={{ fontWeight: 700, color: 'var(--crit)' }}>{sub ? 'Subscription expired' : 'No subscription'} — device locked 🔒</div>
                <Link to="/farmer/subscriptions" className="btn primary small" style={{ marginTop: 10 }}>💳 Renew now</Link>
              </div>
            )}
          </Card>
        </div>
      </div>

      {confirm && (
        <Modal title={`${confirm.label} — confirm`} onClose={() => setConfirm(null)}>
          <p>Are you sure you want to {confirm.label.toLowerCase()} <b>{device.name}</b>? This action is recorded in the audit log.</p>
          <div className="btn-row">
            <Btn variant="primary" onClick={doConfirm}>Yes, {confirm.label.toLowerCase()}</Btn>
            <Btn onClick={() => setConfirm(null)}>Cancel</Btn>
          </div>
        </Modal>
      )}

      {startBatch && (
        <StartBatchModal device={device} onClose={() => setStartBatch(false)} dispatch={dispatch} now={now} />
      )}
    </div>
  );
}

function StartBatchModal({ device, onClose, dispatch, now }) {
  const [animal, setAnimal] = useState('chicken');
  const [duration, setDuration] = useState(21);
  const [count, setCount] = useState(500);
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const preset = ANIMALS[animal];
  return (
    <Modal title="Start a new brooding batch" onClose={onClose}>
      <Field label="Animal type">
        <select value={animal} onChange={(e) => { setAnimal(e.target.value); setDuration(ANIMALS[e.target.value].durationDays); }}>
          {Object.values(ANIMALS).map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
        </select>
      </Field>
      <div className="grid cols-3" style={{ gap: 10 }}>
        <Field label="Duration (days)"><input type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></Field>
        <Field label="Animals"><input type="number" value={count} onChange={(e) => setCount(Number(e.target.value))} /></Field>
        <Field label="Start date"><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
      </div>
      <p className="muted small">Recommended range: {preset.baseMin}–{preset.baseMax}°C, {preset.durationDays} days. The system auto-steps targets down as the animals grow.</p>
      <div className="btn-row">
        <Btn variant="green" onClick={() => {
          dispatch({ type: 'START_BATCH', deviceId: device.id, animal, durationDays: duration, count, startDate: new Date(`${start}T06:00:00`).toISOString() });
          dispatch({ type: 'TOAST', msg: 'Batch started 🐣' });
          onClose();
        }}>Start batch</Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </div>
    </Modal>
  );
}
