import { isAuthorized } from '../../../../lib/auth.js';
import { json, notFound, options, unauthorized } from '../../../../lib/http.js';
import { ensureReady } from '../../../../lib/server.js';

/** DELETE /api/contacts/[id] — stop notifying this address. */
export async function DELETE(request, ctx) {
  if (!isAuthorized(request)) return unauthorized();
  const { store } = await ensureReady();
  const id = ctx && ctx.params ? ctx.params.id : null;
  if (!id) return notFound('No contact id');

  const removed = await store.deleteContact(id);
  if (!removed) return notFound(`No contact "${id}"`);
  return json({ removed: true, id });
}

export async function OPTIONS() {
  return options();
}
