/**
 * Invariant tests for src/lib/live.js — the live IoT page data path.
 */
import { describe, expect, it } from 'vitest';
import { liveVmStatus } from '../lib/live.js';

function vm(patch = {}) {
  return {
    id: 'BROODIINNOX-001',
    name: 'Main Farm Unit',
    online: true,
    stale: false,
    locked: false,
    failsafe: false,
    sensorError: false,
    mismatchError: false,
    aveTemp: 27.6,
    heaterOn: true,
    manual: false,
    day: 3,
    totalDays: 30,
    signalQuality: 25,
    sensors: [{ id: 1, enabled: true, lastReading: 27.6, health: 'ok' }],
    lastSeenAt: new Date().toISOString(),
    ...patch,
  };
}

const now = () => new Date().toISOString();
const MIN = 60000;

describe('liveVmStatus', () => {
  it('is online while lastSeenAt is fresh', () => {
    expect(liveVmStatus(vm(), now())).toBe('online');
  });

  it('is online exactly at the 15-minute boundary, offline past it', () => {
    const at = new Date().getTime();
    const edge = (ageMin) => new Date(at - ageMin * MIN).toISOString();
    expect(liveVmStatus(vm({ lastSeenAt: edge(15) }), new Date(at).toISOString())).toBe('online');
    expect(liveVmStatus(vm({ lastSeenAt: edge(15.01) }), new Date(at).toISOString())).toBe('offline');
  });

  it('goes offline when lastSeenAt is missing or the VM says offline', () => {
    expect(liveVmStatus(vm({ lastSeenAt: null }), now())).toBe('offline');
    expect(liveVmStatus(vm({ lastSeenAt: undefined }), now())).toBe('offline');
    expect(liveVmStatus(vm({ online: false }), now())).toBe('offline');
  });

  it('locked beats online; failsafe beats offline; sensor faults are warnings', () => {
    expect(liveVmStatus(vm({ locked: true, failsafe: true, online: false }), now())).toBe('locked');
    expect(liveVmStatus(vm({ failsafe: true, sensorError: true, online: false }), now())).toBe('critical');
    expect(liveVmStatus(vm({ sensorError: true, online: true }), now())).toBe('warning');
    expect(liveVmStatus(vm({ mismatchError: true, online: true }), now())).toBe('warning');
  });

  it('returns offline for null/empty input', () => {
    expect(liveVmStatus(null, now())).toBe('offline');
    expect(liveVmStatus({}, now())).toBe('offline');
  });
});
