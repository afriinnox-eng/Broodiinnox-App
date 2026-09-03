/**
 * Request auth for dashboard<->server calls.
 * If API_KEYS is empty the API is open (dev). When keys are configured the
 * caller must send `X-API-Key: <key>` (or `Authorization: Bearer <key>`).
 */

function apiKeys() {
  return (process.env.API_KEYS || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

/** Constant-time-ish comparison so timing leaks nothing usable. */
function slowEquals(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/** Returns true when the request is authorized. */
export function isAuthorized(request) {
  const keys = apiKeys();
  if (keys.length === 0) return true;

  const h = request.headers.get('x-api-key') || request.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : h.trim();
  if (!token) return false;
  return keys.some((k) => slowEquals(token, k));
}
