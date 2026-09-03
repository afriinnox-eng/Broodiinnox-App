/**
 * Protocol constants mirrored 1:1 from BROODIINNOX_V11.ino.
 * If the firmware changes these, change them here too — the server must
 * speak exactly the dialect the device firmware implements.
 */

/** Topic namespace prefix (firmware builds topics as "BROODIINNOX/<id>/..." ). */
export const DEFAULT_TOPIC_PREFIX = 'BROODIINNOX';

/** Firmware default device id (const DEVICE_ID in the .ino). */
export const DEFAULT_DEVICE_ID = 'BROODIINNOX-002';

/** A valid device id is what the firmware accepts after the prefix in a topic. */
export const DEVICE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

/** Animal presets, order + names identical to `animal_names[]` in the .ino. */
export const ANIMAL_PRESETS = ['Chicken', 'Pig', 'Turkey', 'Duck'];

/** Per-sensor selectors, identical to the firmware's DS1..DS4 control strings. */
export const SENSOR_IDS = ['DS1', 'DS2', 'DS3', 'DS4'];

/** Relay control payloads the firmware understands (mqtt_callback, topic_relay). */
export const RELAY_MODES = ['ON', 'OFF', 'AUTO'];

/** Subscription kill-switch payloads (topic_device_active). */
export const DEVICE_ACTIVE_MODES = ['LOCKED', 'ACTIVE'];

/** Factory-reset payload (topic_factory_reset expects exactly "RESET"). */
export const FACTORY_RESET_PAYLOAD = 'RESET';

/** Control topic suffixes (substring after `<prefix>/<id>/control/`). */
export const CONTROL_TOPICS = {
  relay: 'relay',
  max_temp: 'max_temp',
  min_temp: 'min_temp',
  total_days: 'total_days',
  sensor: 'sensor',
  factory_reset: 'factory_reset',
  animal_preset: 'animal_preset',
  device_active: 'device_active',
  set_time: 'set_time',
};

/**
 * Commands that are refused while the device is LOCKED — exactly the set the
 * firmware checks `if (device_locked) return;` against in mqtt_callback.
 * device_active is deliberately NOT in the set: it is how the device gets
 * locked / unlocked in the first place.
 */
export const COMMANDS_BLOCKED_WHEN_LOCKED = new Set([
  'relay',
  'max_temp',
  'min_temp',
  'total_days',
  'sensor',
  'factory_reset',
  'animal_preset',
  'set_time',
]);

/** Remote set-point bounds enforced by mqtt_callback in the firmware. */
export const BOUNDS = {
  max_temp: { upper: 50 },                 // and must stay > current min
  min_temp: { lower: 10 },                 // and must stay < current max
  total_days: { lower: 1, upper: 365 },
};

/** Heartbeat cadence in the firmware (MQTTTask) — used for staleness. */
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const OFFLINE_AFTER_MS = HEARTBEAT_INTERVAL_MS * 4; // no msg for 2 min => offline

export function deviceTopic(prefix, deviceId, suffix) {
  return `${prefix || DEFAULT_TOPIC_PREFIX}/${deviceId}/${suffix}`;
}

export function controlTopic(prefix, deviceId, command) {
  return deviceTopic(prefix, deviceId, `control/${command}`);
}
