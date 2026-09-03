/**
 * Tiny HTTP helpers for route handlers: uniform JSON envelopes + CORS so the
 * Vite dashboard (different origin) can call this API directly in the browser.
 */

import { OFFLINE_AFTER_MS } from './constants.js';

/**
 * Mark a device row stale when no message has arrived for OFFLINE_AFTER_MS
 * (4x the firmware's 30 s heartbeat). The bridge sets online=true on any
 * message, but only freshness proves the device is still reachable.
 */
export function withLiveness(device) {
  if (!device) return null;
  const seen = device.last_seen_at ? new Date(device.last_seen_at).getTime() : null;
  const stale = seen === null || Date.now() - seen > OFFLINE_AFTER_MS;
  return { ...device, online: !!device.online && !stale, stale };
}

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

export function ok(data) {
  return json(data, 200);
}

export function created(data) {
  return json(data, 201);
}

export function badRequest(error) {
  return json({ error }, 400);
}

export function unauthorized(error = 'Missing or invalid API key') {
  return json({ error }, 401);
}

export function notFound(error = 'Not found') {
  return json({ error }, 404);
}

export function locked(error = 'Device is locked') {
  return json({ error }, 423);
}

export function serviceUnavailable(error = 'Service unavailable') {
  return json({ error }, 503);
}

export function methodNotAllowed() {
  return json({ error: 'Method not allowed' }, 405);
}

export function options() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** GET /api/... handlers are called with (request, ctx); POST with (request). */
export function paramsFromContext(ctx) {
  return ctx && ctx.params ? ctx.params : {};
}
