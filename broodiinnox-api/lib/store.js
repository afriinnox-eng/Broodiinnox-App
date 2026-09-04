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
`;

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
