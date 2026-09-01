/**
 * Invariant tests for the Broodiinnox business-logic services.
 * Each group asserts a property that must hold for EVERY valid input,
 * including boundary values (empty, single, maximum, out-of-range, malformed).
 */
import { describe, expect, it } from 'vitest';
import {
  DEVICE_STATUS, PAYMENT_STATUS, SEVERITY,
  allSensorsFailed, avgTemp, batchDay, batchRemaining, churnRisk, controlAllowed,
  deviceLocked, deviceStatus, emergencyHeatNeeded, expiryReminders, forecastMrr,
  generateAlerts, heaterDecision, maintenanceDue, makeAudit, paymentVerified,
  simulateMoMo, stepDownTargets, subscriptionState,
} from '../lib/services.js';
import { addDays } from '../lib/time.js';

const NOW = '2026-09-01T12:00:00.000Z';
const START = '2026-08-25T06:00:00.000Z';

/* ------------------------------ batchDay ------------------------------ */

describe('batchDay / batchRemaining invariants', () => {
  it('is 1 on the start date and counts up day by day', () => {
    expect(batchDay(START, 21, START)).toBe(1);
    expect(batchDay(START, 21, addDays(START, 1))).toBe(2);
    expect(batchDay(START, 21, addDays(START, 20))).toBe(21);
  });

  it('clamps to [1, duration] for every input (never 0, never > duration)', () => {
    expect(batchDay(START, 21, '2020-01-01T00:00:00Z')).toBe(1); // before start
    expect(batchDay(START, 21, addDays(START, 500))).toBe(21);   // long after end
    expect(batchDay(START, 1, addDays(START, 100))).toBe(1);     // single-day cycle
    expect(batchDay(START, 0, addDays(START, 3))).toBe(1);       // degenerate duration
  });

  it('remaining = duration - day and is never negative', () => {
    expect(batchRemaining(START, 21, START)).toBe(20);
    expect(batchRemaining(START, 21, addDays(START, 19))).toBe(1);
    expect(batchRemaining(START, 21, addDays(START, 100))).toBe(0);
    expect(batchRemaining(START, 21, '2019-01-01T00:00:00Z')).toBe(20);
  });
});

/* --------------------------- temperature ----------------------------- */

describe('temperature logic invariants', () => {
  it('heaterDecision: below min -> ON, above max -> OFF, inside band -> holds state', () => {
    expect(heaterDecision(30, 35, 37, false)).toBe(true);
    expect(heaterDecision(38, 35, 37, true)).toBe(false);
    expect(heaterDecision(36, 35, 37, true)).toBe(true);
    expect(heaterDecision(36, 35, 37, false)).toBe(false);
  });

  it('heaterDecision failsafe: no reading -> heat', () => {
    expect(heaterDecision(null, 35, 37, false)).toBe(true);
    expect(heaterDecision(undefined, 35, 37, false)).toBe(true);
  });

  it('stepDownTargets: -1°C every 7 days, never for day < 1', () => {
    expect(stepDownTargets(35, 37, 1)).toEqual({ min: 35, max: 37 });
    expect(stepDownTargets(35, 37, 7)).toEqual({ min: 35, max: 37 });
    expect(stepDownTargets(35, 37, 8)).toEqual({ min: 34, max: 36 });
    expect(stepDownTargets(35, 37, 15)).toEqual({ min: 33, max: 35 });
    expect(stepDownTargets(35, 37, 0)).toEqual({ min: 35, max: 37 });
    expect(stepDownTargets(35, 37, 100).min).toBeLessThan(stepDownTargets(35, 37, 1).min);
  });

  it('avgTemp averages only enabled sensors with readings; null when none', () => {
    const sensors = [
      { id: 1, enabled: true, lastReading: 34 },
      { id: 2, enabled: true, lastReading: 36 },
      { id: 3, enabled: false, lastReading: 99 },
    ];
    expect(avgTemp(sensors)).toBe(35);
    expect(avgTemp([{ id: 1, enabled: false, lastReading: 34 }])).toBe(null);
    expect(avgTemp([])).toBe(null);
    expect(allSensorsFailed(sensors)).toBe(false);
    expect(allSensorsFailed([{ id: 1, enabled: false }])).toBe(true);
  });
});

/* --------------------- subscription & device lock --------------------- */

const device = (over) => ({
  id: 'BRD001', manualLock: false, lastSeen: NOW, sensors: [
    { id: 1, enabled: true, lastReading: 35 }, { id: 2, enabled: true, lastReading: 35 },
  ],
  baseMin: 35, baseMax: 37, batchDay: 8, safetyFloor: 20, subscription: null,
  ...over,
});

