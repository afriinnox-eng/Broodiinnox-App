import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { buildSeed } from './seed.js';
import { addDays, nowIso } from './time.js';
import {
  apiDeviceToVm, createIotApi,
} from './iot.js';
import {
  liveCommandPlan, liveConfig, overlayLiveDevice, storeDeviceFromVm,
} from './live.js';
import {
  avgTemp, batchDay, generateAlerts, heaterDecision, makeAudit, paymentVerified,
  simulateMoMo, stepDownTargets, uid, PAYMENT_STATUS, SEVERITY,
} from './services.js';

const STORAGE_KEY = 'broodiinnox_app_v1';
const ALERT_DEDUPE_MS = 30 * 60000;
const REMINDER_KEYS = ['7d', '3d', '1d', 'expired'];

/* ------------------------------ reducer ------------------------------ */

function reducer(state, action) {
  switch (action.type) {
    case 'LOGIN':
      return { ...state, session: action.user };
    case 'LOGOUT':
      return { ...state, session: null };
    case 'SET_LANG':
      return { ...state, lang: action.lang };
    case 'SET_THEME':
      return { ...state, theme: action.theme };
    case 'TOAST':
      return { ...state, toast: { msg: action.msg, kind: action.kind || 'info', at: Date.now() } };
    case 'CLEAR_TOAST':
      return state.toast && Date.now() - state.toast.at > 3500 ? { ...state, toast: null } : state;

    case 'TICK':
      return tick(state);

    case 'SET_TARGETS': {
      const { deviceId, min, max } = action;
      const dev = state.devices.find((d) => d.id === deviceId);
      if (!dev) return state;
      return withAudit(
        {
          ...state,
          devices: state.devices.map((d) => (d.id === deviceId ? { ...d, baseMin: min, baseMax: max } : d)),
        },
        { user: state.session?.name, role: state.session?.role, action: 'temperature.change', details: `${deviceId} min ${dev.baseMin}°C→${min}°C, max ${dev.baseMax}°C→${max}°C`, prev: { min: dev.baseMin, max: dev.baseMax }, next: { min, max } }
      );
    }

    case 'SET_SENSOR': {
      const { deviceId, sensorId, enabled } = action;
      return {
        ...state,
        devices: state.devices.map((d) =>
          d.id === deviceId
            ? { ...d, sensors: d.sensors.map((s) => (s.id === sensorId ? { ...s, enabled } : s)) }
            : d
        ),
      };
    }

    case 'START_BATCH': {
      const { deviceId, animal, startDate, durationDays, count } = action;
      const dev = state.devices.find((d) => d.id === deviceId);
      if (!dev) return state;
      const preset = { chicken: [35, 37], duck: [33, 35], turkey: [34, 36], pig: [30, 32] }[animal] || [35, 37];
      return withAudit(
        {
          ...state,
          devices: state.devices.map((d) =>
            d.id === deviceId
              ? { ...d, batch: { animal, startDate, durationDays, count, status: 'running' }, baseMin: preset[0], baseMax: preset[1] }
              : d
          ),
        },
        { user: state.session?.name, role: state.session?.role, action: 'batch.start', details: `${deviceId} started ${animal} batch (${durationDays}d, ${count} animals)` }
      );
    }

    case 'END_BATCH': {
      const { deviceId } = action;
      const dev = state.devices.find((d) => d.id === deviceId);
      if (!dev) return state;
      return withAudit(
        {
          ...state,
          devices: state.devices.map((d) =>
            d.id === deviceId
              ? { ...d, batch: { ...d.batch, status: 'ended' }, lastBatchEnd: nowIso() }
              : d
          ),
        },
        { user: state.session?.name, role: state.session?.role, action: 'batch.end', details: `${deviceId} batch ended` }
      );
    }

    case 'RENAME_DEVICE':
      return withAudit(
        {
          ...state,
          devices: state.devices.map((d) => (d.id === action.deviceId ? { ...d, name: action.name } : d)),
        },
        { user: state.session?.name, role: state.session?.role, action: 'device.rename', details: `${action.deviceId} → ${action.name}` }
      );

    case 'RESTART_DEVICE':
      return withAudit(
        {
          ...state,
          devices: state.devices.map((d) => (d.id === action.deviceId ? { ...d, lastSeen: nowIso(), heaterOn: false } : d)),
        },
        { user: state.session?.name, role: state.session?.role, action: 'device.restart', details: `${action.deviceId} restarted remotely` }
      );

    case 'SYNC_TIME':
      return withAudit(
        { ...state },
        { user: state.session?.name, role: state.session?.role, action: 'device.time_sync', details: `${action.deviceId} time synchronized` }
      );

    case 'REQUEST_PAYMENT': {
      const { farmerId, deviceId, planId, phone } = action;
      const plan = state.plans.find((p) => p.id === planId);
      const payment = {
        id: uid('pay'), farmerId, deviceId, planId, phone,
        amount: plan ? plan.price : 0, method: 'MTN MoMo', status: PAYMENT_STATUS.PENDING,
        providerConfirmed: false, providerRef: null, period: `${plan?.name || ''} renewal`, createdAt: nowIso(), confirmedAt: null,
      };
      return withAudit(
        { ...state, payments: [payment, ...state.payments] },
        { user: state.session?.name, role: state.session?.role, action: 'payment.request', details: `MoMo payment requested for ${deviceId} (RWF ${payment.amount})` }
      );
    }

    case 'CONFIRM_PAYMENT': {
      const payment = state.payments.find((p) => p.id === action.paymentId);
      if (!payment || payment.status !== PAYMENT_STATUS.PENDING) return state;
      const ok = action.ok !== undefined ? action.ok : true;
      const confirmed = { ...payment, status: ok ? PAYMENT_STATUS.SUCCESSFUL : PAYMENT_STATUS.FAILED, providerConfirmed: ok, confirmedAt: nowIso() };
      let next = { ...state, payments: state.payments.map((p) => (p.id === payment.id ? confirmed : p)) };
      if (ok) {
        const plan = state.plans.find((p) => p.id === payment.planId);
        const start = nowIso();
        const end = plan ? addDays(start, plan.durationDays) : start;
        next = {
          ...next,
          devices: next.devices.map((d) =>
            d.id === payment.deviceId
              ? { ...d, subscription: { planId: payment.planId, status: 'active', startDate: start, endDate: end } }
              : d
          ),
          notifications: [
            { id: uid('n'), farmerId: payment.farmerId, title: 'Payment received', body: `Your RWF ${payment.amount} payment was confirmed. Device unlocked.`, severity: 'info', read: false, at: nowIso() },
            ...next.notifications,
          ],
        };
      }
      return withAudit(
        next,
        { user: state.session?.name, role: state.session?.role, action: ok ? 'payment.success' : 'payment.failed', details: `MoMo payment ${ok ? 'confirmed' : 'failed'} for ${payment.deviceId} (RWF ${payment.amount})` }
      );
    }

    case 'CREATE_PLAN':
      return withAudit(
        { ...state, plans: [...state.plans, { id: uid('plan'), active: true, ...action.plan }] },
        { user: state.session?.name, role: state.session?.role, action: 'plan.create', details: `Created plan ${action.plan.name}` }
      );

    case 'UPDATE_PLAN':
      return withAudit(
        { ...state, plans: state.plans.map((p) => (p.id === action.id ? { ...p, ...action.patch } : p)) },
        { user: state.session?.name, role: state.session?.role, action: 'plan.update', details: `Updated plan ${action.id}` }
      );

    case 'REGISTER_DEVICE': {
      const dev = {
        id: action.serial, serial: action.serial, name: action.name || action.serial, farmerId: action.farmerId || null,
        firmware: 'v2.1.0', installedAt: nowIso(), location: action.location || { district: '—', sector: '—', lat: 0, lng: 0 },
        baseMin: 35, baseMax: 37, safetyFloor: 20, batch: null,
        sensors: [1, 2, 3, 4].map((i) => ({ id: i, enabled: true, lastReading: 24, health: 'ok' })),
        heaterOn: false, lastSeen: nowIso(), subscription: { planId: null, status: 'inactive', startDate: null, endDate: null },
        manualStatus: null,
      };
      return withAudit(
        { ...state, devices: [...state.devices, dev] },
        { user: state.session?.name, role: state.session?.role, action: 'device.register', details: `Registered ${action.serial}` }
      );
    }

    case 'LIVE_SYNC': {
      // Overlay real broodiinnox-api state onto every store device whose id
      // matches a live device (so a device registered in the UI shows the
      // SAME real values as Admin Live), and add API-registered devices that
      // are not in the store yet. Devices absent from the API are untouched.
      const vms = (action.devices || []).filter((v) => v && v.id);
      const byVm = new Map(vms.map((v) => [v.id, v]));
      const liveIds = new Set(byVm.keys());
      const now = nowIso();
      let devices = state.devices.map((d) => (liveIds.has(d.id) ? overlayLiveDevice(d, byVm.get(d.id), now) : d));
      const have = new Set(devices.map((d) => d.id));
      for (const vm of vms) {
        if (!have.has(vm.id)) devices = [...devices, storeDeviceFromVm(vm, now)];
      }
      return { ...state, devices, liveDeviceIds: [...liveIds] };
    }

    case 'ASSIGN_DEVICE':
      return withAudit(
        { ...state, devices: state.devices.map((d) => (d.id === action.deviceId ? { ...d, farmerId: action.farmerId } : d)) },
        { user: state.session?.name, role: state.session?.role, action: 'device.assign', details: `${action.deviceId} → farmer ${action.farmerId}` }
      );

    case 'LOCK_DEVICE':
      return withAudit(
        { ...state, devices: state.devices.map((d) => (d.id === action.deviceId ? { ...d, manualLock: !!action.lock } : d)) },
        { user: state.session?.name, role: state.session?.role, action: action.lock ? 'device.lock' : 'device.unlock', details: `${action.deviceId} ${action.lock ? 'locked' : 'unlocked'} by admin` }
      );

    case 'REGISTER_FARMER': {
      const farmer = { id: uid('f'), status: 'active', createdAt: nowIso(), ...action.farmer };
      return withAudit(
        { ...state, farmers: [farmer, ...state.farmers] },
        { user: state.session?.name, role: state.session?.role, action: 'farmer.create', details: `Created farmer ${farmer.name}` }
      );
    }

    case 'UPDATE_FARMER':
      return withAudit(
        { ...state, farmers: state.farmers.map((f) => (f.id === action.id ? { ...f, ...action.patch } : f)) },
        { user: state.session?.name, role: state.session?.role, action: 'farmer.update', details: `Updated farmer ${action.id}` }
      );

    case 'ADD_TICKET': {
      const ticket = { id: uid('t'), status: 'new', assignee: null, messages: [], createdAt: nowIso(), ...action.ticket };
      return withAudit(
        { ...state, tickets: [ticket, ...state.tickets] },
        { user: state.session?.name, role: state.session?.role, action: 'ticket.open', details: `Ticket ${ticket.id}: ${ticket.subject}` }
      );
    }

    case 'UPDATE_TICKET':
      return withAudit(
        { ...state, tickets: state.tickets.map((t) => (t.id === action.id ? { ...t, ...action.patch } : t)) },
        { user: state.session?.name, role: state.session?.role, action: 'ticket.update', details: `Ticket ${action.id} → ${action.patch.status || 'updated'}` }
      );

    case 'TICKET_MESSAGE': {
      const msg = { author: action.author, at: nowIso(), text: action.text };
      return {
        ...state,
        tickets: state.tickets.map((t) => (t.id === action.id ? { ...t, messages: [...t.messages, msg] } : t)),
      };
    }

    case 'SEND_MESSAGE': {
      const msg = { id: uid('msg'), ...action.msg, sentAt: nowIso() };
      return withAudit(
        { ...state, messages: [msg, ...state.messages] },
        { user: state.session?.name, role: state.session?.role, action: 'message.send', details: `Message sent to ${action.msg.audience}` }
      );
    }

    case 'ADD_ADMIN':
      return withAudit(
        { ...state, admins: [...state.admins, { id: uid('a'), status: 'active', createdAt: nowIso(), ...action.admin }] },
        { user: state.session?.name, role: state.session?.role, action: 'admin.create', details: `Created admin ${action.admin.name} (${action.admin.role})` }
      );

    case 'UPDATE_ADMIN':
      return withAudit(
        { ...state, admins: state.admins.map((a) => (a.id === action.id ? { ...a, ...action.patch } : a)) },
        { user: state.session?.name, role: state.session?.role, action: 'admin.update', details: `Updated admin ${action.id}` }
      );

    case 'MAINTENANCE_UPDATE':
      return withAudit(
        { ...state, maintenance: state.maintenance.map((m) => (m.id === action.id ? { ...m, ...action.patch } : m)) },
        { user: state.session?.name, role: state.session?.role, action: 'maintenance.update', details: `Maintenance ${action.id} updated` }
      );

    case 'MAINTENANCE_ADD': {
      const rec = { id: uid('m'), status: 'ok', notes: '', ...action.record };
      return withAudit(
        { ...state, maintenance: [...state.maintenance, rec] },
        { user: state.session?.name, role: state.session?.role, action: 'maintenance.add', details: `Maintenance record for ${rec.deviceId}` }
      );
    }

    case 'INVENTORY_UPDATE':
      return { ...state, inventory: state.inventory.map((i) => (i.id === action.id ? { ...i, ...action.patch } : i)) };

    case 'INVENTORY_ADD':
      return { ...state, inventory: [...state.inventory, { id: uid('inv'), ...action.item }] };

    case 'MARK_ALERT_READ': {
      const id = action.id;
      return { ...state, alerts: state.alerts.map((a) => (a.id === id ? { ...a, read: true } : a)) };
    }

    case 'MARK_ALL_ALERTS_READ':
      return { ...state, alerts: state.alerts.map((a) => ({ ...a, read: true })) };

    case 'MARK_NOTIF_READ': {
      const id = action.id;
      return { ...state, notifications: state.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) };
    }

    case 'MARK_ALL_NOTIF_READ':
      return { ...state, notifications: state.notifications.map((n) => ({ ...n, read: true })) };

    case 'RESET_DATA':
      return { ...state, ...buildSeed(), reminderSent: [], session: null };

    default:
      return state;
  }
}

