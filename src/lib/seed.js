/**
 * Demo seed data for the Broodiinnox platform.
 * All dates are generated relative to "now" so the demo always looks live:
 * some subscriptions are expiring soon, one device is locked (expired),
 * one farmer is a churn candidate, a payment is pending, etc.
 */
import { addDays } from './time.js';

function iso(daysFromNow, hour = 9) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, 15, 0, 0);
  return d.toISOString();
}
function minutesAgo(m) {
  return new Date(Date.now() - m * 60000).toISOString();
}

const SENSORS = (temps, enabled = [true, true, true, true]) =>
  temps.map((t, i) => ({ id: i + 1, enabled: enabled[i], lastReading: t, health: 'ok' }));

export const PLANS = [
  { id: 'p15', name: '15-Day', durationDays: 15, price: 15000, active: true, description: 'Short cycle (piglets, small batches)' },
  { id: 'p30', name: '30-Day', durationDays: 30, price: 25000, active: true, description: 'Standard cycle (chickens)' },
  { id: 'p90', name: '90-Day', durationDays: 90, price: 65000, active: true, description: 'Multiple cycles — best value' },
];

export const FARMERS = [
  { id: 'f1', name: 'Jean Damascene', phone: '0788123456', email: 'jean@farm.rw', district: 'Kigali', sector: 'Gasabo', status: 'active', createdAt: iso(-160), lastActiveBatchEnd: iso(-2) },
  { id: 'f2', name: 'Clarisse Uwera', phone: '0788222333', email: 'clarisse@farm.rw', district: 'Kigali', sector: 'Kicukiro', status: 'active', createdAt: iso(-120), lastActiveBatchEnd: iso(-1) },
  { id: 'f3', name: 'Eric Niyonsaba', phone: '0788333444', email: 'eric@farm.rw', district: 'Musanze', sector: 'Muhoza', status: 'active', createdAt: iso(-95), lastActiveBatchEnd: iso(-3) },
  { id: 'f4', name: 'Aimee Mukamana', phone: '0788444555', email: 'aimee@farm.rw', district: 'Huye', sector: 'Tumba', status: 'active', createdAt: iso(-80), lastActiveBatchEnd: iso(-4) },
  { id: 'f5', name: 'Patrick Habimana', phone: '0788555666', email: 'patrick@farm.rw', district: 'Rwamagana', sector: 'Muhazi', status: 'inactive', createdAt: iso(-200), lastActiveBatchEnd: iso(-70) },
  { id: 'f6', name: 'Diane Ingabire', phone: '0788666777', email: 'diane@farm.rw', district: 'Nyagatare', sector: 'Karama', status: 'active', createdAt: iso(-45), lastActiveBatchEnd: iso(-6) },
];

