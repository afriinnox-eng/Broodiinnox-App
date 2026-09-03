/**
 * Command building & validation — pure functions, no I/O.
 *
 * Every rule below mirrors the firmware's mqtt_callback() in
 * BROODIINNOX_V11.ino:
 *
 *   relay        "ON" | "OFF" | "AUTO"
 *   max_temp     integer > current min_temp and <= 50
 *   min_temp     integer >= 10 and < current max_temp
 *   total_days   integer 1..365
 *   sensor       "DS1:ON" .. "DS4:OFF"
 *   factory_reset "RESET"
 *   animal_preset "Chicken" | "Pig" | "Turkey" | "Duck"
 *   device_active "LOCKED" | "ACTIVE"          (never blocked by the lock)
 *   set_time     unix epoch seconds | "YYYY-MM-DD HH:MM:SS"
 *
 * While device_locked the firmware silently ignores every command except
 * device_active — so do we (we reject with 423 instead of silently
 * dropping, so the dashboard can tell the user why nothing happened).
 */
import {
  ANIMAL_PRESETS,
  BOUNDS,
  COMMANDS_BLOCKED_WHEN_LOCKED,
  CONTROL_TOPICS,
  DEFAULT_TOPIC_PREFIX,
  DEVICE_ACTIVE_MODES,
  DEVICE_ID_RE,
  FACTORY_RESET_PAYLOAD,
  RELAY_MODES,
  SENSOR_IDS,
} from './constants.js';

export function isValidDeviceId(deviceId) {
  return typeof deviceId === 'string' && DEVICE_ID_RE.test(deviceId);
}

/** Parse "26" => 26, reject non-integers and junk. */
function toInt(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return parseInt(value.trim(), 10);
  return NaN;
}

/** true when the payload can be safely length-checked (never exceeds the buffer). */
function fitsPayload(value) {
  return typeof value === 'string' && value.length <= 128;
}

function fail(command, error, rule) {
  return { ok: false, command, error, rule };
}

function ok(command, prefix, deviceId, payload, extra = {}) {
  const p = prefix || DEFAULT_TOPIC_PREFIX;
  return {
    ok: true,
    command,
    topic: `${p}/${deviceId}/control/${CONTROL_TOPICS[command]}`,
    payload,
    ...extra,
  };
}