describe('subscription & lock invariants', () => {
  it('subscriptionState: none without end date; active before end; expired after', () => {
    expect(subscriptionState(null, NOW)).toBe('none');
    expect(subscriptionState(undefined, NOW)).toBe('none');
    expect(subscriptionState(addDays(NOW, 1), NOW)).toBe('active');
    expect(subscriptionState(addDays(NOW, -1), NOW)).toBe('expired');
    expect(subscriptionState(NOW, NOW)).toBe('active'); // exact instant still active
  });

  it('deviceLocked: true when no subscription, expired, or manually locked; false when active', () => {
    expect(deviceLocked(device({}), NOW)).toBe(true);
    expect(deviceLocked(device({ subscription: { status: 'active', endDate: addDays(NOW, -1) } }), NOW)).toBe(true);
    expect(deviceLocked(device({ subscription: { status: 'active', endDate: addDays(NOW, 5) } }), NOW)).toBe(false);
    expect(deviceLocked(device({ manualLock: true, subscription: { status: 'active', endDate: addDays(NOW, 5) } }), NOW)).toBe(true);
    expect(deviceLocked(device({ subscription: { status: 'inactive', endDate: null } }), NOW)).toBe(true);
  });

  it('emergency heat: below safety floor -> true; at/above or unknown -> false', () => {
    expect(emergencyHeatNeeded(18, 20)).toBe(true);
    expect(emergencyHeatNeeded(20, 20)).toBe(false);
    expect(emergencyHeatNeeded(30, 20)).toBe(false);
    expect(emergencyHeatNeeded(null, 20)).toBe(false);
  });

  it('controlAllowed: unlocked -> true; locked but cold -> true (safety); locked and warm -> false', () => {
    const unlocked = device({ subscription: { status: 'active', endDate: addDays(NOW, 5) } });
    expect(controlAllowed(unlocked, NOW, 30)).toBe(true);
    const lockedCold = device({ subscription: { status: 'active', endDate: addDays(NOW, -1) } });
    expect(controlAllowed(lockedCold, NOW, 18)).toBe(true);
    expect(controlAllowed(lockedCold, NOW, 28)).toBe(false);
  });

  it('paymentVerified: only successful AND provider-confirmed unlocks (frontend cannot fake it)', () => {
    expect(paymentVerified({ status: PAYMENT_STATUS.SUCCESSFUL, providerConfirmed: true })).toBe(true);
    expect(paymentVerified({ status: PAYMENT_STATUS.PENDING, providerConfirmed: false })).toBe(false);
    expect(paymentVerified({ status: PAYMENT_STATUS.SUCCESSFUL, providerConfirmed: false })).toBe(false);
    expect(paymentVerified({ status: PAYMENT_STATUS.FAILED, providerConfirmed: false })).toBe(false);
    expect(paymentVerified(null)).toBe(false);
  });

  it('expiryReminders: exactly 7/3/1 days before and on/after expiry', () => {
    expect(expiryReminders(addDays(NOW, 7), NOW)).toEqual(['7d']);
    expect(expiryReminders(addDays(NOW, 3), NOW)).toEqual(['3d']);
    expect(expiryReminders(addDays(NOW, 1), NOW)).toEqual(['1d']);
    expect(expiryReminders(addDays(NOW, 0), NOW)).toEqual(['expired']);
    expect(expiryReminders(addDays(NOW, -2), NOW)).toEqual(['expired']);
    expect(expiryReminders(addDays(NOW, 4), NOW)).toEqual([]);
    expect(expiryReminders(null, NOW)).toEqual([]);
  });
});

/* ---------------------------- device status --------------------------- */

describe('deviceStatus invariants', () => {
  it('locked devices report locked regardless of telemetry', () => {
    const d = device({ subscription: { status: 'active', endDate: addDays(NOW, -1) }, lastSeen: NOW });
    expect(deviceStatus(d, NOW)).toBe(DEVICE_STATUS.LOCKED);
  });

  it('stale lastSeen -> offline (never shows stale readings as live)', () => {
    const d = device({ subscription: { status: 'active', endDate: addDays(NOW, 5) }, lastSeen: addDays(NOW, -1) });
    expect(deviceStatus(d, NOW)).toBe(DEVICE_STATUS.OFFLINE);
    expect(deviceStatus(device({ ...d, lastSeen: null }), NOW)).toBe(DEVICE_STATUS.OFFLINE);
  });

  it('all sensors failed -> critical; temp far outside band -> warning; else online', () => {
    const ok = device({ subscription: { status: 'active', endDate: addDays(NOW, 5) }, lastSeen: NOW });
    expect(deviceStatus(ok, NOW)).toBe(DEVICE_STATUS.ONLINE);
    const fault = device({ ...ok, sensors: [{ id: 1, enabled: true, lastReading: null }] });
    expect(deviceStatus(fault, NOW)).toBe(DEVICE_STATUS.CRITICAL);
    const hot = device({ ...ok, sensors: [{ id: 1, enabled: true, lastReading: 42 }, { id: 2, enabled: true, lastReading: 42 }] });
    expect(deviceStatus(hot, NOW)).toBe(DEVICE_STATUS.WARNING);
  });

  it('manualStatus (admin override) wins over telemetry', () => {
    const d = device({ subscription: { status: 'active', endDate: addDays(NOW, 5) }, lastSeen: NOW, manualStatus: DEVICE_STATUS.OFFLINE });
    expect(deviceStatus(d, NOW)).toBe(DEVICE_STATUS.OFFLINE);
  });
});

/* ------------------------------- alerts ------------------------------- */