export const DEVICES = [
  {
    id: 'BRD001', serial: 'BRD001', name: 'Main Farm', farmerId: 'f1', firmware: 'v2.1.0', installedAt: iso(-150),
    location: { district: 'Kigali', sector: 'Gasabo', lat: -1.9441, lng: 30.0619 },
    baseMin: 35, baseMax: 37, safetyFloor: 20,
    batch: { animal: 'chicken', startDate: iso(-7), durationDays: 21, count: 1000, status: 'running' },
    sensors: SENSORS([35.1, 34.8, 35.4, 35.0]),
    heaterOn: true, lastSeen: minutesAgo(0.2),
    subscription: { planId: 'p30', status: 'active', startDate: iso(-7), endDate: iso(23) },
    manualStatus: null,
  },
  {
    id: 'BRD002', serial: 'BRD002', name: 'Kigali Farm 2', farmerId: 'f1', firmware: 'v2.1.0', installedAt: iso(-140),
    location: { district: 'Kigali', sector: 'Gasabo', lat: -1.9578, lng: 30.0891 },
    baseMin: 33, baseMax: 35, safetyFloor: 20,
    batch: { animal: 'duck', startDate: iso(-4), durationDays: 28, count: 400, status: 'running' },
    sensors: SENSORS([34.2, 34.0, 34.4, 34.1]),
    heaterOn: true, lastSeen: minutesAgo(0.4),
    subscription: { planId: 'p30', status: 'active', startDate: iso(-28), endDate: iso(2) }, // expires in 2 days
    manualStatus: null,
  },
  {
    id: 'BRD003', serial: 'BRD003', name: 'Chicken House 2', farmerId: 'f2', firmware: 'v2.0.0', installedAt: iso(-110),
    location: { district: 'Kigali', sector: 'Kicukiro', lat: -1.9963, lng: 30.1202 },
    baseMin: 35, baseMax: 37, safetyFloor: 20,
    batch: { animal: 'chicken', startDate: iso(0), durationDays: 21, count: 800, status: 'running' },
    sensors: SENSORS([35.5, 35.2, 35.6, 35.3]),
    heaterOn: true, lastSeen: minutesAgo(0.3),
    subscription: { planId: 'p90', status: 'active', startDate: iso(-60), endDate: iso(30) },
    manualStatus: null,
  },
  {
    id: 'BRD004', serial: 'BRD004', name: 'Muhoza Brooder', farmerId: 'f3', firmware: 'v2.1.0', installedAt: iso(-90),
    location: { district: 'Musanze', sector: 'Muhoza', lat: -1.4998, lng: 29.6411 },
    baseMin: 34, baseMax: 36, safetyFloor: 20,
    batch: { animal: 'turkey', startDate: iso(-11), durationDays: 28, count: 300, status: 'running' },
    sensors: SENSORS([33.1, 34.6, 34.3, 34.4], [true, true, false, true]), // sensor 3 off
    heaterOn: true, lastSeen: minutesAgo(1.1),
    subscription: { planId: 'p30', status: 'active', startDate: iso(-21), endDate: iso(9) },
    manualStatus: null,
  },
  {
    id: 'BRD005', serial: 'BRD005', name: 'Huye Piglets', farmerId: 'f4', firmware: 'v2.1.0', installedAt: iso(-70),
    location: { district: 'Huye', sector: 'Tumba', lat: -2.5973, lng: 29.7529 },
    baseMin: 30, baseMax: 32, safetyFloor: 20,
    batch: { animal: 'pig', startDate: iso(-2), durationDays: 21, count: 120, status: 'running' },
    sensors: SENSORS([31.2, 31.0, 31.4, 31.1]),
    heaterOn: true, lastSeen: minutesAgo(0.5),
    subscription: { planId: 'p15', status: 'active', startDate: iso(-13), endDate: iso(45) },
    manualStatus: null,
  },
  {
    id: 'BRD006', serial: 'BRD006', name: 'Muhazi Unit', farmerId: 'f5', firmware: 'v2.0.0', installedAt: iso(-190),
    location: { district: 'Rwamagana', sector: 'Muhazi', lat: -1.9923, lng: 30.3998 },
    baseMin: 35, baseMax: 37, safetyFloor: 20,
    batch: null, // no active batch — churn candidate
    sensors: SENSORS([24.0, 23.8, 24.1, 23.9]),
    heaterOn: false, lastSeen: minutesAgo(9),
    subscription: { planId: 'p30', status: 'expired', startDate: iso(-90), endDate: iso(-30) }, // LOCKED
    manualStatus: null,
  },
  {
    id: 'BRD007', serial: 'BRD007', name: 'Karama Brooder', farmerId: 'f6', firmware: 'v2.2.0', installedAt: iso(-40),
    location: { district: 'Nyagatare', sector: 'Karama', lat: -1.2929, lng: 30.3256 },
    baseMin: 35, baseMax: 37, safetyFloor: 20,
    batch: { animal: 'chicken', startDate: iso(-14), durationDays: 21, count: 600, status: 'running' },
    sensors: SENSORS([34.1, 34.3, 34.0, 34.2]),
    heaterOn: true, lastSeen: minutesAgo(0.6),
    subscription: { planId: 'p30', status: 'active', startDate: iso(-25), endDate: iso(5) }, // expires in 5 days
    manualStatus: null,
  },
  {
    id: 'BRD008', serial: 'BRD008', name: 'Kicukiro Unit B', farmerId: 'f2', firmware: 'v2.1.0', installedAt: iso(-30),
    location: { district: 'Kigali', sector: 'Kicukiro', lat: -1.9891, lng: 30.1312 },
    baseMin: 35, baseMax: 37, safetyFloor: 20,
    batch: null,
    sensors: SENSORS([22.5, 22.4, 22.6, 22.5]),
    heaterOn: false, lastSeen: minutesAgo(3),
    subscription: { planId: 'p15', status: 'expired', startDate: iso(-45), endDate: iso(-30) }, // LOCKED — renewal demo
    manualStatus: null,
  },
];

