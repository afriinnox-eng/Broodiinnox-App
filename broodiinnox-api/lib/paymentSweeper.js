/**
 * The autonomous half of the payment flow: nobody has to be watching.
 *
 * Until this module existed, a confirmed payment unlocked a unit on exactly
 * three occasions — Ekorana's callback, and a merchant/API read of the payment
 * (the farmer opening the app). All three need something else to happen first:
 * the callback has to arrive (the gateway retries at 30 s, 60 s and 120 s and
 * then stops), and the reads only happen while somebody has the dashboard open.
 * So a payment collected at 20:00 while the unit was locked and the app closed
 * stayed `pending` at the gateway's expense and the unit stayed LOCKED — the
 * farmer had paid and the system did not move until a human noticed. That is
 * the hole this closes.
 *
 * One sweep does three things, in order, and every one of them is idempotent:
 *
 *   1. SETTLE   every payment the gateway still owes an answer for — pending,
 *               or failed for want of an answer (see awaitsProvider) — is asked
 *               about again and applied. The gateway's answer is still the only
 *               thing that confirms a payment; this only asks for it.
 *   2. UNLOCK   every unit that reports itself LOCKED and is owed an unlock —
 *               a confirmed payment newer than the last `device_active=LOCKED`
 *               command on record, inside UNLOCK_WINDOW_MS — is sent
 *               `device_active=ACTIVE` again. This is what covers a unit that
 *               was offline, a bridge that was down or a process that was
 *               asleep when the payment was confirmed.
 *   3. REPORT   what it did, for the log and for GET /api/health.
 *
 * The invariants the payment flow rests on are untouched:
 *
 *   · Only the gateway's own answer settles a payment — the sweep asks, and
 *     `refreshPayment` applies what it answers (`applyProviderStatus`).
 *   · Only a CONFIRMED payment unlocks a unit, and `unlockDeviceAfterPayment`
 *     still refuses to touch a unit that already reports itself unlocked.
 *   · A lock somebody commanded AFTER the payment is a decision, not an
 *     accident: the money does not overrule it (the last `device_active=LOCKED`
 *     command wins over an older payment), so an admin's Lock button is never
 *     undone behind their back.
 *   · It cannot fail anything: a sweep that throws is caught, counted and
 *     retried on the next tick, and a gateway that will not answer leaves the
 *     payment exactly where it was.
 *
 * Started once per process from scripts/server.js (the deployed entrypoint), so
 * it runs while the service is up — including the first sweep right after boot,
 * which settles whatever the process slept through. On Render's free instance
 * type the service is stopped when idle, so the sweep runs whenever it is
 * awake: the callback is what wakes it, and the sweep is what makes the wake-up
 * complete.
 *
 * Env:
 *   PAYMENT_SWEEP_INTERVAL_MS   how often to sweep, default 15000
 *   PAYMENT_SWEEP_DISABLED      '1'/'true' turns the sweeper off entirely
 */
import { DEFAULT_TOPIC_PREFIX } from './constants.js';
import { resolveEkopayConfig } from './ekopay.js';
import { awaitsProvider, isConfirmed, unlockDeviceAfterPayment } from './payments.js';
import { refreshPayment } from './paymentFlow.js';

/** How often the loop runs. Short enough to feel instant, long enough to be kind to the gateway. */
export const SWEEP_INTERVAL_MS = 15_000;

/**
 * How long a payment that is still owed an answer is asked about. The gateway
 * settles a collection within minutes of the prompt; a day is generous and
 * bounded, so an abandoned attempt is not polled for ever.
 */
export const SWEEP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * How long after a confirmation the unlock is re-delivered to a unit that still
 * reports itself LOCKED. A day covers a unit that was offline overnight (this
 * hardware speaks MQTT over GSM) without letting a payment from last month
 * reach a unit whose cover has since run out — a lapsed subscription stays
 * locked, and only a NEW payment unlocks it.
 */
