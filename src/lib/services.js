/**
 * Pure business logic for the Broodiinnox platform.
 * No React, no IO — every function here is unit-tested (src/tests/services.test.js)
 * and is the single source of truth the store and UI build on.
 */
import { ANIMALS } from './presets.js';
import { DAY_MS, diffDays, daysUntil, fmtDate, startOfDay } from './time.js';
import { coverageFor, termById } from './subscriptions.js';

export const DEVICE_STATUS = { ONLINE: 'online', OFFLINE: 'offline', WARNING: 'warning', CRITICAL: 'critical', LOCKED: 'locked' };
export const SEVERITY = { CRITICAL: 'critical', WARNING: 'warning', INFO: 'info' };
export const PAYMENT_STATUS = { PENDING: 'pending', SUCCESSFUL: 'successful', FAILED: 'failed', CANCELLED: 'cancelled', REFUNDED: 'refunded' };
export const ALERT_KEYS = {
  TEMP_HIGH: 'temp_high', TEMP_LOW: 'temp_low', SENSOR_FAULT: 'sensor_fault',
  DEVICE_OFFLINE: 'device_offline', SUB_EXPIRING: 'sub_expiring', SUB_EXPIRED: 'sub_expired',
  DEVICE_LOCKED: 'device_locked', SUB_SHORT_OF_BATCH: 'sub_short_of_batch',
  SUB_LAST_BATCH: 'sub_last_batch', BATCH_ENDING: 'batch_ending', BATCH_ENDED: 'batch_ended',
  MAINTENANCE_DUE: 'maintenance_due', POWER_LOSS: 'power_loss',
};

