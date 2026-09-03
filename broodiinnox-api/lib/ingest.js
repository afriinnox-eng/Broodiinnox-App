/**
 * Ingest: parse raw MQTT messages from the firmware into normalized state.
 *
 * The firmware publishes three shapes on `.../data` and `.../status`:
 *   data   — full snapshot JSON (safe_publish_sensor_data), every ~5 s
 *   status — light JSON (safe_publish_status / safe_publish_online_status)
 *   LWT    — the literal string "offline" retained by the broker when the
 *            device dies (mqttConnect sets willMessage = "offline")
 * plus a plain retained "online"/"offline" status message on reconnect.
 *
 * Parser is pure & defensive: any JSON field that fails to validate becomes
 * null/false rather than crashing the bridge. The firmware encodes a missing
 * average temperature as -999.0 — we map that back to null.
 */

function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function bool(v) {
  if (typeof v === 'boolean') return v;
  if (v === 'ON' || v === 'MANUAL' || v === 1 || v === '1' || v === 'true') return true;
  if (v === 'OFF' || v === 'AUTO' || v === 0 || v === '0' || v === 'false') return false;
  return null;
}

function temp(v) {
  const n = num(v);
  if (n === null) return null;
  // firmware sends -999 for "no valid average"; anything outside a plausible
  // brooding range is a broken reading and must not poison history/control
  if (n <= -900 || n < -55 || n > 125) return null;
  return n;
}

/** Pull the device id out of "BROODIINNOX/<id>/data" (topic[1]). */
export function deviceIdFromTopic(topic) {
  if (typeof topic !== 'string') return null;
  const parts = topic.split('/');
  return parts.length >= 2 && parts[1] ? parts[1] : null;
}

/** Normalize a firmware `/data` snapshot. Returns null for malformed input. */
export function parseDataMessage(raw) {
  let obj;
  try {
    obj = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(Buffer.from(raw).toString('utf8'));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  const day = num(obj.day);
  const total_days = num(obj.total_days);

  return {
    kind: 'data',
    device_id: typeof obj.device_id === 'string' ? obj.device_id : null,
    relayOn: bool(obj.relay_state) ?? false,
    manual: bool(obj.manual_control) ?? false,
    day: day !== null ? Math.max(0, Math.trunc(day)) : null,
    total_days: total_days !== null ? Math.max(1, Math.min(365, Math.trunc(total_days))) : null,
    max_temp: num(obj.max_temp),
    min_temp: num(obj.min_temp),
    ave_temp: temp(obj.ave_temp),
    temp1: temp(obj.sensor1),
    temp2: temp(obj.sensor2),
    temp3: temp(obj.sensor3),
    temp4: temp(obj.sensor4),
    s1_enabled: bool(obj.s1_enabled) ?? true,
    s2_enabled: bool(obj.s2_enabled) ?? true,
    s3_enabled: bool(obj.s3_enabled) ?? true,
    s4_enabled: bool(obj.s4_enabled) ?? true,
    failsafe_mode: bool(obj.failsafe_mode) ?? false,
    sensor_error: bool(obj.sensor_error) ?? false,
    mismatch_error: bool(obj.mismatch_error) ?? false,
    device_locked: bool(obj.device_locked) ?? false,
    signal_quality: (() => {
      const n = num(obj.signal_quality);
      return n === null ? null : Math.max(0, Math.min(31, Math.trunc(n)));
    })(),
    weekly_reduce_enabled: bool(obj.weekly_reduce_enabled),
    weekly_reduce_deg: num(obj.weekly_reduce_deg),
    last_reduction_day: num(obj.last_reduction_day),
    error: typeof obj.error === 'string' ? obj.error : null,
    device_ts: num(obj.timestamp), // device RTC unix (seconds) — may be wrong
  };
}

/** Normalize a firmware `/status` message (JSON or the LWT "offline" string). */
export function parseStatusMessage(raw) {
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);

  // Retained LWT from mqttConnect(): literally "offline"
  if (text.trim().toLowerCase() === 'offline') {
    return { kind: 'offline' };
  }

  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { kind: 'unknown', raw: text.slice(0, 64) };
  }
  if (!obj || typeof obj !== 'object') return { kind: 'unknown', raw: text.slice(0, 64) };

  const st = typeof obj.status === 'string' ? obj.status.toLowerCase() : null;
  return {
    kind: 'status',
    device_id: typeof obj.device_id === 'string' ? obj.device_id : null,
    online: st !== 'offline',
    locked: st === 'locked' || bool(obj.device_locked) === true,
    relayOn: st === 'locked' ? false : bool(obj.relay_state),
    manual: bool(obj.manual_control),
    day: num(obj.day),
    total_days: num(obj.total_days),
    max_temp: num(obj.max_temp),
    min_temp: num(obj.min_temp),
    ave_temp: temp(obj.ave_temp),
    failsafe_mode: bool(obj.failsafe),
    signal_quality: (() => {
      const n = num(obj.signal_quality);
      return n === null ? null : Math.max(0, Math.min(31, Math.trunc(n)));
    })(),
    mqtt_connected: bool(obj.mqtt_connected),
    sensors_ok: bool(obj.sensors_ok),
    device_ts: num(obj.timestamp),
  };
}

/** Route a raw topic+payload pair to a typed event. */
export function ingestMessage(topic, raw) {
  const id = deviceIdFromTopic(topic);
  if (!id) return null;
  const lower = topic.toLowerCase();
  if (lower.endsWith('/data')) {
    const d = parseDataMessage(raw);
    if (!d) return null;
    if (!d.device_id) d.device_id = id;
    return { ...d, deviceId: d.device_id || id, topic };
  }
  if (lower.endsWith('/status')) {
    const s = parseStatusMessage(raw);
    return { ...s, deviceId: s.device_id || id, topic };
  }
  return null;
}

/** Normalize a reading row for storage (data events only). */
export function toReadingRow(ev) {
  if (ev.kind !== 'data') return null;
  return {
    device_id: ev.deviceId,
    device_ts: ev.device_ts ?? null,
    temp1: ev.temp1, temp2: ev.temp2, temp3: ev.temp3, temp4: ev.temp4,
    ave_temp: ev.ave_temp,
    relay_state: ev.relayOn,
    manual_control: ev.manual,
    day: ev.day, total_days: ev.total_days,
    max_temp: ev.max_temp, min_temp: ev.min_temp,
    failsafe_mode: ev.failsafe_mode,
    sensor_error: ev.sensor_error,
    mismatch_error: ev.mismatch_error,
    device_locked: ev.device_locked,
    signal_quality: ev.signal_quality,
    error: ev.error,
  };
}