describe('generateAlerts invariants', () => {
  it('emits temp-high/temp-low only when outside the current (stepped-down) targets', () => {
    const high = device({ subscription: { status: 'active', endDate: addDays(NOW, 5) }, sensors: [{ id: 1, enabled: true, lastReading: 45 }, { id: 2, enabled: true, lastReading: 45 }] });
    expect(generateAlerts(high, NOW).some((a) => a.key === 'temp_high')).toBe(true);
    const normal = device({ subscription: { status: 'active', endDate: addDays(NOW, 5) }, sensors: [{ id: 1, enabled: true, lastReading: 35 }, { id: 2, enabled: true, lastReading: 35 }] });
    expect(generateAlerts(normal, NOW).some((a) => a.key === 'temp_high' || a.key === 'temp_low')).toBe(false);
  });

  it('alerts have a stable dedupe key and one of the three severities', () => {
    const d = device({ subscription: { status: 'active', endDate: addDays(NOW, 5) } });
    const alerts = generateAlerts(d, NOW);
    const keys = alerts.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const a of alerts) expect([SEVERITY.CRITICAL, SEVERITY.WARNING, SEVERITY.INFO]).toContain(a.severity);
  });

  it('expired subscription -> locked alert; batch ending within 3 days -> info', () => {
    const locked = device({ subscription: { status: 'active', endDate: addDays(NOW, -1) } });
    expect(generateAlerts(locked, NOW).some((a) => a.key === 'device_locked')).toBe(true);
    const ending = device({
      subscription: { status: 'active', endDate: addDays(NOW, 5) },
      batch: { startDate: addDays(NOW, -19), durationDays: 21, status: 'running' },
    });
    expect(generateAlerts(ending, NOW).some((a) => a.key === 'batch_ending')).toBe(true);
  });
});

/* ---------------------------- churn & money --------------------------- */

describe('churnRisk / forecastMrr invariants', () => {
  it('maps inactivity to none/low/medium/high, never negative', () => {
    expect(churnRisk(addDays(NOW, -2), NOW).level).toBe('none');
    expect(churnRisk(addDays(NOW, -35), NOW).level).toBe('low');
    expect(churnRisk(addDays(NOW, -65), NOW).level).toBe('medium');
    expect(churnRisk(addDays(NOW, -95), NOW).level).toBe('high');
    expect(churnRisk(addDays(NOW, -200), NOW).level).toBe('high');
    expect(churnRisk(null, NOW).level).toBe('high');
    for (const days of [0, 1, 30, 60, 90, 120, 1000]) {
      expect(churnRisk(addDays(NOW, -days), NOW).months).toBeGreaterThanOrEqual(0);
    }
  });

  it('forecastMrr only counts currently-active subscriptions, scaled by plan price', () => {
    const plans = [
      { id: 'p30', durationDays: 30, price: 25000 },
      { id: 'p15', durationDays: 15, price: 15000 },
    ];
    const active = { subscription: { planId: 'p30', status: 'active', endDate: addDays(NOW, 20) } };
    const expired = { subscription: { planId: 'p30', status: 'active', endDate: addDays(NOW, -1) } };
    const none = { subscription: null };
    expect(forecastMrr([active], plans, NOW)).toBe(25000);
    expect(forecastMrr([expired], plans, NOW)).toBe(0);
    expect(forecastMrr([none], plans, NOW)).toBe(0);
    expect(forecastMrr([active, active], plans, NOW)).toBe(50000);
  });
});

/* ------------------------------ misc ---------------------------------- */

describe('misc services invariants', () => {
  it('maintenanceDue: false in the future, true at/after due date', () => {
    expect(maintenanceDue({ nextMaintenance: addDays(NOW, 3) }, NOW)).toBe(false);
    expect(maintenanceDue({ nextMaintenance: NOW }, NOW)).toBe(true);
    expect(maintenanceDue({ nextMaintenance: addDays(NOW, -1) }, NOW)).toBe(true);
    expect(maintenanceDue(null, NOW)).toBe(false);
  });

  it('makeAudit always captures user, action, timestamp and optional prev/next', () => {
    const e = makeAudit({ user: 'Jean', role: 'farmer', action: 'temperature.change', details: 'x', prev: 1, next: 2 });
    expect(e.id).toBeTruthy();
    expect(e.user).toBe('Jean');
    expect(e.action).toBe('temperature.change');
    expect(e.prev).toBe(1);
    expect(e.next).toBe(2);
    expect(new Date(e.at).getTime()).toBeGreaterThan(0);
  });

  it('simulateMoMo is deterministic when given ok, and providerConfirmed matches status', () => {
    const p = { id: 'x', amount: 25000 };
    const ok = simulateMoMo(p, true);
    const no = simulateMoMo(p, false);
    expect(ok.status).toBe(PAYMENT_STATUS.SUCCESSFUL);
    expect(ok.providerConfirmed).toBe(true);
    expect(ok.providerRef).toMatch(/^MOMO-/);
    expect(no.status).toBe(PAYMENT_STATUS.FAILED);
    expect(no.providerConfirmed).toBe(false);
    expect(no.providerRef).toBe(null);
  });
});