/** Build & validate one control message. ctx: { locked, minTemp, maxTemp }. */
export function buildControlMessage(deviceId, command, value, ctx = {}) {
  const prefix = ctx.prefix;

  if (!isValidDeviceId(deviceId)) {
    return fail(command, `Invalid device id "${deviceId}"`, 'device id must match /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/');
  }
  if (!CONTROL_TOPICS[command]) {
    return fail(command, `Unknown command "${command}"`, `allowed: ${Object.keys(CONTROL_TOPICS).join(', ')}`);
  }
  if (COMMANDS_BLOCKED_WHEN_LOCKED.has(command) && ctx.locked) {
    return fail(command, `Device ${deviceId} is LOCKED — ${command} is refused by the firmware until unlocked`, 'device_active=ACTIVE must be sent first');
  }

  const locked = !!ctx.locked;

  switch (command) {
    case 'relay': {
      if (typeof value !== 'string') return fail(command, 'relay expects "ON", "OFF" or "AUTO"', 'one of ON|OFF|AUTO');
      const mode = value.toUpperCase();
      if (!RELAY_MODES.includes(mode)) return fail(command, `"${value}" is not a relay mode`, 'one of ON|OFF|AUTO');
      return ok(command, prefix, deviceId, mode, { mode });
    }

    case 'max_temp': {
      const v = toInt(value);
      const min = typeof ctx.minTemp === 'number' ? ctx.minTemp : null;
      if (Number.isNaN(v)) return fail(command, 'max_temp expects an integer in deg C', 'integer');
      if (v > BOUNDS.max_temp.upper) return fail(command, `max_temp ${v} exceeds firmware cap of ${BOUNDS.max_temp.upper}C`, `<= ${BOUNDS.max_temp.upper}`);
      if (min !== null && v <= min) return fail(command, `max_temp ${v} must stay above current min_temp ${min}C`, `> current min (${min})`);
      if (min === null && v < BOUNDS.min_temp.lower + 1) return fail(command, `max_temp ${v} leaves no room for min_temp`, `>= ${BOUNDS.min_temp.lower + 1}`);
      return ok(command, prefix, deviceId, String(v));
    }

    case 'min_temp': {
      const v = toInt(value);
      const max = typeof ctx.maxTemp === 'number' ? ctx.maxTemp : null;
      if (Number.isNaN(v)) return fail(command, 'min_temp expects an integer in deg C', 'integer');
      if (v < BOUNDS.min_temp.lower) return fail(command, `min_temp ${v} is below firmware floor of ${BOUNDS.min_temp.lower}C`, `>= ${BOUNDS.min_temp.lower}`);
      if (max !== null && v >= max) return fail(command, `min_temp ${v} must stay below current max_temp ${max}C`, `< current max (${max})`);
      return ok(command, prefix, deviceId, String(v));
    }

    case 'total_days': {
      const v = toInt(value);
      if (Number.isNaN(v)) return fail(command, 'total_days expects an integer', 'integer');
      if (v < BOUNDS.total_days.lower || v > BOUNDS.total_days.upper) {
        return fail(command, `total_days ${v} outside firmware range`, `${BOUNDS.total_days.lower}..${BOUNDS.total_days.upper}`);
      }
      return ok(command, prefix, deviceId, String(v));
    }

    case 'sensor': {
      if (typeof value !== 'string') return fail(command, 'sensor expects e.g. "DS1:ON"', 'DS1..DS4 : ON|OFF');
      const m = /^(DS[1-4]):(ON|OFF)$/i.exec(value.trim());
      if (!m) return fail(command, `"${value}" is not a sensor control`, 'DS1..DS4 : ON|OFF');
      return ok(command, prefix, deviceId, `${m[1].toUpperCase()}:${m[2].toUpperCase()}`, {
        sensor: m[1].toUpperCase(),
        sensorOn: m[2].toUpperCase() === 'ON',
      });
    }

    case 'factory_reset': {
      if (typeof value !== 'string' || value.trim().toUpperCase() !== FACTORY_RESET_PAYLOAD) {
        return fail(command, 'factory_reset expects the payload "RESET"', 'payload = RESET');
      }
      return ok(command, prefix, deviceId, FACTORY_RESET_PAYLOAD);
    }

    case 'animal_preset': {
      if (typeof value !== 'string') return fail(command, 'animal_preset expects a preset name', ANIMAL_PRESETS.join('|'));
      const hit = ANIMAL_PRESETS.find((n) => n.toLowerCase() === value.trim().toLowerCase());
      if (!hit) return fail(command, `"${value}" is not a preset`, ANIMAL_PRESETS.join('|'));
      return ok(command, prefix, deviceId, hit, { preset: hit });
    }

    case 'device_active': {
      if (typeof value !== 'string') return fail(command, 'device_active expects "LOCKED" or "ACTIVE"', 'one of LOCKED|ACTIVE');
      const mode = value.toUpperCase();
      if (!DEVICE_ACTIVE_MODES.includes(mode)) return fail(command, `"${value}" is not a device_active mode`, 'one of LOCKED|ACTIVE');
      return ok(command, prefix, deviceId, mode, { locked: mode === 'LOCKED' });
    }

    case 'set_time': {
      if (typeof value !== 'string' || !value.trim()) return fail(command, 'set_time expects a value', "unix epoch seconds | 'now' | 'YYYY-MM-DD HH:MM:SS'");
      const raw = value.trim();

      // "now" convenience => current unix time in seconds
      if (raw.toLowerCase() === 'now') {
        return ok(command, prefix, deviceId, String(Math.floor(Date.now() / 1000)), { setTimeAt: Date.now() });
      }

      // Unix epoch seconds (digits only) — same branch as the firmware
      if (/^\d+$/.test(raw)) {
        const epoch = parseInt(raw, 10);
        const d = new Date(epoch * 1000);
        if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2000 || d.getUTCFullYear() > 2100) {
          return fail(command, `epoch ${raw} does not map to a plausible year (2000-2100)`, 'seconds since epoch');
        }
        return ok(command, prefix, deviceId, String(epoch), { setTimeAt: d.getTime() });
      }

      // Text date/time — firmware parses "YYYY-MM-DD HH:MM:SS" (also T)
      const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
      if (!m) return fail(command, `cannot parse "${raw}"`, "unix epoch seconds | 'now' | 'YYYY-MM-DD HH:MM:SS'");
      const [, y, mo, d, h, mi, se] = m;
      const sec = se || '00';
      const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec));
      const valid = !Number.isNaN(dt.getTime())
        && +y >= 2000 && +y <= 2100
        && +mo >= 1 && +mo <= 12
        && +d >= 1 && +d <= 31
        // calendar truth: "2026-02-30" must NOT roll over into March
        && dt.getUTCFullYear() === +y
        && dt.getUTCMonth() === +mo - 1
        && dt.getUTCDate() === +d;
      if (!valid) return fail(command, `"${raw}" is not a valid calendar date`, 'year 2000-2100');
      // Firmware wants "YYYY-MM-DD HH:MM:SS"; device RTC is local time, so we
      // pass the wall-clock string through unchanged (not converted to UTC).
      const norm = `${y}-${mo}-${d} ${h}:${mi}:${sec}`;
      return ok(command, prefix, deviceId, norm, { setTimeAt: dt.getTime() });
    }

    default:
      return fail(command, `Unhandled command "${command}"`, 'internal');
  }
}

/** Convenience used by tests: full control message for a fresh unlocked device. */
export function buildMessage(deviceId, command, value, ctx) {
  return buildControlMessage(deviceId, command, value, { prefix: '', ...ctx });
}

export { fitsPayload, toInt };
