/**
 * Broodiinnox live-mode IoT client + adapters.
 *
 * Bridges the dashboard (this SPA) and the hardware backend
 * (broodiinnox-api: Next.js + CockroachDB + MQTT bridge). The dashboard keeps
 * working fully offline in simulation mode; the moment VITE_IOT_API_URL is set
 * (and points at a running broodiinnox-api), this module lets pages read real
 * device state, send firmware-validated commands, and reconcile subscription
 * locks with the physical units.
 *
 * Every function is pure or fetch-injectable so it can be tested without a
 * server (src/tests/iot.test.js). No React here.
 *
 * Configuration (see .env / docs):
 *   VITE_IOT_API_URL      e.g. http://localhost:3001
 *   VITE_IOT_API_KEY      matches API_KEYS on the server (optional in dev)
 *   VITE_IOT_TIMEOUT_MS   request timeout, default 8000
 */

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

export function resolveIotConfig(env) {
  const e = env || {};
  const rawUrl = String(e.VITE_IOT_API_URL || e.VITE_API_URL || '').trim();
  const baseUrl = rawUrl.replace(/\/+$/, ''); // tolerate a trailing slash
  const apiKey = String(e.VITE_IOT_API_KEY || e.VITE_API_KEY || '').trim();
  const parsed = Number.parseInt(String(e.VITE_IOT_TIMEOUT_MS || '8000'), 10);
  const timeoutMs = Number.isFinite(parsed) && parsed > 0 ? parsed : 8000;
  const enabled = /^https?:\/\/[^/]+/.test(baseUrl);
  return { enabled, baseUrl: enabled ? baseUrl : '', apiKey, timeoutMs };
}

/* ------------------------------------------------------------------ */
/* Errors + client                                                     */
/* ------------------------------------------------------------------ */

export class IotApiError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.name = 'IotApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Create an API client. `fetchImpl` is injectable for tests.
 * All paths must begin with "/" and are resolved against baseUrl.
 */
