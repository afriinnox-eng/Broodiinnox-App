import React, { useMemo } from 'react';
import { useStore } from '../../lib/store.jsx';
import { avgTemp, deviceStatus, batchDay } from '../../lib/services.js';
import { ANIMALS } from '../../lib/presets.js';
import { Card, StatusBadge } from '../../components/ui.jsx';
import { Icon } from '../../components/icons.jsx';
import { timeAgo } from '../../lib/time.js';
import { liveVmStatus, useLiveDevices } from '../../lib/live.js';
import { t } from '../../i18n/strings.js';

function LiveDeviceCard({ vm, lang }) {
  const now = new Date().toISOString();
  const status = liveVmStatus(vm, now);
  const seen = vm.lastSeenAt ? timeAgo(vm.lastSeenAt, now) : '—';
  return (
    <Card title={`${vm.name} — ${vm.id}`}>
      <div className="row-between">
        <StatusBadge status={status} />
        <span className="muted small">
          {status === 'online' ? `${lang === 'fr' ? 'Mis à jour' : 'Updated'} ${seen} ${lang === 'fr' ? 'il y a' : 'ago'}` : `Last seen ${seen} ago`}
        </span>
      </div>
      <div className="row" style={{ margin: '10px 0', gap: 20 }}>
        <div>
          <div className="muted small">Temp</div>
          <div className="big" style={{ color: 'var(--brand-blue)' }}>
            {vm.aveTemp === null || vm.aveTemp === undefined ? '—' : `${vm.aveTemp.toFixed(1)}°C`}
          </div>
        </div>
        <div>
          <div className="muted small">Heater</div>
          <div style={{ fontWeight: 800 }}>
            {vm.heaterOn ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="flame" size={16} /> ON</span>
            ) : 'OFF'}
            <span className="muted small"> · {vm.manual ? 'MAN' : 'AUTO'}</span>
          </div>
        </div>
        <div>
          <div className="muted small">Day</div>
          <div style={{ fontWeight: 700 }}>{vm.day === null || vm.day === undefined ? '—' : `D${vm.day}/${vm.totalDays || '?'}`}</div>
        </div>
        <div>
          <div className="muted small">Signal</div>
          <div style={{ fontWeight: 700 }}>{vm.signalQuality === null || vm.signalQuality === undefined ? '—' : `CSQ ${vm.signalQuality}`}</div>
        </div>
      </div>
      <div className="muted small">Probes:</div>
      <div className="row" style={{ gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
        {vm.sensors.map((s) => (
          <span key={s.id} className={`chip ${s.health === 'err' ? 'chip' : ''}`} style={{ color: s.health === 'err' ? 'var(--crit)' : undefined }}>
            DS{s.id}: {s.health === 'err' ? 'ERR' : `${s.lastReading.toFixed(1)}°C`}
          </span>
        ))}
      </div>
      {(vm.failsafe || vm.sensorError || vm.mismatchError || vm.locked) && (
        <div className="muted small" style={{ marginTop: 8, color: 'var(--crit)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {vm.locked && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="lock" size={12} /> LOCKED</span>
          )}
          {vm.failsafe && <span>Failsafe heating</span>}
          {vm.sensorError && <span>Sensor fault</span>}
          {vm.mismatchError && <span>Sensor mismatch</span>}
        </div>
      )}
    </Card>
  );
}

/** Live monitoring — every system's telemetry, refreshed by the store ticker. */
export default function AdminLive() {
  const { state } = useStore();
  const lang = state.lang || 'en';
  const now = new Date().toISOString();
  const farmers = useMemo(() => Object.fromEntries(state.farmers.map((f) => [f.id, f.name])), [state.farmers]);
  const live = useLiveDevices({ intervalMs: 5000 });

  return (
    <div>
      <h1>{t('nav.live', lang)} <span className="chip" style={{ color: 'var(--ok)' }}><Icon name="pulse" size={15} /> LIVE</span></h1>
      {live.live ? (
        <>
          <p className="muted">Real telemetry from broodiinnox-api — refreshes every 5 seconds.</p>
          {live.error && (
            <p className="chip" style={{ color: 'var(--crit)', margin: '8px 0' }}>
              API error: {live.error}
            </p>
          )}
          {live.loading && <p className="muted">Connecting to live API…</p>}
          <div className="grid cols-3" style={{ marginTop: 14 }}>
            {live.devices.map((vm) => (
              <LiveDeviceCard key={vm.id} vm={vm} lang={lang} />
            ))}
            {!live.loading && !live.error && live.devices.length === 0 && (
              <p className="muted">No devices registered on the API yet.</p>
            )}
          </div>
        </>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
