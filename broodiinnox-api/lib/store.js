/**
 * Persistence layer — CockroachDB (Postgres wire protocol, via `pg`).
 *
 * A memory store is used automatically when DATABASE_URL is unset so the API
 * can run for local demos; it implements the SAME interface but persists
 * nothing. Every write the bridge does goes through here, so swapping the
 * memory store for Cockroach is purely a configuration change.
 *
 * Schema lives in sql/schema.sql and is mirrored by ensureSchema() so a fresh
 * server self-provisions on boot.
 */
import { randomUUID } from 'node:crypto';

/** A short, prefixed, unguessable id — same shape as the payment ids. */
const newId = (prefix) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

/** Recipients are one per address, so the address is stored lower-cased. */
function normalizeEmail(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

/**
 * Only the writable contact columns, and only those actually supplied by the
 * caller — an omitted field leaves what is already stored alone. Accepts
 * camelCase and snake_case keys, because the route handlers and the tests
 * reach this from both directions.
 */
function contactPatch(c = {}) {
  const pick = (a, b) => (c[a] !== undefined ? c[a] : c[b]);
  const out = {};
  const name = pick('name', 'name');
  if (name !== undefined) out.name = String(name ?? '');
  const role = pick('role', 'role');
  if (role !== undefined) out.role = String(role || 'farmer');
  const phone = pick('phone', 'phone');
  if (phone !== undefined) out.phone = phone == null ? null : String(phone);
  const farmerId = pick('farmerId', 'farmer_id');
  if (farmerId !== undefined) out.farmer_id = farmerId == null ? null : String(farmerId);
  const deviceId = pick('deviceId', 'device_id');
  if (deviceId !== undefined) out.device_id = deviceId == null ? null : String(deviceId);
  const lang = pick('lang', 'lang');
  if (lang !== undefined) out.lang = lang == null ? null : String(lang);
  const optedIn = pick('optedIn', 'opted_in');
  if (optedIn !== undefined) out.opted_in = optedIn == null ? null : !!optedIn;
  return out;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS devices (
  device_id     TEXT PRIMARY KEY,
  name          TEXT NOT NULL DEFAULT '',
  farmer_id     TEXT,
  location      TEXT,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS device_state (
  device_id      TEXT PRIMARY KEY,
  online         BOOL NOT NULL DEFAULT FALSE,
  last_seen_at   TIMESTAMPTZ,
  relay_state    BOOL,
  manual_control BOOL,
  day            INT,
  total_days     INT,
  max_temp       INT,
  min_temp       INT,
  ave_temp       DOUBLE PRECISION,
  temp1          DOUBLE PRECISION,
  temp2          DOUBLE PRECISION,
  temp3          DOUBLE PRECISION,
  temp4          DOUBLE PRECISION,
  s1_enabled     BOOL,
  s2_enabled     BOOL,
  s3_enabled     BOOL,
  s4_enabled     BOOL,
  failsafe_mode  BOOL,
  sensor_error   BOOL,
  mismatch_error BOOL,
  device_locked  BOOL NOT NULL DEFAULT FALSE,
  signal_quality INT,
  error          TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS readings (
  id             BIGSERIAL PRIMARY KEY,
  device_id      TEXT NOT NULL,
  ts             TIMESTAMPTZ NOT NULL DEFAULT now(),
  device_ts      BIGINT,
  temp1          DOUBLE PRECISION,
  temp2          DOUBLE PRECISION,
  temp3          DOUBLE PRECISION,
  temp4          DOUBLE PRECISION,
  ave_temp       DOUBLE PRECISION,
  relay_state    BOOL,
  manual_control BOOL,
  day            INT,
  total_days     INT,
  max_temp       INT,
  min_temp       INT,
  failsafe_mode  BOOL,
  sensor_error   BOOL,
  mismatch_error BOOL,
  device_locked  BOOL,
  signal_quality INT,
  error          TEXT
);
CREATE INDEX IF NOT EXISTS idx_readings_device_ts ON readings (device_id, ts DESC);
CREATE TABLE IF NOT EXISTS alerts (
  id        BIGSERIAL PRIMARY KEY,
  ts        TIMESTAMPTZ NOT NULL DEFAULT now(),
  device_id TEXT NOT NULL,
  severity  TEXT NOT NULL,
  kind      TEXT NOT NULL,
  message   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_device_ts ON alerts (device_id, ts DESC);
CREATE TABLE IF NOT EXISTS commands_log (
  id        BIGSERIAL PRIMARY KEY,
  ts        TIMESTAMPTZ NOT NULL DEFAULT now(),
  device_id TEXT NOT NULL,
  command   TEXT NOT NULL,
  value     TEXT NOT NULL,
  topic     TEXT NOT NULL,
  payload   TEXT NOT NULL,
  published BOOL NOT NULL,
  error     TEXT
);
CREATE INDEX IF NOT EXISTS idx_commands_device_ts ON commands_log (device_id, ts DESC);
CREATE TABLE IF NOT EXISTS payments (
  id                 TEXT PRIMARY KEY,
  device_id          TEXT NOT NULL,
  farmer_id          TEXT,
  plan_id            TEXT,
  band_id            TEXT,
  amount             INT NOT NULL,
  currency           TEXT NOT NULL DEFAULT 'RWF',
  phone              TEXT NOT NULL,
  method             TEXT NOT NULL DEFAULT 'MTN MoMo',
  status             TEXT NOT NULL DEFAULT 'pending',
  provider_confirmed BOOL NOT NULL DEFAULT FALSE,
  provider_ref       TEXT,
  financial_tx_id    TEXT,
  reason             TEXT,
  payer_message      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at       TIMESTAMPTZ,
  status_checked_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_ref ON payments (provider_ref);
CREATE INDEX IF NOT EXISTS idx_payments_device_ts ON payments (device_id, created_at DESC);
CREATE TABLE IF NOT EXISTS contacts (
  id         TEXT PRIMARY KEY,
  role       TEXT NOT NULL DEFAULT 'farmer',
  farmer_id  TEXT,
  device_id  TEXT,
  name       TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL UNIQUE,
  phone      TEXT,
  lang       TEXT,
  opted_in   BOOL NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contacts_farmer ON contacts (farmer_id);
CREATE INDEX IF NOT EXISTS idx_contacts_device ON contacts (device_id);
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  email      TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_resets_email ON password_resets (email);

-- Account credentials: one row per email address that can sign in. Only the hash
-- is kept, and only for an account whose password has actually been set - an
-- address with no row here cannot sign in until it sets one through the reset
-- link, which is also how a first password is created.
CREATE TABLE IF NOT EXISTS credentials (
  email         TEXT PRIMARY KEY,
  contact_id    TEXT,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Emailed login codes, one row per challenge. The code is stored as the SHA-256
-- of the challenge id and the code together, so this table cannot be replayed
-- into a login. The attempts column is what stops a six-digit code being
-- guessed, and used_at is what makes a correct code single-use.
CREATE TABLE IF NOT EXISTS login_codes (
  challenge_id TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  contact_id   TEXT,
  code_hash    TEXT NOT NULL,
  attempts     INT NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_codes_email ON login_codes (email);
CREATE TABLE IF NOT EXISTS email_log (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  to_email    TEXT NOT NULL,
  template    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  status      TEXT NOT NULL,
  provider_id TEXT,
  error       TEXT,
  device_id   TEXT,
  payment_id  TEXT,
  event       TEXT
);
CREATE INDEX IF NOT EXISTS idx_email_log_ts ON email_log (ts DESC);
`;

/** Columns of a payment row, in insert order (mirrors the DDL above). */
const PAYMENT_SQL_COLUMNS = `id, device_id, farmer_id, plan_id, band_id, amount, currency,
       phone, method, status, provider_confirmed, provider_ref, financial_tx_id,
       reason, payer_message, created_at, updated_at, confirmed_at, status_checked_at`;

const STATE_COLUMNS = {
  deviceId: 'device_id', online: 'online', lastSeenAt: 'last_seen_at',
  relayOn: 'relay_state', manual: 'manual_control', day: 'day',
  totalDays: 'total_days', maxTemp: 'max_temp', minTemp: 'min_temp',
  aveTemp: 'ave_temp', temp1: 'temp1', temp2: 'temp2', temp3: 'temp3', temp4: 'temp4',
  s1Enabled: 's1_enabled', s2Enabled: 's2_enabled', s3Enabled: 's3_enabled', s4Enabled: 's4_enabled',
  failsafeMode: 'failsafe_mode', sensorError: 'sensor_error', mismatchError: 'mismatch_error',
  locked: 'device_locked', signal: 'signal_quality', error: 'error',
  // NOTE: deviceTs is intentionally NOT mapped — the device_state table has no
  // device_ts column, so persisting it made every upsertState() INSERT throw
  // ("column device_ts does not exist") and live device state was never
  // written to CockroachDB. device_ts lives in the readings table instead.
};

const MEMORY_READINGS_CAP = 1000; // per device, memory mode only

export class MemoryStore {
  constructor() {
    this.mode = 'memory';
    this.registry = new Map();
    this.state = new Map();
    this.readings = new Map(); // deviceId -> [{...row, tsMs}]
    this.alerts = [];
    this.commands = [];
    this.payments = [];
    this._paymentSeq = 0;
    this.contacts = new Map(); // id -> contact row
    this.passwordResets = new Map(); // token_hash -> reset row
    this.credentials = new Map(); // email -> credential row
    this.loginCodes = new Map(); // challenge_id -> login-code row
    this.emails = [];
  }

  async init() {}

  async registerDevice(dev) {
    this.registry.set(dev.device_id, {
      device_id: dev.device_id,
      name: dev.name || '',
      farmer_id: dev.farmer_id || null,
      location: dev.location || null,
      registered_at: new Date().toISOString(),
    });
    return this.getDevice(dev.device_id);
  }

  async getDevice(deviceId) {
    const reg = this.registry.get(deviceId);
    const st = this.state.get(deviceId);
    if (!reg && !st) return null;
    return { device_id: deviceId, ...(reg || {}), ...rowFromState(st) };
  }

  async listDevices() {
    const ids = new Set([...this.registry.keys(), ...this.state.keys()]);
    const out = [];
    for (const id of ids) {
      const d = await this.getDevice(id);
      if (d) out.push(d);
    }
    return out.sort((a, b) => a.device_id.localeCompare(b.device_id));
  }

  async saveReading(row) {
    const entry = { ...row, tsMs: row.tsMs ?? Date.now() };
    const arr = this.readings.get(row.device_id) || [];
    arr.push(entry);
    if (arr.length > MEMORY_READINGS_CAP) arr.splice(0, arr.length - MEMORY_READINGS_CAP);
    this.readings.set(row.device_id, arr);
    return entry;
  }

  async upsertState(deviceId, patch) {
    const cur = this.state.get(deviceId) || {};
    const next = { ...cur, ...patch, lastSeenAt: patch.lastSeenAt ?? Date.now() };
    this.state.set(deviceId, next);
    return next;
  }

  async getReadings(deviceId, { from, to, limit = 300 } = {}) {
    const arr = this.readings.get(deviceId) || [];
    const fromMs = from ? new Date(from).getTime() : null;
    const toMs = to ? new Date(to).getTime() : null;
    const out = arr
      .filter((r) => (fromMs === null || r.tsMs >= fromMs) && (toMs === null || r.tsMs <= toMs))
      .reverse()
      .slice(0, limit);
    return out.map((r) => {
      const { tsMs, ...rest } = r;
      return { ts: new Date(tsMs).toISOString(), ...rest };
    });
  }

  async logCommand(c) {
    this.commands.push({ ...c, ts: new Date().toISOString() });
    return c;
  }

  async listAudit(deviceId, limit = 100) {
    return this.commands
      .filter((c) => !deviceId || c.device_id === deviceId)
      .reverse()
      .slice(0, limit)
      .map((c) => ({ ...c }));
  }

  async logAlert(a) {
    this.alerts.push({ ...a, ts: new Date().toISOString() });
    return a;
  }

  async listAlerts(deviceId, limit = 200) {
    return this.alerts
      .filter((a) => !deviceId || a.device_id === deviceId)
      .reverse()
      .slice(0, limit)
      .map((a) => ({ ...a }));
  }

  /* ---- payments (MTN MoMo, collected through the Ekorana gateway) ---- */

  async createPayment(p) {
    this._paymentSeq += 1;
    const row = { ...p, _seq: this._paymentSeq, created_at: p.created_at || new Date().toISOString() };
    this.payments.push(row);
    return this.getPayment(row.id);
  }

  async getPayment(id) {
    const row = this.payments.find((p) => p.id === id);
    if (!row) return null;
    const { _seq, ...rest } = row;
    return { ...rest };
  }

  async listPayments({ deviceId, farmerId, limit = 100 } = {}) {
    return this.payments
      .filter((p) => (!deviceId || p.device_id === deviceId) && (!farmerId || p.farmer_id === farmerId))
      .sort((a, b) => (Date.parse(b.created_at) - Date.parse(a.created_at)) || (b._seq - a._seq))
      .slice(0, Math.min(Math.max(limit, 1), 500))
      .map(({ _seq, ...rest }) => ({ ...rest }));
  }

  async updatePayment(id, patch) {
    const row = this.payments.find((p) => p.id === id);
    if (!row) return null;
    Object.assign(row, patch);
    return this.getPayment(id);
  }

  /* ---- contacts: who a notification is addressed to ---- */

  async upsertContact(c = {}) {
    const email = normalizeEmail(c.email);
    if (!email) return null;
    const patch = contactPatch(c);
    const now = new Date().toISOString();
    let existing = null;
    for (const row of this.contacts.values()) {
      if (row.email === email) { existing = row; break; }
    }
    if (existing) {
      // A field the caller left out keeps what is stored (contactPatch omits
      // it); `null` on the patch means opt-out was explicitly supplied.
      for (const [k, v] of Object.entries(patch)) {
        if (v === null && k !== 'opted_in') continue;
        if (k === 'opted_in' && v === null) continue;
        existing[k] = v;
      }
      existing.updated_at = now;
      return this.getContact(existing.id);
    }
    const id = c.id || newId('c');
    this.contacts.set(id, {
      id,
      role: 'farmer',
      farmer_id: null,
      device_id: null,
      name: '',
      phone: null,
      lang: null,
      ...patch,
      email,
      opted_in: patch.opted_in === null || patch.opted_in === undefined ? true : patch.opted_in,
      created_at: now,
      updated_at: now,
    });
    return this.getContact(id);
  }

  async getContact(id) {
    const row = this.contacts.get(id);
    return row ? { ...row } : null;
  }

  async getContactByEmail(email) {
    const key = normalizeEmail(email);
    if (!key) return null;
    for (const row of this.contacts.values()) {
      if (row.email === key) return { ...row };
    }
    return null;
  }

  async listContacts({ farmerId, deviceId, role, limit = 200 } = {}) {
    return [...this.contacts.values()]
      .filter((c) => (!farmerId || c.farmer_id === farmerId)
        && (!deviceId || c.device_id === deviceId)
        && (!role || c.role === role))
      .sort((a, b) => String(a.email).localeCompare(String(b.email)))
      .slice(0, Math.min(Math.max(limit, 1), 500))
      .map((c) => ({ ...c }));
  }

  async deleteContact(id) {
    return this.contacts.delete(id);
  }

  /* ---- password-reset tokens (only the hash is stored) ---- */

  async createPasswordReset(row) {
    this.passwordResets.set(row.token_hash, {
      ...row,
      used_at: row.used_at || null,
      created_at: row.created_at || new Date().toISOString(),
    });
    return this.getPasswordReset(row.token_hash);
  }

  async getPasswordReset(tokenHash) {
    const row = this.passwordResets.get(tokenHash);
    return row ? { ...row } : null;
  }

  /** Consume a token. Returns null if it is unknown OR already spent. */
  /* ---- account credentials and login codes ---- */

  async upsertCredential({ email, passwordHash, contactId = null, now = new Date().toISOString() } = {}) {
    const key = normalizeEmail(email);
    if (!key) return null;
    const existing = this.credentials.get(key);
    const row = {
      email: key,
      contact_id: contactId || existing?.contact_id || null,
      password_hash: String(passwordHash || ''),
      created_at: existing?.created_at || now,
      updated_at: now,
    };
    this.credentials.set(key, row);
    return { ...row };
  }

  async getCredentialByEmail(email) {
    const key = normalizeEmail(email);
    if (!key) return null;
    const row = this.credentials.get(key);
    return row ? { ...row } : null;
  }

  async createLoginCode(row) {
    this.loginCodes.set(row.challenge_id, {
      challenge_id: row.challenge_id,
      email: normalizeEmail(row.email),
      contact_id: row.contact_id || null,
      code_hash: row.code_hash,
      attempts: 0,
      expires_at: row.expires_at,
      used_at: null,
      created_at: row.created_at || new Date().toISOString(),
    });
    return this.getLoginCode(row.challenge_id);
  }

  async getLoginCode(challengeId) {
    const row = this.loginCodes.get(challengeId);
    return row ? { ...row } : null;
  }

  /** Consume a code in one step, so two simultaneous submissions cannot both win. */
  async useLoginCode(challengeId, usedAt = new Date().toISOString()) {
    const row = this.loginCodes.get(challengeId);
    if (!row || row.used_at) return null;
    row.used_at = usedAt instanceof Date ? usedAt.toISOString() : usedAt;
    return { ...row };
  }

  /** Count a wrong attempt and hand back the row, so a caller can say how many are left. */
  async bumpLoginCodeAttempts(challengeId) {
    const row = this.loginCodes.get(challengeId);
    if (!row) return null;
    row.attempts = (Number(row.attempts) || 0) + 1;
    return { ...row };
  }

  async usePasswordReset(tokenHash, usedAt = new Date().toISOString()) {
    const row = this.passwordResets.get(tokenHash);
    if (!row || row.used_at) return null;
    row.used_at = usedAt;
    return { ...row };
  }

  /* ---- the email log: every attempt, sent or not ---- */

  async logEmail(row) {
    const entry = { id: this.emails.length + 1, ts: row.ts || new Date().toISOString(), ...row };
    entry.ts = row.ts || new Date().toISOString();
    this.emails.push(entry);
    return { ...entry };
  }

  async listEmails({ deviceId, paymentId, status, to, limit = 100 } = {}) {
    const email = normalizeEmail(to);
    return this.emails
      .filter((e) => (!deviceId || e.device_id === deviceId)
        && (!paymentId || e.payment_id === paymentId)
        && (!status || e.status === status)
        && (!email || e.to_email === email))
      .sort((a, b) => (Date.parse(b.ts) - Date.parse(a.ts)) || ((b.id || 0) - (a.id || 0)))
      .slice(0, Math.min(Math.max(limit, 1), 500))
      .map((e) => ({ ...e }));
  }
}

/** Convert bridge camelCase state object into a DB-friendly plain row. */
export function rowFromState(s) {
  if (!s) return null;
  const row = { device_id: s.deviceId };
  for (const [key, col] of Object.entries(STATE_COLUMNS)) {
    if (s[key] !== undefined && s[key] !== null) row[col] = s[key];
  }
  if (row.last_seen_at !== undefined) {
    row.last_seen_at = new Date(row.last_seen_at); // epoch ms -> timestamptz
  }
  return row;
}

const DEVICE_SELECT = `d.device_id, d.name, d.farmer_id, d.location, d.registered_at,
       s.online, s.last_seen_at, s.relay_state, s.manual_control, s.day, s.total_days,
       s.max_temp, s.min_temp, s.ave_temp, s.temp1, s.temp2, s.temp3, s.temp4,
       s.s1_enabled, s.s2_enabled, s.s3_enabled, s.s4_enabled, s.failsafe_mode,
       s.sensor_error, s.mismatch_error, s.device_locked, s.signal_quality,
       s.error, s.updated_at`;

class PostgresStore {
  constructor(pool) {
    this.mode = 'cockroach';
    this.pool = pool;
  }

  async init() {
    await this.pool.query(SCHEMA_SQL);
  }

  async registerDevice(dev) {
    await this.pool.query(
      `INSERT INTO devices (device_id, name, farmer_id, location)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (device_id) DO UPDATE SET
         name = EXCLUDED.name,
         farmer_id = EXCLUDED.farmer_id,
         location = EXCLUDED.location`,
      [dev.device_id, dev.name || '', dev.farmer_id || null, dev.location || null]
    );
    return this.getDevice(dev.device_id);
  }

  async getDevice(deviceId) {
    const { rows } = await this.pool.query(
      `SELECT ${DEVICE_SELECT}
         FROM devices d
         LEFT JOIN device_state s ON s.device_id = d.device_id
        WHERE d.device_id = $1`,
      [deviceId]
    );
    if (rows.length) return rows[0];
    // never registered but seen on MQTT — return whatever state exists
    const st = await this.pool.query(
      `SELECT device_id, NULL AS name, NULL AS farmer_id, NULL AS location, NULL AS registered_at,
              online, last_seen_at, relay_state, manual_control, day, total_days,
              max_temp, min_temp, ave_temp, temp1, temp2, temp3, temp4,
              s1_enabled, s2_enabled, s3_enabled, s4_enabled, failsafe_mode,
              sensor_error, mismatch_error, device_locked, signal_quality,
              error, updated_at
         FROM device_state WHERE device_id = $1`,
      [deviceId]
    );
    return st.rows.length ? st.rows[0] : null;
  }

  async listDevices() {
    const { rows } = await this.pool.query(
      `SELECT ${DEVICE_SELECT}
         FROM devices d
         LEFT JOIN device_state s ON s.device_id = d.device_id
        ORDER BY d.device_id`
    );
    return rows;
  }

  async saveReading(row) {
    const { rows } = await this.pool.query(
      `INSERT INTO readings (
         device_id, device_ts, temp1, temp2, temp3, temp4, ave_temp,
         relay_state, manual_control, day, total_days, max_temp, min_temp,
         failsafe_mode, sensor_error, mismatch_error, device_locked,
         signal_quality, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING ts`,
      [row.device_id, row.device_ts, row.temp1, row.temp2, row.temp3, row.temp4, row.ave_temp,
       row.relay_state, row.manual_control, row.day, row.total_days, row.max_temp, row.min_temp,
       row.failsafe_mode, row.sensor_error, row.mismatch_error, row.device_locked,
       row.signal_quality, row.error]
    );
    return rows[0];
  }

  async upsertState(deviceId, s) {
    const row = rowFromState(s);
    const cols = Object.keys(row).filter((c) => c !== 'device_id');
    const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const vals = cols.map((c) => row[c]);
    await this.pool.query(
      `INSERT INTO device_state (device_id, ${cols.join(', ')})
       VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
       ON CONFLICT (device_id) DO UPDATE SET ${sets}`,
      [deviceId, ...vals]
    );
  }

  async getReadings(deviceId, { from, to, limit = 300 } = {}) {
    const conds = ['device_id = $1'];
    const vals = [deviceId];
    if (from) { vals.push(new Date(from)); conds.push(`ts >= $${vals.length}`); }
    if (to) { vals.push(new Date(to)); conds.push(`ts <= $${vals.length}`); }
    vals.push(Math.min(limit, 5000));
    const { rows } = await this.pool.query(
      `SELECT * FROM readings WHERE ${conds.join(' AND ')}
        ORDER BY ts DESC LIMIT $${vals.length}`,
      vals
    );
    return rows;
  }

  async logCommand(c) {
    const { rows } = await this.pool.query(
      `INSERT INTO commands_log (device_id, command, value, topic, payload, published, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, ts`,
      [c.device_id, c.command, c.value, c.topic, c.payload, c.published, c.error || null]
    );
    return { ...c, ...rows[0] };
  }

  async listAudit(deviceId, limit = 100) {
    const vals = deviceId ? [deviceId, limit] : [limit];
    const { rows } = await this.pool.query(
      `SELECT * FROM commands_log
        ${deviceId ? 'WHERE device_id = $1' : ''}
        ORDER BY ts DESC LIMIT $${vals.length}`,
      vals
    );
    return rows;
  }

  async logAlert(a) {
    const { rows } = await this.pool.query(
      `INSERT INTO alerts (device_id, severity, kind, message)
       VALUES ($1,$2,$3,$4) RETURNING id, ts`,
      [a.device_id, a.severity, a.kind, a.message]
    );
    return { ...a, ...rows[0] };
  }

  async listAlerts(deviceId, limit = 200) {
    const vals = deviceId ? [deviceId, limit] : [limit];
    const { rows } = await this.pool.query(
      `SELECT * FROM alerts
        ${deviceId ? 'WHERE device_id = $1' : ''}
        ORDER BY ts DESC LIMIT $${vals.length}`,
      vals
    );
    return rows;
  }

  /* ---- payments (MTN MoMo, collected through the Ekorana gateway) ---- */

  async createPayment(p) {
    const { rows } = await this.pool.query(
      `INSERT INTO payments (${PAYMENT_SQL_COLUMNS})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [p.id, p.device_id, p.farmer_id || null, p.plan_id || null, p.band_id || null,
        p.amount, p.currency, p.phone, p.method, p.status, !!p.provider_confirmed,
        p.provider_ref || null, p.financial_tx_id || null, p.reason || null, p.payer_message || null,
        p.created_at || new Date(), p.updated_at || new Date(), p.confirmed_at || null, p.status_checked_at || null]
    );
    return rows[0];
  }

  async getPayment(id) {
    const { rows } = await this.pool.query('SELECT * FROM payments WHERE id = $1', [id]);
    return rows[0] || null;
  }

  async listPayments({ deviceId, farmerId, limit = 100 } = {}) {
    const conds = [];
    const vals = [];
    if (deviceId) { vals.push(deviceId); conds.push(`device_id = $${vals.length}`); }
    if (farmerId) { vals.push(farmerId); conds.push(`farmer_id = $${vals.length}`); }
    vals.push(Math.min(Math.max(limit, 1), 500));
    const { rows } = await this.pool.query(
      `SELECT * FROM payments
        ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
        ORDER BY created_at DESC LIMIT $${vals.length}`,
      vals
    );
    return rows;
  }

  async updatePayment(id, patch) {
    const cols = Object.keys(patch || {});
    if (!cols.length) return this.getPayment(id);
    const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const { rows } = await this.pool.query(
      `UPDATE payments SET ${sets} WHERE id = $1 RETURNING *`,
      [id, ...cols.map((c) => patch[c])]
    );
    return rows[0] || null;
  }

  /* ---- contacts: who a notification is addressed to ---- */

  async upsertContact(c = {}) {
    const email = normalizeEmail(c.email);
    if (!email) return null;
    const patch = contactPatch(c);
    // A field the caller left out arrives as an omitted key; COALESCE against
    // the stored row keeps it, so an update that only sets `name` cannot wipe
    // the phone number or the device link.
    const { rows } = await this.pool.query(
      `INSERT INTO contacts (id, role, farmer_id, device_id, name, email, phone, lang, opted_in)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (email) DO UPDATE SET
         role       = COALESCE(EXCLUDED.role, contacts.role),
         farmer_id  = COALESCE(EXCLUDED.farmer_id, contacts.farmer_id),
         device_id  = COALESCE(EXCLUDED.device_id, contacts.device_id),
         name       = COALESCE(NULLIF(EXCLUDED.name, ''), contacts.name),
         phone      = COALESCE(EXCLUDED.phone, contacts.phone),
         lang       = COALESCE(EXCLUDED.lang, contacts.lang),
         opted_in   = COALESCE(EXCLUDED.opted_in, contacts.opted_in),
         updated_at = now()
       RETURNING *`,
      [c.id || newId('c'), patch.role ?? 'farmer', patch.farmer_id ?? null, patch.device_id ?? null,
        patch.name ?? '', email, patch.phone ?? null, patch.lang ?? null,
        patch.opted_in === undefined ? true : patch.opted_in]
    );
    return rows[0] || null;
  }

  async getContact(id) {
    const { rows } = await this.pool.query('SELECT * FROM contacts WHERE id = $1', [id]);
    return rows[0] || null;
  }

  async getContactByEmail(email) {
    const key = normalizeEmail(email);
    if (!key) return null;
    const { rows } = await this.pool.query('SELECT * FROM contacts WHERE email = $1', [key]);
    return rows[0] || null;
  }

  async listContacts({ farmerId, deviceId, role, limit = 200 } = {}) {
    const conds = [];
    const vals = [];
    if (farmerId) { vals.push(farmerId); conds.push(`farmer_id = $${vals.length}`); }
    if (deviceId) { vals.push(deviceId); conds.push(`device_id = $${vals.length}`); }
    if (role) { vals.push(role); conds.push(`role = $${vals.length}`); }
    vals.push(Math.min(Math.max(limit, 1), 500));
    const { rows } = await this.pool.query(
      `SELECT * FROM contacts ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
        ORDER BY email LIMIT $${vals.length}`,
      vals
    );
    return rows;
  }

  async deleteContact(id) {
    const { rowCount } = await this.pool.query('DELETE FROM contacts WHERE id = $1', [id]);
    return rowCount > 0;
  }

  /* ---- password-reset tokens (only the hash is stored) ---- */

  async createPasswordReset(row) {
    const { rows } = await this.pool.query(
      `INSERT INTO password_resets (token_hash, contact_id, email, expires_at, used_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (token_hash) DO NOTHING
       RETURNING *`,
      [row.token_hash, row.contact_id, normalizeEmail(row.email), row.expires_at,
        row.used_at || null, row.created_at || new Date()]
    );
    return rows[0] || this.getPasswordReset(row.token_hash);
  }

  async getPasswordReset(tokenHash) {
    const { rows } = await this.pool.query('SELECT * FROM password_resets WHERE token_hash = $1', [tokenHash]);
    return rows[0] || null;
  }

  /** Consume a token in one statement, so two simultaneous redemptions cannot
   *  both win: only the call that actually flipped `used_at` gets a row back. */
  async usePasswordReset(tokenHash, usedAt = new Date()) {
    const { rows } = await this.pool.query(
      `UPDATE password_resets SET used_at = $2
        WHERE token_hash = $1 AND used_at IS NULL
        RETURNING *`,
      [tokenHash, usedAt]
    );
    return rows[0] || null;
  }

  /* ---- account credentials and login codes ---- */

  async upsertCredential({ email, passwordHash, contactId = null, now = new Date() } = {}) {
    const key = normalizeEmail(email);
    if (!key) return null;
    const { rows } = await this.pool.query(
      `INSERT INTO credentials (email, contact_id, password_hash, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         contact_id = COALESCE(EXCLUDED.contact_id, credentials.contact_id),
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [key, contactId, String(passwordHash || ''), now]
    );
    return rows[0] || null;
  }

  async getCredentialByEmail(email) {
    const key = normalizeEmail(email);
    if (!key) return null;
    const { rows } = await this.pool.query('SELECT * FROM credentials WHERE email = $1', [key]);
    return rows[0] || null;
  }

  async createLoginCode(row) {
    const { rows } = await this.pool.query(
      `INSERT INTO login_codes (challenge_id, email, contact_id, code_hash, attempts, expires_at, used_at, created_at)
       VALUES ($1, $2, $3, $4, 0, $5, $6, $7)
       ON CONFLICT (challenge_id) DO NOTHING
       RETURNING *`,
      [row.challenge_id, normalizeEmail(row.email), row.contact_id || null, row.code_hash,
        row.expires_at, row.used_at || null, row.created_at || new Date()]
    );
    return rows[0] || this.getLoginCode(row.challenge_id);
  }

  async getLoginCode(challengeId) {
    const { rows } = await this.pool.query('SELECT * FROM login_codes WHERE challenge_id = $1', [challengeId]);
    return rows[0] || null;
  }

  /** Consume a code in one statement, so two simultaneous submissions cannot both win. */
  async useLoginCode(challengeId, usedAt = new Date()) {
    const { rows } = await this.pool.query(
      `UPDATE login_codes SET used_at = $2
        WHERE challenge_id = $1 AND used_at IS NULL
        RETURNING *`,
      [challengeId, usedAt]
    );
    return rows[0] || null;
  }

  /** Count a wrong attempt and hand back the row, so a caller can say how many are left. */
  async bumpLoginCodeAttempts(challengeId) {
    const { rows } = await this.pool.query(
      `UPDATE login_codes SET attempts = attempts + 1
        WHERE challenge_id = $1
        RETURNING *`,
      [challengeId]
    );
    return rows[0] || null;
  }

  /* ---- the email log: every attempt, sent or not ---- */

  async logEmail(row) {
    const { rows } = await this.pool.query(
      `INSERT INTO email_log (to_email, template, subject, status, provider_id, error, device_id, payment_id, event)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [row.to_email, row.template, row.subject, row.status, row.provider_id || null,
        row.error || null, row.device_id || null, row.payment_id || null, row.event || null]
    );
    return rows[0];
  }

  async listEmails({ deviceId, paymentId, status, to, limit = 100 } = {}) {
    const conds = [];
    const vals = [];
    if (deviceId) { vals.push(deviceId); conds.push(`device_id = $${vals.length}`); }
    if (paymentId) { vals.push(paymentId); conds.push(`payment_id = $${vals.length}`); }
    if (status) { vals.push(status); conds.push(`status = $${vals.length}`); }
    const email = normalizeEmail(to);
    if (email) { vals.push(email); conds.push(`to_email = $${vals.length}`); }
    vals.push(Math.min(Math.max(limit, 1), 500));
    const { rows } = await this.pool.query(
      `SELECT * FROM email_log ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
        ORDER BY ts DESC LIMIT $${vals.length}`,
      vals
    );
    return rows;
  }
}

/** Build the store. No DB url set (or unreachable) => memory store. */
export async function createStore() {
  const url = process.env.DATABASE_URL || process.env.COCKROACHURL;
  if (!url) return new MemoryStore();
  try {
    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString: url,
      max: 5,
      ssl: url.includes('sslmode=require') || url.includes('sslmode=verify-full') ? undefined : { rejectUnauthorized: false },
    });
    const store = new PostgresStore(pool);
    await store.init();
    return store;
  } catch (err) {
    console.error(`[broodiinnox-api] CockroachDB unavailable (${err.message}); falling back to in-memory store.`);
    return new MemoryStore();
  }
}
