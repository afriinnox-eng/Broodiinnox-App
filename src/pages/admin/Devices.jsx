import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../../lib/store.jsx';
import { deviceStatus, avgTemp } from '../../lib/services.js';
import { Badge, Btn, Card, DataTable, Field, Modal, StatusBadge } from '../../components/ui.jsx';
import { PowerSwitch } from '../../components/PowerSwitch.jsx';
import { bandForChicks, bandLabel, coverageFor, deviceBand, plansForBand, priceFor } from '../../lib/subscriptions.js';
import { fmtDate, timeAgo } from '../../lib/time.js';
import { fmtMoney, t } from '../../i18n/strings.js';

const DISTRICTS = ['Kigali', 'Musanze', 'Huye', 'Rwamagana', 'Nyagatare', 'Rubavu', 'Muhanga'];

export default function AdminDevices() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state, dispatch } = useStore();
  const lang = state.lang || 'en';
  const now = new Date().toISOString();
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('all');
  const [registerOpen, setRegisterOpen] = useState(false);

  const devices = useMemo(() => {
    let list = state.devices;
    if (q.trim()) {
      const n = q.toLowerCase();
      list = list.filter((d) => `${d.serial} ${d.name} ${d.location?.district}`.toLowerCase().includes(n));
    }
    if (statusF !== 'all') list = list.filter((d) => deviceStatus(d, now) === statusF);
    return list;
  }, [state.devices, q, statusF, now]);

  const farmerName = (fid) => state.farmers.find((f) => f.id === fid)?.name || '—';
  const selected = id ? state.devices.find((d) => d.id === id) : null;

  return (
    <div>
      <div className="row-between">
        <h1>{t('nav.devices', lang)} <span className="pill">{devices.length}</span></h1>
        <Btn variant="primary" onClick={() => setRegisterOpen(true)}>+ Register device</Btn>
      </div>
      <div className="row" style={{ margin: '12px 0' }}>
        <input className="topbar-search" placeholder="Search serial, name, district…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, maxWidth: 340 }} />
        <select className="field" style={{ width: 'auto', marginBottom: 0 }} value={statusF} onChange={(e) => setStatusF(e.target.value)}>
          <option value="all">All statuses</option>
          {['online', 'offline', 'warning', 'critical', 'locked'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <DataTable
        columns={[
          { key: 'serial', label: 'Device', render: (r) => <div><b>{r.serial}</b><div className="muted small">{r.name} · FW {r.firmware}</div></div> },
          { key: 'farmer', label: 'Farmer', render: (r) => farmerName(r.farmerId) },
          { key: 'location', label: 'Location', render: (r) => `${r.location?.district || '—'}` },
          { key: 'farmSize', label: 'Farm size', render: (r) => {
            const band = deviceBand(r);
            return (
              <div>
                <b>{r.farmSize ? r.farmSize.toLocaleString('en-US') : '—'}</b>
                <div className="muted small">{band ? bandLabel(band) : 'not set — cannot be priced'}</div>
              </div>
            );
          } },
          { key: 'temp', label: 'Avg temp', render: (r) => { const a = avgTemp(r.sensors); return a === null ? '—' : `${a.toFixed(1)}°C`; } },
          { key: 'status', label: 'Status', render: (r) => <StatusBadge status={deviceStatus(r, now)} /> },
          { key: 'lastSeen', label: 'Last seen', render: (r) => timeAgo(r.lastSeen, now) + ' ago' },
          { key: 'power', label: 'System power', render: (r) => <PowerSwitch device={r} lang={lang} small showLabel={false} /> },
          { key: 'actions', label: '', render: (r) => <Btn small onClick={(e) => { e.stopPropagation(); navigate(`/admin/systems/${r.id}`); }}>Manage</Btn> },
        ]}
        rows={devices.map((d) => ({ ...d, _key: d.id }))}
      />

      {selected && (
        <DeviceDetail device={selected} farmerName={farmerName(selected.farmerId)} onClose={() => navigate('/admin/devices')}
          dispatch={dispatch} plans={state.plans} maintenance={state.maintenance} now={now} lang={lang} />
      )}

      {registerOpen && <RegisterDeviceModal dispatch={dispatch} farmers={state.farmers} onClose={() => setRegisterOpen(false)} />}
    </div>
  );
}

function DeviceDetail({ device, farmerName, onClose, dispatch, plans, maintenance, now, lang }) {
  const avg = avgTemp(device.sensors);
  const maint = maintenance.find((m) => m.deviceId === device.id);
  return (
    <Card title={`${device.serial} — ${device.name}`} style={{ marginTop: 16 }} actions={<Btn small onClick={onClose}>Close</Btn>}>
      <div className="grid cols-3">
        <div>
          <div className="muted small">Farmer</div>
          <b>{farmerName}</b>
          <div className="muted small" style={{ marginTop: 8 }}>Location</div>
          <div>{device.location?.district}, {device.location?.sector} <span className="muted small">({device.location?.lat}, {device.location?.lng})</span></div>
          <div className="muted small" style={{ marginTop: 8 }}>Installed</div>
          <div>{fmtDate(device.installedAt)} · firmware {device.firmware}</div>
          <div className="muted small" style={{ marginTop: 8 }}>Farm size — max chicks brooded at once</div>
          <FarmSizeControl device={device} dispatch={dispatch} />
        </div>
        <div>
          <div className="muted small">Status</div>
          <StatusBadge status={deviceStatus(device, now)} />
          <div className="muted small" style={{ marginTop: 8 }}>Temperature</div>
          <div className="big">{avg === null ? '—' : `${avg.toFixed(1)}°C`} <span className="small muted">heater {device.heaterOn ? 'ON' : 'OFF'}</span></div>
          <div className="muted small" style={{ marginTop: 8 }}>Sensors</div>
          <div>{device.sensors.map((s) => <span key={s.id} className="chip" style={{ marginRight: 6 }}>S{s.id} {s.enabled ? (typeof s.lastReading === 'number' ? `${s.lastReading.toFixed(1)}°` : '?') : 'off'}</span>)}</div>
        </div>
        <div>
          <div className="muted small">Subscription</div>
          <Badge tone={device.subscription?.status === 'active' ? 'ok' : 'crit'}>{device.subscription?.status || 'none'}</Badge>
          {device.subscription?.endDate && <div className="muted small">ends {fmtDate(device.subscription.endDate)}</div>}
          <div className="muted small" style={{ marginTop: 8 }}>Maintenance</div>
          <div>{maint ? `next ${fmtDate(maint.nextMaintenance)}` : '—'}</div>
          <div className="muted small" style={{ marginTop: 8 }}>Subscription</div>
          <SubscriptionSummary device={device} plans={plans} now={now} />
          <div className="muted small" style={{ marginTop: 8 }}>System power</div>
          <PowerSwitch device={device} lang={lang} showLabel={false} showHint />
          <div className="btn-row" style={{ marginTop: 12 }}>
            <Btn small variant="danger" onClick={() => { dispatch({ type: 'LOCK_DEVICE', deviceId: device.id, lock: !device.manualLock }); dispatch({ type: 'TOAST', msg: device.manualLock ? 'Device unlocked by admin.' : 'Device locked by admin.' }); }}>
              {device.manualLock ? 'Unlock' : 'Lock'}
            </Btn>
            <Btn small onClick={() => { dispatch({ type: 'RESTART_DEVICE', deviceId: device.id }); dispatch({ type: 'TOAST', msg: 'Restart acknowledged — device is back online.' }); }}>Restart</Btn>
            <Btn small onClick={() => { dispatch({ type: 'SYNC_TIME', deviceId: device.id }); dispatch({ type: 'TOAST', msg: 'Time synchronized to network.' }); }}>Sync time</Btn>
          </div>
          {(device.restartedAt || device.timeSyncedAt) && (
            <div className="muted small" style={{ marginTop: 6 }}>
              {device.restartedAt && <span style={{ display: 'block' }}>Restarted {timeAgo(device.restartedAt)} ago</span>}
              {device.timeSyncedAt && <span style={{ display: 'block' }}>Clock synced {timeAgo(device.timeSyncedAt)} ago</span>}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function RegisterDeviceModal({ dispatch, farmers, onClose }) {
  const [serial, setSerial] = useState('BRD0');
  const [name, setName] = useState('');
  const [farmerId, setFarmerId] = useState(farmers[0]?.id || '');
  const [district, setDistrict] = useState(DISTRICTS[0]);
  // The farm size is what every subscription plan will be priced against, so it
  // is captured here, with the device — never guessed at billing time.
  const [farmSize, setFarmSize] = useState('1000');

  const size = Number(farmSize);
  const sizeValid = Number.isInteger(size) && size > 0;
  const band = bandForChicks(sizeValid ? size : null);
  const plans = plansForBand(band);
  const canSave = serial.trim() !== '' && sizeValid;

  const save = () => {
    if (!canSave) return;
    const id = serial.trim().toUpperCase();
    dispatch({
      type: 'REGISTER_DEVICE', serial: id, name, farmerId, farmSize: size,
      location: { district, sector: '—', lat: -1.95, lng: 30.06 },
    });
    if (farmerId) dispatch({ type: 'ASSIGN_DEVICE', deviceId: id, farmerId });
    dispatch({
      type: 'TOAST',
      msg: `Device ${id} registered${band ? ` — priced for ${bandLabel(band)}` : ''}.`,
    });
    onClose();
  };

  return (
    <Modal title="Register a new Broodiinnox device" onClose={onClose}>
      <div className="grid cols-2" style={{ gap: 10 }}>
        <Field label="Serial number"><input value={serial} onChange={(e) => setSerial(e.target.value)} /></Field>
        <Field label="Display name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Farm A" /></Field>
      </div>
      <Field label="Assign to farmer">
        <select value={farmerId} onChange={(e) => setFarmerId(e.target.value)}>{farmers.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.phone})</option>)}</select>
      </Field>
      <div className="grid cols-2" style={{ gap: 10 }}>
        <Field label="District"><select value={district} onChange={(e) => setDistrict(e.target.value)}>{DISTRICTS.map((d) => <option key={d}>{d}</option>)}</select></Field>
        <Field label="Farm size — max chicks brooded at once">
          <input type="number" min={1} value={farmSize} onChange={(e) => setFarmSize(e.target.value)} placeholder="e.g. 1000" />
        </Field>
      </div>

      <div className="muted small" style={{ marginBottom: 10 }}>
        {band
          ? <>Subscriptions for this farm ({bandLabel(band)}):</>
          : sizeValid
            ? 'Above 15,999 chicks — the sheet quotes those individually, so no list price applies.'
            : 'Enter the farm size to see what this farmer will pay.'}
      </div>
      {band && (
        <div className="table-wrap" style={{ marginBottom: 12 }}>
          <table>
            <thead><tr><th>Plan</th><th>Days</th><th>Price</th></tr></thead>
            <tbody>
              {plans.map(({ term, price }) => (
                <tr key={term.id}>
                  <td>{term.name}</td>
                  <td>{term.days}</td>
                  <td>{price === null ? 'Customized' : fmtMoney(price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted small">The serial number is the permanent device identifier — the display name can change later. The farm size decides the price of every plan and is what the farmer is shown.</p>
      <div className="btn-row">
        <Btn variant="primary" onClick={save} disabled={!canSave}>Register</Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </div>
    </Modal>
  );
}

/**
 * The farm size is Afriinnox's to set, not the farmer's: it is what the price is
 * calculated from. Changing it prices the plans bought from now on — a
 * subscription already bought keeps the band and price it was sold at.
 */
function FarmSizeControl({ device, dispatch }) {
  const [value, setValue] = useState(String(device.farmSize ?? ''));
  const size = Number(value);
  const valid = Number.isInteger(size) && size > 0;
  const band = bandForChicks(valid ? size : null);
  const changed = valid && size !== device.farmSize;
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="number"
          min={1}
          aria-label="Farm size in chicks"
          style={{ width: 120, marginBottom: 0 }}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. 1000"
        />
        <Btn
          small
          variant="primary"
          disabled={!changed}
          onClick={() => {
            dispatch({ type: 'SET_DEVICE_FARM_SIZE', deviceId: device.id, farmSize: size });
            dispatch({
              type: 'TOAST',
              msg: `${device.serial} farm size set to ${size.toLocaleString('en-US')} chicks — plans are now priced for ${band ? bandLabel(band) : 'a custom quote'}.`,
            });
          }}
        >
          Save farm size
        </Btn>
      </div>
      <div className="muted small" style={{ marginTop: 4 }}>
        {band
          ? `${bandLabel(band)} · the 30-Day plan costs ${fmtMoney(priceFor(band, 't30d'))}`
          : valid ? 'Above 15,999 chicks — quoted individually by Afriinnox.' : 'Enter the maximum number of chicks brooded at once.'}
      </div>
    </div>
  );
}

/** What this device is paying, and whether the plan reaches the end of its batch. */
function SubscriptionSummary({ device, plans, now }) {
  const sub = device.subscription;
  const band = deviceBand(device);
  if (!sub?.planId) {
    return (
      <div className="muted small">
        No plan bought yet{band ? ` — plans for ${bandLabel(band)} start at ${fmtMoney(priceFor(band, 't15d'))}` : ''}.
      </div>
    );
  }
  const c = coverageFor(sub, device.batch, now);
  return (
    <div className="muted small">
      <div>
        <b>{plans.find((p) => p.id === sub.planId)?.name || sub.planId}</b>
        {typeof sub.price === 'number' ? ` — ${fmtMoney(sub.price)}` : ''}
        {sub.bandId ? ` · bought for ${bandLabel(c.band)}` : ''}
      </div>
      <div>{c.daysLeft} of {c.paidDays ?? c.termDays} days left · expires {fmtDate(sub.endDate)}</div>
      {c.batchDays ? (
        <div className={c.coversBatch ? '' : 'power-switch-status bad'}>
          {c.coversBatch
            ? `Covers the ${c.batchDays}-day batch in full`
            : `Ends ${c.shortfallDays} day${c.shortfallDays === 1 ? '' : 's'} before the batch does`}
          {c.batchesCovered > 0 ? ` · batch ${c.batchesUsed} of ${c.batchesCovered}` : ''}
        </div>
      ) : null}
    </div>
  );
}