let seq = 0;
export function uid(prefix = 'id') {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/* ------------------------------ batches ------------------------------ */

/** Day of the current brooding cycle: 1 on the start date, clamped to [1, duration]. */
export function batchDay(startIso, durationDays, nowIso) {
  const elapsed = diffDays(startIso, nowIso) + 1;
  return Math.min(Math.max(elapsed, 1), Math.max(durationDays, 1));
}

/** Days left in the cycle: 0 once the cycle has finished. */
export function batchRemaining(startIso, durationDays, nowIso) {
  return Math.max(0, durationDays - batchDay(startIso, durationDays, nowIso));
}

/* --------------------------- temperatures --------------------------- */

/** Weekly age-based step-down of the target range (1 °C every 7 days). */
export function stepDownTargets(baseMin, baseMax, day, every = 7, drop = 1) {
  const steps = Math.max(0, Math.floor((Math.max(day, 1) - 1) / every));
  return { min: baseMin - steps * drop, max: baseMax - steps * drop };
}

/** Hysteresis: heater on below min, off above max, otherwise hold previous state. */
export function heaterDecision(avg, minT, maxT, prev) {
  if (avg === null || avg === undefined) return true; // failsafe: no readings -> heat
  if (avg < minT) return true;
  if (avg > maxT) return false;
  return !!prev;
}

export function avgTemp(sensors) {
  const vals = (sensors || []).filter((s) => s.enabled && typeof s.lastReading === 'number');
  if (!vals.length) return null;
  return vals.reduce((a, s) => a + s.lastReading, 0) / vals.length;
}

export function allSensorsFailed(sensors) {
  return !(sensors || []).some((s) => s.enabled && typeof s.lastReading === 'number');
}

/* ------------------------- subscription & lock ----------------------- */

export function subscriptionState(endIso, nowIso) {
  if (!endIso) return 'none';
  return new Date(nowIso) <= new Date(endIso) ? 'active' : 'expired';
}

/** A device is locked when its linked subscription is not active (or an admin locked it). */
export function deviceLocked(device, nowIso) {
  if (device?.manualLock) return true;
  const sub = device?.subscription;
  if (!sub || sub.status !== 'active') return true;
  return subscriptionState(sub.endDate, nowIso) === 'expired';
}

/** Locked but dangerously cold: heater may still run (safety overrides subscription). */
export function emergencyHeatNeeded(avg, safetyFloor) {
  return avg !== null && avg !== undefined && avg < (safetyFloor ?? 20);
}

/** Whether a farmer is allowed to change settings / issue commands. */
export function controlAllowed(device, nowIso, avg) {
  if (!deviceLocked(device, nowIso)) return true;
  return emergencyHeatNeeded(avg, device?.safetyFloor ?? 20);
}

/** Payments only unlock anything once the provider confirmed them. */
export function paymentVerified(payment) {
  return !!payment && payment.status === PAYMENT_STATUS.SUCCESSFUL && payment.providerConfirmed === true;
}

/** Which expiry reminders are due today (7/3/1 days before, and on the day). */
export function expiryReminders(endIso, nowIso) {
  if (!endIso) return [];
  const d = daysUntil(endIso, nowIso);
  const out = [];
  if (d === 7) out.push('7d');
  if (d === 3) out.push('3d');
  if (d === 1) out.push('1d');
  if (d <= 0) out.push('expired');
  return out;
}

/* ----------------------------- device status ------------------------- */

export function deviceStatus(device, nowIso) {
  if (deviceLocked(device, nowIso)) return DEVICE_STATUS.LOCKED;
  if (device.manualStatus) return device.manualStatus;
  if (!device.lastSeen) return DEVICE_STATUS.OFFLINE;
  const ageMin = (new Date(nowIso) - new Date(device.lastSeen)) / 60000;
  if (ageMin > 15) return DEVICE_STATUS.OFFLINE;
  if (allSensorsFailed(device.sensors)) return DEVICE_STATUS.CRITICAL;
  const avg = avgTemp(device.sensors);
  const { min, max } = stepDownTargets(device.baseMin, device.baseMax, device.batchDay);
  if (avg !== null && (avg < min - 1.5 || avg > max + 1.5)) return DEVICE_STATUS.WARNING;
  return DEVICE_STATUS.ONLINE;
}

/* -------------------------------- alerts ----------------------------- */

/**
 * Alerts that describe the CURRENT state of a device. The store dedupes by
 * `key` so a condition does not spam the feed.
 */
export function generateAlerts(device, nowIso) {
  const out = [];
  const avg = avgTemp(device.sensors);
  const { min, max } = stepDownTargets(device.baseMin, device.baseMax, device.batchDay);
  const locked = deviceLocked(device, nowIso);
  const sub = device.subscription;
  // A system the user switched off is not holding a target band: its drifting
  // temperature is the expected result of that command, not a new alarm.
  const switchedOff = device.systemOn === false;

  if (!switchedOff && avg !== null && avg > max) {
    out.push({ key: ALERT_KEYS.TEMP_HIGH, severity: SEVERITY.WARNING, message: `Temperature ${avg.toFixed(1)}°C is above the ${max}°C target.` });
  }
  if (!switchedOff && avg !== null && avg < min) {
    out.push({ key: ALERT_KEYS.TEMP_LOW, severity: SEVERITY.WARNING, message: `Temperature ${avg.toFixed(1)}°C is below the ${min}°C target.` });
  }
  if (allSensorsFailed(device.sensors)) {
    out.push({ key: ALERT_KEYS.SENSOR_FAULT, severity: SEVERITY.CRITICAL, message: 'All sensors failed — failsafe heating engaged.' });
  } else if ((device.sensors || []).some((s) => s.enabled && typeof s.lastReading !== 'number')) {
    out.push({ key: ALERT_KEYS.SENSOR_FAULT, severity: SEVERITY.WARNING, message: 'One or more sensors are not responding.' });
  }
  if (!device.lastSeen || (new Date(nowIso) - new Date(device.lastSeen)) / 60000 > 15) {
    out.push({ key: ALERT_KEYS.DEVICE_OFFLINE, severity: SEVERITY.CRITICAL, message: 'Device has no cellular signal.' });
  }
  if (locked) {
    out.push({ key: ALERT_KEYS.DEVICE_LOCKED, severity: SEVERITY.CRITICAL, message: 'Subscription expired — device locked.' });
  } else if (sub) {
    const reminders = expiryReminders(sub.endDate, nowIso);
    if (reminders.includes('expired')) {
      out.push({ key: ALERT_KEYS.SUB_EXPIRED, severity: SEVERITY.CRITICAL, message: 'Subscription expired.' });
    } else if (reminders.includes('7d') || reminders.includes('3d') || reminders.includes('1d')) {
      out.push({
        key: ALERT_KEYS.SUB_EXPIRING, severity: SEVERITY.WARNING,
        message: `Subscription expires in ${reminders[0]}. Renew to keep the device unlocked.`,
      });
    }
  }
  if (device.batch) {
    const rem = batchRemaining(device.batch.startDate, device.batch.durationDays, nowIso);
    if (rem <= 0) {
      out.push({ key: ALERT_KEYS.BATCH_ENDED, severity: SEVERITY.INFO, message: 'The current brooding cycle has finished.' });
    } else if (rem <= 3) {
      out.push({ key: ALERT_KEYS.BATCH_ENDING, severity: SEVERITY.INFO, message: `The current cycle ends in ${rem} day${rem === 1 ? '' : 's'}.` });
    }
  }

  // A subscription is bought per batch, so the question that matters is whether
  // it reaches the end of the one running now — a plan that runs out mid-cycle
  // locks the unit with the animals still in it.
  const cover = sub && device.batch ? coverageFor(sub, device.batch, nowIso) : null;
  if (cover && cover.term && cover.batchDays && !cover.expired && !cover.coversBatch) {
    out.push({
      key: ALERT_KEYS.SUB_SHORT_OF_BATCH,
      severity: SEVERITY.WARNING,
      message: `Subscription ends ${fmtDate(sub.endDate)} — ${cover.shortfallDays} day${cover.shortfallDays === 1 ? '' : 's'} before this ${cover.batchDays}-day batch does. Renew or extend it to stay unlocked to the end of the cycle.`,
    });
  } else if (cover && cover.term && !cover.expired && cover.batchesCovered > 0 && cover.batchesLeft === 0) {
    out.push({
      key: ALERT_KEYS.SUB_LAST_BATCH,
      severity: SEVERITY.INFO,
      message: `This ${cover.term.name} is paying for its last whole batch of ${cover.batchDays} days — renew before the next cycle starts.`,
    });
  }

  return out;
}

/* -------------------------------- audit ------------------------------ */

export function makeAudit({ user, role, action, details, prev, next }) {
  return {
    id: uid('aud'),
    user: user ?? 'system',
    role: role ?? 'system',
    action,
    details: details ?? '',
    prev: prev ?? null,
    next: next ?? null,
    at: new Date().toISOString(),
  };
}

/* ----------------------------- churn & money -------------------------- */

/** Farmer churn risk from how long it has been since their last active batch. */
export function churnRisk(lastBatchEndIso, nowIso) {
  if (!lastBatchEndIso) return { level: 'high', months: 99, label: 'never' };
  const daysSince = Math.max(0, -daysUntil(lastBatchEndIso, nowIso));
  const months = Math.floor(daysSince / 30);
  if (months >= 4) return { level: 'high', months, label: `${months}+ months` };
  if (months === 3) return { level: 'high', months, label: '3 months' };
  if (months === 2) return { level: 'medium', months, label: '2 months' };
  if (months === 1) return { level: 'low', months, label: '1 month' };
  return { level: 'none', months: 0, label: 'active' };
}

/**
 * How many days of cover a subscription holds: the window it was sold as, or —
 * when a record predates the window being stored — the length of its plan.
 */
export function subscriptionDays(sub, plan) {
  const start = Date.parse(sub?.startDate || '');
  const end = Date.parse(sub?.endDate || '');
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    return Math.max(1, Math.ceil((end - start) / DAY_MS));
  }
  const days = Number(plan?.durationDays ?? termById(sub?.planId)?.days);
  return Number.isFinite(days) && days > 0 ? days : null;
}