export const PAYMENTS = [
  { id: 'pay1', farmerId: 'f1', deviceId: 'BRD001', amount: 25000, method: 'MTN MoMo', status: 'successful', providerConfirmed: true, providerRef: 'MOMO-8FK2Q1', planId: 'p30', period: '07 Sep – 07 Oct 2026', createdAt: iso(-7, 10), confirmedAt: iso(-7, 10, 2) },
  { id: 'pay2', farmerId: 'f1', deviceId: 'BRD002', amount: 25000, method: 'MTN MoMo', status: 'successful', providerConfirmed: true, providerRef: 'MOMO-91L0X7', planId: 'p30', period: '12 Aug – 11 Sep 2026', createdAt: iso(-28, 11), confirmedAt: iso(-28, 11, 2) },
  { id: 'pay3', farmerId: 'f2', deviceId: 'BRD003', amount: 65000, method: 'MTN MoMo', status: 'successful', providerConfirmed: true, providerRef: 'MOMO-4H3B9Z', planId: 'p90', period: '12 Jul – 10 Oct 2026', createdAt: iso(-60, 9), confirmedAt: iso(-60, 9, 3) },
  { id: 'pay4', farmerId: 'f3', deviceId: 'BRD004', amount: 25000, method: 'MTN MoMo', status: 'successful', providerConfirmed: true, providerRef: 'MOMO-7T6M2A', planId: 'p30', period: '21 Aug – 20 Sep 2026', createdAt: iso(-21, 12), confirmedAt: iso(-21, 12, 1) },
  { id: 'pay5', farmerId: 'f4', deviceId: 'BRD005', amount: 15000, method: 'MTN MoMo', status: 'successful', providerConfirmed: true, providerRef: 'MOMO-2P8N4C', planId: 'p15', period: '05 Sep – 20 Sep 2026', createdAt: iso(-13, 8), confirmedAt: iso(-13, 8, 2) },
  { id: 'pay6', farmerId: 'f5', deviceId: 'BRD006', amount: 25000, method: 'MTN MoMo', status: 'failed', providerConfirmed: false, providerRef: null, planId: 'p30', period: 'Renewal', createdAt: iso(-31, 14), confirmedAt: null },
  { id: 'pay7', farmerId: 'f2', deviceId: 'BRD008', amount: 15000, method: 'MTN MoMo', status: 'pending', providerConfirmed: false, providerRef: null, planId: 'p15', period: 'Renewal', createdAt: minutesAgo(8), confirmedAt: null },
];

export const ALERTS = [
  { id: 'al1', deviceId: 'BRD006', key: 'sub_expired', severity: 'critical', message: 'Subscription expired — device locked.', at: iso(-30, 7), read: false },
  { id: 'al2', deviceId: 'BRD008', key: 'sub_expired', severity: 'critical', message: 'Subscription expired — device locked.', at: iso(-30, 7), read: false },
  { id: 'al3', deviceId: 'BRD002', key: 'sub_expiring', severity: 'warning', message: 'Subscription expires in 7d. Renew to keep the device unlocked.', at: iso(-5, 8), read: false },
  { id: 'al4', deviceId: 'BRD004', key: 'sensor_fault', severity: 'warning', message: 'One or more sensors are not responding.', at: iso(-1, 6), read: false },
  { id: 'al5', deviceId: 'BRD007', key: 'sub_expiring', severity: 'warning', message: 'Subscription expires in 3d. Renew to keep the device unlocked.', at: iso(-2, 9), read: true },
];

export const TICKETS = [
  { id: 't1', farmerId: 'f3', subject: 'Sensor 3 showing abnormal temperature', category: 'Sensor problem', status: 'open', assignee: 'a3', createdAt: iso(-1, 13), messages: [{ author: 'Eric Niyonsaba', at: iso(-1, 13), text: 'Sensor 3 seems to have stopped reading. It shows nothing on screen 7.' }] },
  { id: 't2', farmerId: 'f1', subject: 'Question about renewing BRD002', category: 'Subscription problem', status: 'in-progress', assignee: 'a4', createdAt: iso(-2, 10), messages: [{ author: 'Jean Damascene', at: iso(-2, 10), text: 'My subscription expires in 2 days — what happens if I renew late?' }] },
  { id: 't3', farmerId: 'f5', subject: 'Device BRD006 locked after expiry', category: 'Subscription problem', status: 'new', assignee: null, createdAt: iso(-1, 16), messages: [{ author: 'Patrick Habimana', at: iso(-1, 16), text: 'Please help me reactivate my system.' }] },
];

export const ADMINS = [
  { id: 'a1', name: 'Innocent Ingabire', email: 'admin@afriinnox.com', role: 'super', status: 'active', createdAt: iso(-300) },
  { id: 'a2', name: 'Grace Uwase', email: 'ops@afriinnox.com', role: 'operations', status: 'active', createdAt: iso(-200) },
  { id: 'a3', name: 'Kevin Mugisha', email: 'tech@afriinnox.com', role: 'technical', status: 'active', createdAt: iso(-180) },
  { id: 'a4', name: 'Sandrine Niyonkuru', email: 'finance@afriinnox.com', role: 'finance', status: 'active', createdAt: iso(-150) },
  { id: 'a5', name: 'Olivier Byiringiro', email: 'support@afriinnox.com', role: 'support', status: 'active', createdAt: iso(-120) },
];

