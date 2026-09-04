/**
 * Live IoT data source for pages.
 *
 * The SPA has two modes:
 *   - Simulation (default): seeded demo data ticking in the store — no env
 *     vars needed, everything works offline.
 *   - Live: when VITE_IOT_API_URL is set at build time, useLiveDevices()
 *     polls broodiinnox-api and returns REAL device state mapped through
 *     apiDeviceToVm. Simulation is untouched when the env var is absent.
 */
import { useEffect, useState } from 'react';
import { apiDeviceToVm, createIotApi, resolveIotConfig } from './iot.js';
import { ANIMALS, ANIMAL_KEYS } from './presets.js';

/** Resolved once per build; reading import.meta.env is not testable at runtime. */
export const liveConfig = resolveIotConfig(import.meta.env);

export function useLiveDevices({ intervalMs = 5000 } = {}) {
  const [snapshot, setSnapshot] = useState(() => ({
    live: liveConfig.enabled,
    loading: liveConfig.enabled,
    devices: [],
    error: null,
    updatedAt: null,
  }));

  useEffect(() => {
    if (!liveConfig.enabled) return undefined;
    const api = createIotApi(liveConfig);
    let cancelled = false;

    const tick = async () => {
      try {
        const data = await api.listDevices();
        if (cancelled) return;
        setSnapshot({
          live: true,
          loading: false,
          devices: (data?.devices || []).map(apiDeviceToVm).filter(Boolean),
          error: null,
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        if (cancelled) return;
        setSnapshot((s) => ({
          ...s,
          loading: false,
          error: err?.message || String(err),
          updatedAt: new Date().toISOString(),
        }));
      }
    };

    tick();
    const timer = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [intervalMs]);

  return snapshot;
}

/**
 * Status of a live device VM, mirroring how the simulation derives status:
 * locked wins, failsafe is critical, a sensor fault is a warning, otherwise
 * online only while lastSeenAt is under 15 minutes old.
 */
export function liveVmStatus(vm, nowIso) {
  if (!vm || !vm.id) return 'offline';
  if (vm.locked) return 'locked';
  if (vm.failsafe) return 'critical';
  if (vm.sensorError || vm.mismatchError) return 'warning';
  if (!vm.online) return 'offline';
  const last = vm.lastSeenAt ? new Date(vm.lastSeenAt).getTime() : 0;
  const now = new Date(nowIso).getTime();
  if (!last || now - last > 15 * 60000) return 'offline';
  return 'online';
}

/**
 * Canonical display name shared by every page. A custom name the user set
 * in the app (different from the serial) wins over the API registration
 * name, so Admin Live, Systems and Devices always agree; otherwise the API
 * name is used, then the device id.
 */
export function deviceDisplayName(storeDevice, vm) {
  if (storeDevice && typeof storeDevice.name === 'string' && storeDevice.name.trim()
    && storeDevice.name !== storeDevice.serial) {
    return storeDevice.name;
  }
  if (vm && typeof vm.name === 'string' && vm.name.trim()) return vm.name;
  if (storeDevice && typeof storeDevice.name === 'string' && storeDevice.name.trim()) return storeDevice.name;
  return (vm && vm.id) || (storeDevice && storeDevice.id) || '';
}

/* ------------------------------------------------------------------ */
/* Store overlay: real API device state everywhere in the app          */
/* ------------------------------------------------------------------ */

/** Nearest animal preset for a live (min,max) target band — cosmetic only. */
export function nearestAnimal(min, max) {
  let best = ANIMAL_KEYS[0];
  let bestD = Infinity;
  for (const k of ANIMAL_KEYS) {
    const d = Math.abs((min ?? 0) - ANIMALS[k].baseMin) + Math.abs((max ?? 0) - ANIMALS[k].baseMax);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/**
 * Build a full store-shaped device from a live API VM. Subscription is a
 * non-expiring placeholder so the mock UI does not invent a business lock;
 * the REAL lock (firmware device_active / subscription kill-switch) is
 * carried by `manualLock` <- vm.locked and comes back from the API.
 */
export function storeDeviceFromVm(vm, nowIso) {
  if (!vm || !vm.id) return null;
  const day = vm.day !== null && vm.day !== undefined && vm.day >= 1 ? vm.day : 1;
  const durationDays = Math.max(vm.totalDays !== null && vm.totalDays !== undefined ? vm.totalDays : 30, day);
  const start = new Date(nowIso);
  start.setDate(start.getDate() - (day - 1));
  const min = vm.minTemp;
  const max = vm.maxTemp;
  const sensors = (vm.sensors || []).map((s) => ({
    id: s.id,
    enabled: !!s.enabled,
    lastReading: s.lastReading,
    health: s.health === 'err' ? 'err' : 'ok',
  }));
  const yearMs = 365 * 86400000;
  return {
    id: vm.id,
    serial: vm.id,
    name: vm.name || vm.id,
    farmerId: null,
    firmware: 'V11 (live)',
    installedAt: nowIso,
    location: { district: '—', sector: '—', lat: 0, lng: 0 },
    baseMin: min !== null && min !== undefined ? min : 35,
    baseMax: max !== null && max !== undefined ? max : 37,
    safetyFloor: 20,
    batch: {
      animal: nearestAnimal(min, max),
      status: 'running',
      startDate: start.toISOString(),
      durationDays,
      count: 0,
      synth: true, // placeholder derived from the API row, not a user-started batch
    },
    sensors,
    heaterOn: !!vm.heaterOn,
    manual: !!vm.manual,
    lastSeen: vm.lastSeenAt || nowIso,
    subscription: {
      planId: null,
      status: 'active',
      startDate: nowIso,
      endDate: new Date(new Date(nowIso).getTime() + yearMs).toISOString(),
    },
    manualLock: !!vm.locked,
    manualStatus: null,
    live: true,
  };
}

/**
 * Merge one live API VM into an existing store device. Telemetry always
 * comes from the real device; meta the user set locally (farmer, custom
 * name, location, an active paid plan) is preserved.
 */
export function overlayLiveDevice(device, vm, nowIso) {
  if (!device || !vm || !vm.id || device.id !== vm.id) return device;
  const live = storeDeviceFromVm(vm, nowIso);
  if (!live) return device;
  const keepName = device.name && device.name !== device.serial && device.name !== device.id ? device.name : live.name;
  const keepSub = device.subscription && device.subscription.planId ? device.subscription : live.subscription;
  // A batch the user started/ended (or an explicit ended state) is product
  // state — the live poll must NOT re-synthesize it as a fresh "running"
  // batch, otherwise End/Start batch would appear to do nothing.
  const userBatch = device.batch && device.batch.synth !== true;
  const endedBatch = device.batch && device.batch.status === 'ended';
  const keepBatch = userBatch || endedBatch;
  return {
    ...device,
    ...live,
    id: device.id,
    serial: device.serial || device.id,
    name: keepName,
    farmerId: device.farmerId !== undefined && device.farmerId !== null ? device.farmerId : live.farmerId,
    location: device.location && device.location.district && device.location.district !== '—'
      ? device.location
      : live.location,
    subscription: keepSub,
    batch: keepBatch ? device.batch : live.batch,
    manualLock: !!vm.locked,
    live: true,
  };
}

/**
 * Map a store action onto firmware commands for a LIVE device. Returns []
 * for non-live devices and for actions that need no hardware change. Rules
 * mirror broodiinnox-api/lib/commands.js so the server accepts them.
 */
export function liveCommandPlan(action, device) {
  if (!device || device.live !== true) return [];
  if (!action || typeof action.type !== 'string') return [];
  switch (action.type) {
    case 'SET_TARGETS': {
      const { min, max } = action;
      const out = [];
      const vMin = typeof min === 'number' ? min : NaN;
      const vMax = typeof max === 'number' ? max : NaN;
      if (Number.isFinite(vMax) && vMax >= 11 && vMax <= 50 && vMax !== device.baseMax) {
        out.push({ command: 'max_temp', value: String(vMax) });
      }
      if (Number.isFinite(vMin) && vMin >= 10 && vMin <= 49 && vMin !== device.baseMin) {
        out.push({ command: 'min_temp', value: String(vMin) });
      }
      // max_temp must land before min_temp (server checks min < current max)
      out.sort((a, b) => (a.command === 'max_temp' ? -1 : 1));
      return out;
    }
    case 'SET_SENSOR': {
      const id = Number(action.sensorId);
      if (id < 1 || id > 4) return [];
      return [{ command: 'sensor', value: `DS${id}:${action.enabled ? 'ON' : 'OFF'}` }];
    }
    case 'LOCK_DEVICE':
      return [{ command: 'device_active', value: action.lock ? 'LOCKED' : 'ACTIVE' }];
    case 'SYNC_TIME':
      // Sync the device RTC to "now" — the API expands it to epoch seconds.
      return [{ command: 'set_time', value: 'now' }];
    case 'RESTART_DEVICE':
      // Real remote reboot: firmware subscribes to control/restart and the
      // API accepts the RESTART payload (clean modem power-down, ESP reboot).
      return [{ command: 'restart', value: 'RESTART' }];
    default:
      return [];
  }
}
