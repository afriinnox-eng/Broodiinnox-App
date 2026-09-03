/**
 * MQTT bridge — the live connection to the firmware fleet.
 *
 * Subscribes to every device's `/data` and `/status` under the topic prefix
 * ("BROODIINNOX/+/data", "BROODIINNOX/+/status"), normalizes what arrives
 * (see lib/ingest.js), persists readings + merged device state through the
 * store, raises alerts on flag transitions, and publishes validated control
 * messages back to `.../control/<cmd>` topics.
 *
 * One bridge lives for the lifetime of the Next.js server process
 * (globalThis singleton in lib/server.js).
 */
import mqtt from 'mqtt';
import { ingestMessage, toReadingRow } from './ingest.js';
import { deviceTopic } from './constants.js';

function rnd() {
  return Math.random().toString(16).slice(2, 10);
}

export class Bridge {
  constructor({ url, prefix = 'BROODIINNOX', username, password, store, log = console }) {
    this.url = url;
    this.prefix = prefix;
    this.username = username || undefined;
    this.password = password || undefined;
    this.store = store;
    this.log = log;
    this.client = null;
    this.connected = false;
    this.started = false;
    this.stopped = false;
    this.lastError = null;
    this.lastConnectAt = null;
    this.mem = new Map();      // deviceId -> authoritative merged state (camelCase)
    this.prev = new Map();     // deviceId -> {locked,failsafe,sensorErr,mismatch,online}
    this._ready = null;
  }

  async start() {
    if (this.started) return this._ready;
    this.started = true;

    this._ready = new Promise((resolve) => {
      const client = mqtt.connect(this.url, {
        clientId: `broodiinnox-api-${rnd()}`,
        username: this.username,
        password: this.password,
        clean: true,
        reconnectPeriod: 10_000,
        connectTimeout: 15_000,
      });
      this.client = client;

      const done = (ok) => {
        if (this._resolved) return;
        this._resolved = true;
        resolve({ connected: ok });
      };
      // resolve after at most 15 s even if the broker never answers, so the
      // API still comes up (and keeps retrying in the background)
      setTimeout(() => done(this.connected), 15_000);

      client.on('connect', async () => {
        this.connected = true;
        this.lastConnectAt = Date.now();
        this.lastError = null;
        this.log.log(`[bridge] connected to ${this.url}`);
        try {
          const data = deviceTopic(this.prefix, '+', 'data');
          const status = deviceTopic(this.prefix, '+', 'status');
          await client.subscribeAsync([data, status], { qos: 1 });
          this.log.log(`[bridge] subscribed ${data} ${status}`);
        } catch (err) {
          this.log.error(`[bridge] subscribe failed: ${err.message}`);
        }
        done(true);
      });
      client.on('message', (topic, payload) => {
        this.handle(topic, payload).catch((err) => this.log.error(`[bridge] handle error: ${err.message}`));
      });
      client.on('close', () => {
        this.connected = false;
      });
      client.on('error', (err) => {
        this.lastError = err.message;
        this.connected = false;
        this.log.error(`[bridge] mqtt error: ${err.message}`);
      });
      client.on('reconnect', () => this.log.log('[bridge] reconnecting...'));
      client.on('offline', () => {
        this.connected = false;
      });
    });

    return this._ready;
  }

  /** Publish one validated control message. Throws when not connected. */
  async publish(topic, payload) {
    if (!this.client || !this.connected) {
      throw new Error(`MQTT not connected (${this.lastError || 'no session'})`);
    }
    await this.client.publishAsync(topic, payload, { qos: 1 });
    this.log.log(`[bridge] published ${topic} <- ${payload}`);
  }

  /** Full merged state for a device (used for command validation bounds). */
  getDeviceState(deviceId) {
    return this.mem.get(deviceId) || null;
  }

