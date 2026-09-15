/**
 * Put the Super Admin's account and password into the API's own records.
 *
 *   cd broodiinnox-api
 *   SUPER_ADMIN_PASSWORD='...' node scripts/set-super-admin.mjs
 *   SUPER_ADMIN_PASSWORD='...' node scripts/set-super-admin.mjs --email afriinnox@gmail.com --name Afriinnox
 *
 * WHY THIS EXISTS: the app cannot hold a password. It is a public bundle — anything
 * written into it is published to everyone who loads the page — so the password
 * belongs here, in the API, as a scrypt hash and nothing else. The app decides who
 * someone is from the account registered against their identifier; this decides
 * whether they know the password.
 *
 * It writes exactly two rows, both upserts, so running it again changes the
 * password rather than adding a second account:
 *
 *   1. a contact for the address, so the API has someone to name in notifications
 *   2. a credential whose password_hash is the hash of the password passed in
 *
 * The password is read from the environment for this one command: never written to
 * a file, never printed, never echoed. What IS printed is whether the API's own
 * verifier accepts it afterwards — the only part that decides anything.
 *
 * It refuses to run against the in-memory store. `createStore()` falls back to one
 * when CockroachDB is unreachable, and a write there would report success and then
 * vanish with the process.
 */
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { getStore } from '../lib/server.js';
import { hashPassword, verifyPassword } from '../lib/credentials.js';

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const email = String(flag('email', 'afriinnox@gmail.com')).trim().toLowerCase();
const name = String(flag('name', 'Afriinnox'));
const password = String(process.env.SUPER_ADMIN_PASSWORD || '');
if (!password) throw new Error('SUPER_ADMIN_PASSWORD must be set for this one command');

// The deployed API reads DATABASE_URL; a local run can take the same CockroachDB
// from the repo root .env. Neither value is ever printed.
if (!process.env.DATABASE_URL) {
  try {
    const envText = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
    const line = envText.split(/\r?\n/).find((l) => l.trim().startsWith('COCKROACHURL='));
    if (line) process.env.DATABASE_URL = line.slice(line.indexOf('=') + 1).trim();
  } catch { /* no .env: use whatever the environment already has */ }
}

const store = await getStore();
if (store.constructor.name !== 'PostgresStore') {
  throw new Error(`refusing to write to a ${store.constructor.name}: the password would vanish with this process`);
}

const contact = await store.upsertContact({ email, name, role: 'admin' });
const credential = await store.upsertCredential({
  email,
  passwordHash: await hashPassword(password),
  contactId: contact?.id || null,
});

// Read it back, and let the API's own verifier say whether it is right.
const stored = await store.getCredentialByEmail(email);
const accepted = await verifyPassword(password, stored?.password_hash || '');
const refused = await verifyPassword(`${password}-clearly-wrong`, stored?.password_hash || '');

console.log(`[admin] store: ${store.constructor.name}`);
console.log(`[admin] contact: ${stored?.contact_id || '(none)'} ${email} (role ${contact?.role || '?'})`);
console.log(`[admin] credential written for ${stored?.email}; hash starts ${String(credential?.password_hash).slice(0, 7)}...`);
console.log(`[admin] the API's verifier accepts the password: ${accepted}`);
console.log(`[admin] and refuses a wrong one: ${refused === false}`);
if (!accepted || refused) process.exitCode = 1;
