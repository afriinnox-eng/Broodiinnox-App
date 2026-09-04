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
