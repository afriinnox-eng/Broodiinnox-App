import { isAuthorized } from '../../../lib/auth.js';
import { badRequest, created, json, ok, options, unauthorized } from '../../../lib/http.js';
import { ensureReady } from '../../../lib/server.js';
import { isValidEmail } from '../../../lib/mail.js';

/**
 * GET  /api/contacts?farmerId&deviceId&role&limit — who can be notified.
 * POST /api/contacts                              — add or update one.
 *
 * A contact is where a recipient address lives. Without one there is nowhere
 * to send a receipt, an alert or a reset link, so this is the record that makes
 * every notification addressed to a person rather than to nobody.
 *
 * POST body: { email (required), name?, role?, phone?, farmerId?, deviceId?, lang?, optedIn? }
 * A field left out keeps the stored value; the email is the identity, so
 * posting the same address twice updates the row instead of creating a second.
 */
export async function GET(request) {
  if (!isAuthorized(request)) return unauthorized();
  const { store } = await ensureReady();
  const url = new URL(request.url);
  const parsed = Number.parseInt(url.searchParams.get('limit') || '200', 10);

  const contacts = await store.listContacts({
    farmerId: url.searchParams.get('farmerId') || undefined,
    deviceId: url.searchParams.get('deviceId') || undefined,
    role: url.searchParams.get('role') || undefined,
    limit: Number.isFinite(parsed) ? parsed : 200,
  });
  return ok({ count: contacts.length, contacts });
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorized();
  const { store } = await ensureReady();

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('Body must be JSON: { email, name?, role?, farmerId?, deviceId? }');
  }

  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  if (!isValidEmail(email)) {
    return badRequest(`Invalid email "${email}" — a deliverable address is required.`);
  }

  const contact = await store.upsertContact({
    email,
    name: body?.name,
    role: body?.role,
    phone: body?.phone,
    farmerId: body?.farmerId ?? body?.farmer_id,
    deviceId: body?.deviceId ?? body?.device_id,
    lang: body?.lang,
    optedIn: body?.optedIn ?? body?.opted_in,
  });
  if (!contact) return badRequest('Could not store that contact.');

  return created({ contact });
}

export async function OPTIONS() {
  return options();
}
