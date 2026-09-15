-- =====================================================================
-- Broodiinnox API — CockroachDB schema
-- CockroachDB speaks the Postgres wire protocol, so this file is also
-- valid Postgres. The server self-provisions on boot (lib/store.js) but
-- you can run this yourself against a cluster:
--
--   cockroach sql --url "$DATABASE_URL" -f sql/schema.sql
-- =====================================================================

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

-- MTN Mobile Money collection requests, placed through the Ekorana payment
-- gateway. `provider_confirmed` is only ever set by the gateway's own status
-- answer (or an API-side re-check of a callback), and a device is unlocked only
-- by a payment whose `provider_confirmed` is true.
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

-- Who a notification is addressed to. Recipients are one per email address
-- (stored lower-cased, hence the UNIQUE); a contact may belong to a farmer (all
-- their systems) or to a single device, or to neither, which is how an
-- Afriinnox operator is represented. `opted_in` is the person's own switch and
-- only silences the notifications that are not account-critical.
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

-- Password-reset tokens: single-use, expiring, and stored only as a SHA-256
-- hash, so a leaked dump cannot be turned back into working reset links.
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
-- into a login. `attempts` is what stops a six-digit code being guessed, and
-- `used_at` is what makes a correct code single-use.
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

-- Every send attempt, whether or not it succeeded. This is how "did the email
-- actually go out?" is answered without opening the mailbox.
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