export const MAINTENANCE = [
  { id: 'm1', deviceId: 'BRD001', installer: 'Kevin Mugisha', lastMaintenance: iso(-80), nextMaintenance: iso(5), technician: 'Kevin Mugisha', status: 'scheduled', notes: 'Routine check; replaced sensor 2.' },
  { id: 'm2', deviceId: 'BRD002', installer: 'Kevin Mugisha', lastMaintenance: iso(-70), nextMaintenance: iso(15), technician: null, status: 'ok', notes: '' },
  { id: 'm3', deviceId: 'BRD003', installer: 'Innocent Ingabire', lastMaintenance: iso(-40), nextMaintenance: iso(20), technician: null, status: 'ok', notes: '' },
  { id: 'm4', deviceId: 'BRD004', installer: 'Kevin Mugisha', lastMaintenance: iso(-95), nextMaintenance: iso(-5), technician: null, status: 'due', notes: 'Sensor 3 fault reported by farmer.' },
  { id: 'm5', deviceId: 'BRD006', installer: 'Innocent Ingabire', lastMaintenance: iso(-120), nextMaintenance: iso(-30), technician: null, status: 'overdue', notes: 'No contact from farmer.' },
  { id: 'm6', deviceId: 'BRD007', installer: 'Kevin Mugisha', lastMaintenance: iso(-25), nextMaintenance: iso(35), technician: null, status: 'ok', notes: '' },
];

export const INVENTORY = [
  { id: 'inv1', name: 'Temperature sensor (DS18B20)', sku: 'SNS-DS18', stock: 34, minStock: 10, unit: 'pcs' },
  { id: 'inv2', name: 'Heat lamp bulb 250W', sku: 'LMP-250', stock: 8, minStock: 12, unit: 'pcs' },
  { id: 'inv3', name: 'Solid-state relay', sku: 'RLY-SSR', stock: 15, minStock: 8, unit: 'pcs' },
  { id: 'inv4', name: '4G SIM card (Airtel)', sku: 'SIM-4G', stock: 5, minStock: 6, unit: 'pcs' },
  { id: 'inv5', name: 'Controller board S1', sku: 'PCB-S1', stock: 9, minStock: 5, unit: 'pcs' },
  { id: 'inv6', name: 'Battery 12V 20Ah', sku: 'BAT-1220', stock: 3, minStock: 4, unit: 'pcs' },
];

export const MESSAGES = [
  { id: 'msg1', audience: 'Farmers with expired subscriptions', text: 'Dear farmer, your Broodiinnox subscription has lapsed. Renew today to unlock your system — pay via MTN MoMo in the app.', channel: 'In-app + SMS', sentAt: iso(-1, 11), recipients: 2 },
  { id: 'msg2', audience: 'All farmers', text: 'Broodiinnox tip: check sensor wiring before starting a new cycle. Contact support for help.', channel: 'In-app', sentAt: iso(-3, 9), recipients: 6 },
];

export const AUDIT = [
  { id: 'a1', user: 'Jean Damascene', role: 'farmer', action: 'temperature.change', details: 'BRD001 min 34°C → 35°C', prev: { min: 34 }, next: { min: 35 }, at: iso(-2, 14, 32) },
  { id: 'a2', user: 'Grace Uwase', role: 'operations', action: 'farmer.create', details: 'Created farmer Diane Ingabire', prev: null, next: { id: 'f6' }, at: iso(-45, 10, 12) },
  { id: 'a3', user: 'Jean Damascene', role: 'farmer', action: 'payment.success', details: 'Paid RWF 25,000 via MTN MoMo for BRD001 (30-Day)', prev: null, next: { amount: 25000 }, at: iso(-7, 10, 4) },
  { id: 'a4', user: 'system', role: 'system', action: 'device.lock', details: 'BRD006 locked — subscription expired', prev: { locked: false }, next: { locked: true }, at: iso(-30, 7, 0) },
];

export const NOTIFICATIONS = [
  { id: 'n1', farmerId: 'f1', title: 'Subscription reminder', body: 'BRD002 subscription expires in 2 days.', severity: 'warning', read: false, at: iso(-1, 9) },
  { id: 'n2', farmerId: 'f1', title: 'Batch update', body: 'Main Farm is on day 8 of 21.', severity: 'info', read: true, at: iso(-2, 9) },
  { id: 'n3', farmerId: 'f2', title: 'Payment received', body: 'Your RWF 65,000 payment was confirmed.', severity: 'info', read: false, at: iso(-5, 10) },
];

export function buildSeed() {
  return {
    version: 1,
    farmers: FARMERS,
    devices: DEVICES,
    plans: PLANS,
    payments: PAYMENTS,
    alerts: ALERTS,
    tickets: TICKETS,
    admins: ADMINS,
    maintenance: MAINTENANCE,
    inventory: INVENTORY,
    messages: MESSAGES,
    audit: AUDIT,
    notifications: NOTIFICATIONS,
  };
}
