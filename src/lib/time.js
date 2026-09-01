export const DAY_MS = 86400000;

export function startOfDay(d) {
  const x = d instanceof Date ? new Date(d) : new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(iso, n) {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

/** Whole days from a to b (b - a), measured on day boundaries. */
export function diffDays(aIso, bIso) {
  return Math.round((startOfDay(new Date(bIso)) - startOfDay(new Date(aIso))) / DAY_MS);
}

/** Days until `iso` from `nowIso` (positive = future, negative = past). */
export function daysUntil(iso, nowIso) {
  return Math.ceil((startOfDay(new Date(iso)) - startOfDay(new Date(nowIso))) / DAY_MS);
}

export function timeAgo(iso, nowIso = new Date().toISOString()) {
  const s = Math.max(0, Math.floor((new Date(nowIso) - new Date(iso)) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function nowIso() {
  return new Date().toISOString();
}