function withAudit(state, entry) {
  const audit = [makeAudit(entry), ...state.audit].slice(0, 500);
  return { ...state, audit };
}

/* ------------------------------- TICK -------------------------------- */

function tick(state) {
  const now = nowIso();
  const devices = state.devices.map((dev) => {
    // Real devices are written by LIVE_SYNC from the API — the mock ticker
    // must never wander their sensors or pretend they are fresh.
    if (dev.live) return dev;
    const day = dev.batch ? batchDay(dev.batch.startDate, dev.batch.durationDays, now) : 1;
    const { min, max } = stepDownTargets(dev.baseMin, dev.baseMax, day);
    const mid = (min + max) / 2;
    const sensors = dev.sensors.map((s) => {
      if (!s.enabled) return s;
      const cur = typeof s.lastReading === 'number' ? s.lastReading : mid;
      const wander = cur + (Math.random() - 0.5) * 0.3 + (mid - cur) * 0.06;
      return { ...s, lastReading: Math.round(wander * 10) / 10 };
    });
    const avg = avgTemp(sensors);
    const heaterOn = heaterDecision(avg, min, max, dev.heaterOn);
    return { ...dev, sensors, heaterOn, lastSeen: now, day, targets: { min, max } };
  });

  let alerts = [...state.alerts];
  for (const dev of devices) {
    for (const a of generateAlerts(dev, now)) {
      const fresh = alerts.find((x) => x.deviceId === dev.id && x.key === a.key && (new Date(now) - new Date(x.at)) < ALERT_DEDUPE_MS);
      if (!fresh) {
        alerts = [{ id: uid('al'), deviceId: dev.id, key: a.key, severity: a.severity, message: a.message, at: now, read: false }, ...alerts];
      }
    }
  }

  // maintenance due alerts (dedupe 12h)
  for (const m of state.maintenance) {
    if (new Date(now) >= new Date(m.nextMaintenance) && m.status !== 'completed') {
      const fresh = alerts.find((x) => x.deviceId === m.deviceId && x.key === 'maintenance_due' && (new Date(now) - new Date(x.at)) < 12 * 3600000);
      if (!fresh) {
        alerts = [{ id: uid('al'), deviceId: m.deviceId, key: 'maintenance_due', severity: SEVERITY.WARNING, message: `Maintenance due for ${m.deviceId}.`, at: now, read: false }, ...alerts];
      }
    }
  }

  // expiry reminders (once per day per device+key)
  let reminderSent = [...(state.reminderSent || [])];
  let notifications = [...state.notifications];
  for (const dev of devices) {
    const sub = dev.subscription;
    if (!sub || sub.status !== 'active') continue;
    const dayKey = new Date(now).toISOString().slice(0, 10);
    for (const key of REMINDER_KEYS) {
      const due = key === 'expired'
        ? new Date(now) > new Date(sub.endDate)
        : Math.ceil((new Date(sub.endDate) - new Date(now)) / 86400000) === Number(key.replace('d', ''));
      const sentKey = `${dev.id}:${key}:${dayKey}`;
      if (due && !reminderSent.includes(sentKey)) {
        reminderSent = [...reminderSent, sentKey].slice(-200);
        notifications = [
          { id: uid('n'), farmerId: dev.farmerId, title: 'Subscription reminder', body: `${dev.name} subscription ${key === 'expired' ? 'has expired' : `expires in ${key.replace('d', '')} day(s)`}.`, severity: key === 'expired' ? 'critical' : 'warning', read: false, at: now },
          ...notifications,
        ];
      }
    }
  }

  // mock MoMo provider confirms pending payments older than 30s
  let payments = state.payments;
  let devices2 = devices;
  for (const p of payments) {
    if (p.status === PAYMENT_STATUS.PENDING && new Date(now) - new Date(p.createdAt) > 30000) {
      const ok = simulateMoMo(p).status === PAYMENT_STATUS.SUCCESSFUL;
      payments = payments.map((x) => (x.id === p.id ? { ...x, status: ok ? PAYMENT_STATUS.SUCCESSFUL : PAYMENT_STATUS.FAILED, providerConfirmed: ok, confirmedAt: now } : x));
      if (ok) {
        const plan = state.plans.find((pl) => pl.id === p.planId);
        const start = now;
        const end = plan ? addDays(start, plan.durationDays) : start;
        devices2 = devices2.map((d) => (d.id === p.deviceId ? { ...d, subscription: { planId: p.planId, status: 'active', startDate: start, endDate: end } } : d));
        notifications = [
          { id: uid('n'), farmerId: p.farmerId, title: 'Payment received', body: `Your RWF ${p.amount} payment was confirmed. Device unlocked.`, severity: 'info', read: false, at: now },
          ...notifications,
        ];
      }
    }
  }

  return {
    ...state, devices: devices2, payments, alerts, notifications, reminderSent,
  };
}