  async handle(topic, payload) {
    const ev = ingestMessage(topic, payload);
    if (!ev || !ev.deviceId) return;

    const id = ev.deviceId;
    const cur = this.mem.get(id) || { deviceId: id };
    const prevFlags = this.prev.get(id) || {
      locked: false, failsafe: false, sensorErr: false, mismatch: false, online: false,
    };

    if (ev.kind === 'offline') {
      const wasOnline = prevFlags.online;
      this.mem.set(id, { ...cur, deviceId: id, online: false, lastSeenAt: Date.now() });
      this.prev.set(id, { ...prevFlags, online: false });
      await this.store.upsertState(id, this.mem.get(id));
      if (wasOnline) {
        await this.store.logAlert({
          device_id: id, severity: 'warning', kind: 'device.offline',
          message: 'Device stopped publishing (LWT offline) — no heartbeat for too long.',
        });
      }
      return;
    }

    if (ev.kind === 'unknown') return;

    // Build merged state patch from whatever the event carries
    const patch = { deviceId: id, online: true, lastSeenAt: Date.now() };
    if (ev.kind === 'data') {
      Object.assign(patch, {
        relayOn: ev.relayOn, manual: ev.manual,
        day: ev.day, totalDays: ev.total_days,
        maxTemp: ev.max_temp, minTemp: ev.min_temp,
        aveTemp: ev.ave_temp,
        temp1: ev.temp1, temp2: ev.temp2, temp3: ev.temp3, temp4: ev.temp4,
        s1Enabled: ev.s1_enabled, s2Enabled: ev.s2_enabled,
        s3Enabled: ev.s3_enabled, s4Enabled: ev.s4_enabled,
        failsafeMode: ev.failsafe_mode, sensorError: ev.sensor_error,
        mismatchError: ev.mismatch_error, locked: ev.device_locked,
        signal: ev.signal_quality, error: ev.error, deviceTs: ev.device_ts,
      });
    } else {
      // status / online heartbeat — subset only
      if (ev.locked !== undefined) patch.locked = ev.locked;
      if (ev.relayOn !== undefined && ev.relayOn !== null) patch.relayOn = ev.relayOn;
      if (ev.manual !== undefined && ev.manual !== null) patch.manual = ev.manual;
      if (ev.day !== undefined && ev.day !== null) patch.day = Math.max(0, Math.trunc(ev.day));
      if (ev.total_days !== undefined && ev.total_days !== null) patch.totalDays = Math.max(1, Math.min(365, Math.trunc(ev.total_days)));
      if (ev.max_temp !== undefined && ev.max_temp !== null) patch.maxTemp = ev.max_temp;
      if (ev.min_temp !== undefined && ev.min_temp !== null) patch.minTemp = ev.min_temp;
      if (ev.ave_temp !== undefined && ev.ave_temp !== null) patch.aveTemp = ev.ave_temp;
      if (ev.failsafe_mode !== undefined && ev.failsafe_mode !== null) patch.failsafeMode = ev.failsafe_mode;
      if (ev.signal_quality !== undefined && ev.signal_quality !== null) patch.signal = ev.signal_quality;
      if (ev.device_ts !== undefined && ev.device_ts !== null) patch.deviceTs = ev.device_ts;
    }

    const next = { ...cur, ...patch };
    this.mem.set(id, next);
    this.prev.set(id, {
      locked: !!next.locked, failsafe: !!next.failsafeMode,
      sensorErr: !!next.sensorError, mismatch: !!next.mismatchError, online: true,
    });

    if (ev.kind === 'data') {
      const row = toReadingRow(ev);
      if (row) await this.store.saveReading(row);
    }
    await this.store.upsertState(id, next);

    // Alert transitions (firmware flag flips), deduped by comparing prev flags
    const defs = [
      ['locked', 'locked', 'critical', 'device.locked', 'Device subscription lock engaged — all control disabled.'],
      ['failsafe', 'failsafeMode', 'critical', 'failsafe.engaged', 'All sensors failed — failsafe: heater forced ON.'],
      ['sensorErr', 'sensorError', 'warning', 'sensor.fault', 'One or more temperature sensors are failing.'],
      ['mismatch', 'mismatchError', 'warning', 'sensor.mismatch', 'Sensors disagree sharply with each other.'],
    ];
    for (const [flagKey, curKey, sev, kind, msg] of defs) {
      const nowVal = !!next[curKey];
      if (nowVal && !prevFlags[flagKey]) {
        await this.store.logAlert({ device_id: id, severity: sev, kind, message: msg });
      } else if (!nowVal && prevFlags[flagKey]) {
        const recover = {
          failsafeMode: ['info', 'failsafe.cleared', 'Sensors recovered — failsafe cleared, normal control resumed.'],
          sensorError: ['info', 'sensor.recovered', 'Sensor readings recovered.'],
          locked: ['info', 'device.unlocked', 'Device unlocked via device_active=ACTIVE.'],
          mismatchError: ['info', 'sensor.mismatch_cleared', 'Sensor readings agree again.'],
        }[curKey];
        if (recover) {
          const [rSev, rKind, rMsg] = recover;
          await this.store.logAlert({ device_id: id, severity: rSev, kind: rKind, message: rMsg });
        }
      }
    }
  }
}