export function createIotApi({ baseUrl, apiKey = '', timeoutMs = 8000, fetchImpl } = {}) {
  if (!/^https?:\/\/[^/]+/.test(baseUrl)) {
    throw new IotApiError('iot API is not configured (set VITE_IOT_API_URL)', { code: 'not-configured' });
  }
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new IotApiError('no fetch implementation available', { code: 'network' });
  }

  async function request(path, { method = 'GET', body } = {}) {
    if (typeof path !== 'string' || !path.startsWith('/')) {
      throw new IotApiError('iot request path must start with "/"', { code: 'invalid-path' });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let data = null;
      if (text) {
        try { data = JSON.parse(text); } catch { data = text; }
      }
      if (!res.ok) {
        const msg = data && typeof data === 'object' && data.error ? data.error : `HTTP ${res.status}`;
        throw new IotApiError(msg, { status: res.status });
      }
      return data;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new IotApiError(`iot request timed out after ${timeoutMs}ms`, { code: 'timeout' });
      }
      if (err instanceof IotApiError) throw err;
      throw new IotApiError(`iot request failed: ${err.message}`, { code: 'network' });
    } finally {
      clearTimeout(timer);
    }
  }

  const enc = (id) => encodeURIComponent(id);
  return {
    baseUrl,
    request,
    health: () => request('/api/health'),
    listDevices: () => request('/api/devices'),
    getDevice: (id) => request(`/api/devices/${enc(id)}`),
    readings: (id, { limit = 300, from, to } = {}) => {
      const q = new URLSearchParams();
      if (Number.isFinite(limit)) q.set('limit', String(limit));
      if (from) q.set('from', from);
      if (to) q.set('to', to);
      const qs = q.toString();
      return request(`/api/devices/${enc(id)}/readings${qs ? `?${qs}` : ''}`);
    },
    sendCommand: (id, command, value) =>
      request(`/api/devices/${enc(id)}/commands`, { method: 'POST', body: { command, value } }),
    registerDevice: (body) => request('/api/devices', { method: 'POST', body }),
    audit: (id, { limit = 100 } = {}) =>
      request(`/api/devices/${enc(id)}/audit?limit=${limit}`),
    alerts: ({ deviceId, limit = 200 } = {}) => {
      const q = new URLSearchParams();
      if (deviceId) q.set('deviceId', deviceId);
      q.set('limit', String(limit));
      return request(`/api/alerts?${q.toString()}`);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Adapters: API row <-> dashboard model                               */
/* ------------------------------------------------------------------ */

export const API_SENSOR_KEYS = ['temp1', 'temp2', 'temp3', 'temp4'];
export const API_ENABLE_KEYS = ['s1_enabled', 's2_enabled', 's3_enabled', 's4_enabled'];

function cleanNum(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function asBool(v) {
  if (typeof v === 'boolean') return v;
  if (v === true || v === 1 || v === 'true' || v === 'ON') return true;
  if (v === false || v === 0 || v === 'false' || v === 'OFF') return false;
  return null;
}

/**
 * Map a broodiinnox-api device row (snake_case, from Cockroach/state) to the
 * dashboard's sensor model. Accepts both the raw row and the {device: row}
 * envelope. Unknown/extra fields are ignored; every output field has a
 * defined type or null.
 */
export function apiDeviceToVm(row) {
  const r = (row && typeof row === 'object' && row.device) ? row.device : row;
  if (!r || typeof r !== 'object') return null;

  const temps = API_SENSOR_KEYS.map((k) => {
    const v = cleanNum(r[k]);
    return v !== null && v >= -55 && v <= 125 ? v : null;
  });
  const enables = API_ENABLE_KEYS.map((k, i) => {
    const b = asBool(r[k]);
    return b !== null ? b : temps[i] !== null; // unknown enable: infer from a live reading
  });

  const maxTemp = cleanNum(r.max_temp);
  const minTemp = cleanNum(r.min_temp);
  const day = cleanNum(r.day);
  const totalDays = cleanNum(r.total_days);
  const lastSeenAt = r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null;

  return {
    id: String(r.device_id ?? r.serial ?? ''),
    name: (typeof r.name === 'string' && r.name) ? r.name : String(r.device_id ?? r.serial ?? ''),
    online: asBool(r.online) === true,
    stale: asBool(r.stale) === true,
    locked: asBool(r.device_locked) === true,
    relayOn: asBool(r.relay_state) === true,
    manual: asBool(r.manual_control) === true,
    failsafe: asBool(r.failsafe_mode) === true,
    sensorError: asBool(r.sensor_error) === true,
    mismatchError: asBool(r.mismatch_error) === true,
    signalQuality: cleanNum(r.signal_quality),
    aveTemp: cleanNum(r.ave_temp),
    temps,
    sensors: temps.map((t, i) => ({ id: i + 1, enabled: enables[i], lastReading: t, health: t === null ? 'err' : 'ok' })),
    heaterOn: asBool(r.relay_state) === true,
    maxTemp,
    minTemp,
    day: day !== null ? Math.max(0, Math.trunc(day)) : null,
    totalDays: totalDays !== null ? Math.max(1, Math.min(365, Math.trunc(totalDays))) : null,
    lastSeenAt,
  };
}

/* ------------------------------------------------------------------ */
/* Command vocabulary (dashboard intent -> broodiinnox-api commands)   */
/* ------------------------------------------------------------------ */

/**
 * Turn a requested target band into firmware commands. The API server
 * re-validates against the firmware's own rules; here we fail fast and
 * atomically (no partial command set on invalid input).
 * Returns { commands: [{command, value}], errors: [string] }.
 */
export function targetsToCommands({ min, max } = {}) {
  const errors = [];
  const minNum = cleanNum(min);
  const maxNum = cleanNum(max);

  if (minNum === null) errors.push('min_temp must be a number');
  if (maxNum === null) errors.push('max_temp must be a number');
  if (errors.length) return { commands: [], errors };

  const minI = Math.trunc(minNum);
  const maxI = Math.trunc(maxNum);
  if (minI < 10) errors.push(`min_temp ${minI} is below the firmware floor of 10C`);
  if (maxI > 50) errors.push(`max_temp ${maxI} exceeds the firmware cap of 50C`);
  if (minI >= maxI) errors.push(`min_temp ${minI} must stay below max_temp ${maxI}`);

  if (errors.length) return { commands: [], errors };
  return {
    commands: [
      { command: 'min_temp', value: minI },
      { command: 'max_temp', value: maxI },
    ],
    errors: [],
  };
}

/**
 * Toggle one probe (1..4) on/off. Returns a single firmware command or null
 * for an out-of-range sensor index.
 */
export function sensorToggleCommand(sensor, on) {
  const idx = Number(sensor);
  if (!Number.isInteger(idx) || idx < 1 || idx > 4) return null;
  return { command: 'sensor', value: `DS${idx}:${on ? 'ON' : 'OFF'}` };
}

/**
 * Subscription-lock reconciliation: what to send so the physical device's
 * lock state converges on the business state. Idempotent — no command when
 * the device already matches (or when the current state is unknown and the
 * desired state is already ACTIVE, so we never spam unlocks).
 */
export function lockCommand(currentLocked, wantLocked) {
  if (wantLocked && currentLocked !== true) return { command: 'device_active', value: 'LOCKED' };
  if (!wantLocked && currentLocked === false) return null;
  if (!wantLocked && currentLocked === null) return null; // never seen: assume free
  if (!wantLocked) return { command: 'device_active', value: 'ACTIVE' };
  return null;
}

/**
 * Convenience: full reconciliation list for a fleet. Each input:
 * { deviceId, currentLocked (bool|null), wantLocked (bool) }.
 * Output: [{ deviceId, command: {command,value} | null, reason }].
 */
export function reconcileLockPlan(units) {
  return (units || []).map((u) => {
    const cmd = lockCommand(u.currentLocked, u.wantLocked);
    return {
      deviceId: u.deviceId,
      command: cmd,
      reason: cmd
        ? (cmd.value === 'LOCKED' ? 'subscription inactive -> lock unit' : 'subscription active -> unlock unit')
        : 'already in desired state',
    };
  });
}