/* ------------------------------ provider ----------------------------- */

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { ...buildSeed(), reminderSent: [] };
}

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Live API client (null when VITE_IOT_API_URL is unset — simulation mode).
  const api = useMemo(() => (liveConfig.enabled ? createIotApi(liveConfig) : null), []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore quota errors */
    }
  }, [state]);

  useEffect(() => {
    if (import.meta.env.MODE === 'test') return undefined;
    const t = setInterval(() => dispatch({ type: 'TICK' }), 5000);
    return () => clearInterval(t);
  }, []);

  // Poll broodiinnox-api so every registered device reflects its real state
  // in EVERY page (Systems, Devices, Map, details…), exactly like Admin Live.
  useEffect(() => {
    if (!liveConfig.enabled || !api) return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await api.listDevices();
        if (cancelled) return;
        dispatch({
          type: 'LIVE_SYNC',
          devices: (data?.devices || []).map(apiDeviceToVm).filter(Boolean),
          at: new Date().toISOString(),
        });
      } catch {
        /* keep the last good overlay; Admin Live surfaces connectivity */
      }
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [api]);

  useEffect(() => {
    if (!state.toast) return undefined;
    const t = setTimeout(() => dispatch({ type: 'CLEAR_TOAST' }), 3600);
    return () => clearTimeout(t);
  }, [state.toast]);

  // Forward user actions that touch a real device to the hardware via the
  // API (register, targets, sensors, lock), best-effort with a toast on error.
  const dispatchLive = useCallback((action) => {
    dispatch(action);
    if (!liveConfig.enabled || !api) return;
    const st = stateRef.current;
    const toastErr = (err) =>
      dispatch({ type: 'TOAST', msg: `Live: ${err?.message || 'request failed'}`, kind: 'error' });
    if (action?.type === 'REGISTER_DEVICE') {
      const location = typeof action.location === 'string' ? action.location : action.location?.district || '';
      api.registerDevice({
        device_id: action.serial,
        name: action.name || action.serial,
        farmer_id: action.farmerId || 'dev',
        location,
      }).catch(toastErr);
      return;
    }
    if (action?.type === 'RENAME_DEVICE') {
      // Keep the API registration name in sync with the app (POST /api/devices
      // is an upsert), so Live Monitoring shows the SAME name as Systems.
      const dev = action.deviceId ? st.devices.find((d) => d.id === action.deviceId) : null;
      if (dev) {
        const loc = typeof dev.location === 'string' ? dev.location : dev.location?.district || '';
        api.registerDevice({
          device_id: dev.id,
          name: action.name,
          farmer_id: dev.farmerId || 'dev',
          location: loc,
        }).catch(toastErr);
      }
      return;
    }
    const dev = action?.deviceId ? st.devices.find((d) => d.id === action.deviceId) : null;
    const plan = liveCommandPlan(action, dev);
    for (const c of plan) {
      api.sendCommand(action.deviceId, c.command, c.value).catch(toastErr);
    }
  }, [api]);

  const value = useMemo(() => ({ state, dispatch: dispatchLive }), [state, dispatchLive]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  return useContext(StoreContext);
}

export { paymentVerified };