/**
 * Projected monthly recurring revenue from the subscriptions that are running.
 *
 * A subscription is money already taken for a fixed number of days, so a month
 * of it is worth (price paid / days of cover) x 30. The price is the one the
 * farmer's own farm size and plan produced at the time — read from the
 * subscription itself, never re-derived from today's sheet, so a price change
 * cannot rewrite what somebody already paid.
 */
export function forecastMrr(devices, plans, nowIso) {
  let total = 0;
  for (const d of devices) {
    const sub = d.subscription;
    if (!sub || sub.status !== 'active') continue;
    if (subscriptionState(sub.endDate, nowIso) !== 'active') continue;
    const plan = (plans || []).find((p) => p.id === sub.planId);
    const days = subscriptionDays(sub, plan);
    const price = typeof sub.price === 'number' ? sub.price : Number(plan?.price);
    if (!days || !Number.isFinite(price)) continue;
    total += price / (days / 30);
  }
  return Math.round(total);
}

/* ------------------------------ maintenance --------------------------- */

export function maintenanceDue(record, nowIso) {
  return !!record && new Date(nowIso) >= new Date(record.nextMaintenance);
}

/* ------------------------------ mock MoMo ----------------------------- */

/** Simulated MTN Mobile Money provider callback. Deterministic when `ok` given. */
export function simulateMoMo(payment, ok = Math.random() < 0.85) {
  return {
    ...payment,
    status: ok ? PAYMENT_STATUS.SUCCESSFUL : PAYMENT_STATUS.FAILED,
    providerConfirmed: ok,
    providerRef: ok ? `MOMO-${uid('ref').slice(0, 12)}` : null,
  };
}

export { ANIMALS, DAY_MS, startOfDay, diffDays, daysUntil };