export const UNLOCK_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Per unit, how long to wait before re-sending an unlock that has not landed. */
export const REASSERT_INTERVAL_MS = 5 * 60 * 1000;

/** At most this many payments are asked about in one sweep. */
export const SWEEP_BATCH = 25;

/** How many recent payments and commands a sweep looks at. */
export const RECENT_PAYMENTS = 200;
export const RECENT_COMMANDS = 100;

/** A time as epoch ms, from an ISO string, a Date or a Postgres timestamptz. */
function msOf(v) {
  const t = v instanceof Date ? v.getTime() : Date.parse(v || '');
  return Number.isFinite(t) ? t : 0;
}

function asMs(now, fallback = Date.now()) {
  if (typeof now === 'number' && Number.isFinite(now)) return now;
  return msOf(now) || fallback;
}

/** A positive integer from the environment, or the default. */
function intEnv(raw, dflt) {
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

function off(raw) {
  return ['1', 'true', 'yes', 'on'].includes(String(raw ?? '').trim().toLowerCase());
}

/**
 * The payments a sweep should ask the gateway about, oldest first.
 *
 * "Owed an answer" is `awaitsProvider` — pending, or failed for want of an
 * answer — and only those that actually have a reference to ask about, and only
 * while they are younger than the window. A payment the gateway itself refused
 * has been decided and is never re-opened.
 */
export function unsettledPayments(payments, { now = Date.now(), maxAgeMs = SWEEP_MAX_AGE_MS } = {}) {
  const t = asMs(now);
  return (payments || [])
    .filter((p) => p
      && awaitsProvider(p)
      && !!p.provider_ref
      && msOf(p.created_at) > 0
      && t - msOf(p.created_at) <= maxAgeMs)
    .sort((a, b) => msOf(a.created_at) - msOf(b.created_at));
}

/** The most recent confirmed payment for one unit, or null. */
export function newestConfirmedPayment(payments, deviceId) {
  if (!deviceId) return null;
  return (payments || [])
    .filter((p) => p && p.device_id === deviceId && isConfirmed(p) && msOf(p.confirmed_at) > 0)
    .sort((a, b) => msOf(b.confirmed_at) - msOf(a.confirmed_at))[0] || null;
}

/**
 * When the server last COMMANDED a lock on this unit — the newest
 * `device_active=LOCKED` in the command ledger, as epoch ms (0 when there is
 * none). This is what separates "locked because the subscription ran out" from
 * "locked because somebody decided so".
 */
export function lastLockCommandAt(commands) {
  return (commands || []).reduce((newest, c) => {
    if (!c || c.command !== 'device_active') return newest;
    if (String(c.value ?? '').trim().toUpperCase() !== 'LOCKED') return newest;
    return Math.max(newest, msOf(c.ts));
  }, 0);
}

/**
 * Is an unlock still owed to this unit?
 *
 * Yes when a confirmed payment is inside the delivery window and no lock was
 * commanded after it. A lock commanded after the payment wins: it is a
 * deliberate act, and the sweeper is not here to argue with the console.
 */
export function unlockDue({ payment = null, lockedAt = 0, now = Date.now(), windowMs = UNLOCK_WINDOW_MS } = {}) {
  if (!payment || !isConfirmed(payment)) return false;
  const confirmedAt = msOf(payment.confirmed_at);
  if (!confirmedAt) return false;
  if (lockedAt && lockedAt >= confirmedAt) return false;
  return asMs(now) - confirmedAt <= windowMs;
}

/**
 * Build a sweeper. `now` is injectable so its decisions are testable without
 * waiting, and `log` so a test can capture the line it writes.
 *
 * Returns { run, start, stop, status } — `run` performs exactly one sweep and
 * hands back what it did.
 */
export function createPaymentSweeper({
  store, bridge, env = process.env, fetchImpl, mailer = null, log = console,
  intervalMs = intEnv(env?.PAYMENT_SWEEP_INTERVAL_MS, SWEEP_INTERVAL_MS),
  maxAgeMs = SWEEP_MAX_AGE_MS,
  windowMs = UNLOCK_WINDOW_MS,
  reassertIntervalMs = REASSERT_INTERVAL_MS,
  prefix = env?.MQTT_TOPIC_PREFIX || DEFAULT_TOPIC_PREFIX,
  now = () => new Date().toISOString(),
} = {}) {
  const lastReassert = new Map();
  let timer = null;
  let kick = null;
  let running = false;

  const status = {
    enabled: false,
    disabled_reason: null,
    interval_ms: intervalMs,
    runs: 0,
    checked: 0,
    settled: 0,
    confirmed: 0,
    unlocked: 0,
    errors: 0,
    last_run_at: null,
    last_error: null,
  };

  /** Phase 1: ask the gateway about everything it still owes an answer for. */
  async function settle(at, atMs, out) {
    const config = resolveEkopayConfig(env);
    if (!config.enabled) return; // nothing can be confirmed without the gateway
    const recent = await store.listPayments({ limit: RECENT_PAYMENTS });
    for (const payment of unsettledPayments(recent, { now: atMs, maxAgeMs })) {
      if (out.checked >= SWEEP_BATCH) break;
      out.checked += 1;
      try {
        // Not forced: the throttle inside refreshPayment is what keeps a sweep
        // and a farmer's own read from asking the gateway twice in a second.
        const res = await refreshPayment({
          store, bridge, paymentId: payment.id, env, fetchImpl, now: at, mailer, prefix,
        });
        if (res?.body?.refreshed) {
          out.settled += 1;
          // The unlock this confirmation just sent (or tried to send) is
          // reported by the sweep too: `unlocked` counts deliveries, whoever
          // made them.
          if (res.body.device_unlock?.sent) out.unlocked += 1;
          if (res.body.confirmed) {
            out.confirmed += 1;
            // `refreshPayment` has just sent the unlock for this unit — or tried
            // to. Recording when, on the same per-unit clock the delivery phase
            // uses, is what keeps one sweep from sending ACTIVE twice: the unit
            // reports its new state on its next telemetry, and until it does the
            // retry waits its turn like any other delivery.
            const deviceId = res.body.payment?.device_id || payment.device_id;
            if (deviceId) lastReassert.set(deviceId, atMs);
          }
        }
      } catch (err) {
        out.errors += 1;
        log?.warn?.(`[payments] sweep could not check ${payment.id}: ${err?.message || err}`);
      }
    }
  }

  /**
   * Phase 2: deliver an unlock that has not landed.
   *
   * Only units that REPORT themselves locked are considered, so this stops the
   * moment the hardware confirms — and a unit that is already ACTIVE is never
   * touched. `unlockDeviceAfterPayment` holds the same line from the other side
   * and refuses a unit whose row says it is unlocked.
   */
  async function deliverUnlocks(atMs, out) {
    const devices = await store.listDevices();
    const locked = (devices || []).filter((d) => d && d.device_locked === true);
    if (!locked.length) return;
    const recent = await store.listPayments({ limit: RECENT_PAYMENTS });
    for (const device of locked) {
      const payment = newestConfirmedPayment(recent, device.device_id);
      if (!payment) continue;
      let lockedAt = 0;
      try {
        lockedAt = lastLockCommandAt(await store.listAudit(device.device_id, RECENT_COMMANDS));
      } catch {
        // no ledger is no evidence of a deliberate lock; the payment decides
      }
      if (!unlockDue({ payment, lockedAt, now: atMs, windowMs })) continue;
      const last = lastReassert.get(device.device_id) || 0;
      if (atMs - last < reassertIntervalMs) continue;
      lastReassert.set(device.device_id, atMs);
      const sent = await unlockDeviceAfterPayment({ store, bridge, prefix, payment, device, log });
      if (sent?.sent) out.unlocked += 1;
    }
  }

  /**
   * One whole sweep. Never throws: an error is recorded in the status and
   * counted, and the next tick tries again.
   */
  async function run() {
    const at = now();
    const atMs = asMs(at);
    const out = { at, checked: 0, settled: 0, confirmed: 0, unlocked: 0, errors: 0, skipped: null };
    if (running) return { ...out, skipped: 'sweep already running' };
    running = true;
    try {
      await settle(at, atMs, out);
      await deliverUnlocks(atMs, out);
      status.runs += 1;
      status.checked += out.checked;
      status.settled += out.settled;
      status.confirmed += out.confirmed;
      status.unlocked += out.unlocked;
      status.errors += out.errors;
      status.last_run_at = at;
      status.last_error = null;
    } catch (err) {
      out.errors += 1;
      status.runs += 1;
      status.errors += 1;
      status.last_run_at = at;
      status.last_error = err?.message || String(err);
      log?.error?.(`[payments] sweep failed: ${status.last_error}`);
    } finally {
      running = false;
    }
    // A line only when there was something to say: a quiet sweep every 15 s
    // would bury the log it is meant to make readable.
    if (out.settled || out.unlocked || out.errors) {
      log?.log?.(`[payments] sweep checked=${out.checked} settled=${out.settled} confirmed=${out.confirmed} unlocked=${out.unlocked} errors=${out.errors}`);
    }
    return out;
  }

  const api = {
    run,
    /** Begin sweeping. Idempotent — a second call returns this same sweeper. */
    start() {
      if (timer) return api;
      if (off(env?.PAYMENT_SWEEP_DISABLED)) {
        status.disabled_reason = 'PAYMENT_SWEEP_DISABLED is set';
        return api;
      }
      status.enabled = true;
      // One sweep shortly after boot: this is what settles a payment the
      // process slept through, and it is deliberately ahead of the interval.
      kick = setTimeout(() => { run().catch(() => {}); }, 1_500);
      kick.unref?.();
      timer = setInterval(() => { run().catch(() => {}); }, intervalMs);
      timer.unref?.();
      return api;
    },
    stop() {
      if (kick) clearTimeout(kick);
      if (timer) clearInterval(timer);
      kick = null;
      timer = null;
      status.enabled = false;
      return api;
    },
    get running() {
      return !!timer;
    },
    status,
  };
  return api;
}

/**
 * One sweeper per process — the same pattern as the store and the bridge, so a
 * dev hot reload or a second call cannot start a second loop.
 */
export function startPaymentSweeper(options = {}) {
  const g = globalThis;
  if (g.__broodiinnoxPaymentSweeper) return g.__broodiinnoxPaymentSweeper;
  const sweeper = createPaymentSweeper(options);
  g.__broodiinnoxPaymentSweeper = sweeper;
  return sweeper.start();
}

/** Stop and forget the process sweeper (used by tests and by nothing else). */
export function stopPaymentSweeper() {
  const g = globalThis;
  const sweeper = g.__broodiinnoxPaymentSweeper;
  if (sweeper) sweeper.stop();
  g.__broodiinnoxPaymentSweeper = null;
  return sweeper || null;
}

/**
 * What the sweeper has done since this process started, for GET /api/health.
 * Always an object: "not started" is an answer too, and a service that has no
 * sweeper must say so rather than leave the question open.
 */
export function paymentSweeperReport() {
  const sweeper = globalThis.__broodiinnoxPaymentSweeper;
  if (!sweeper) {
    return { enabled: false, running: false, reason: 'not started in this process', runs: 0 };
  }
  const { enabled, disabled_reason: reason, interval_ms: intervalMs, last_run_at: lastRunAt,
    runs, settled, unlocked, errors, last_error: lastError } = sweeper.status;
  return {
    enabled,
    running: sweeper.running,
    reason: reason || null,
    interval_ms: intervalMs,
    runs,
    settled,
    unlocked,
    errors,
    last_run_at: lastRunAt,
    last_error: lastError,
  };
}
