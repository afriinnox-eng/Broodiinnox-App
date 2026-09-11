import React, { useState } from 'react';
import { useStore } from '../lib/store.jsx';
import { avgTemp, controlAllowed } from '../lib/services.js';
import { POWER_MAX_REASSERTS, deviceMode, liveConfig } from '../lib/live.js';
import { Btn, Modal } from './ui.jsx';
import { Icon } from './icons.jsx';
import { t } from '../i18n/strings.js';

/**
 * Remote control for one Broodiinnox system: the AUT/MAN mode selector and the
 * master ON/OFF switch.
 *
 * The two are deliberately separate controls, because they answer different
 * questions:
 *
 *   AUT  the system runs itself — the firmware's thermostat drives the heater
 *        from the temperature against the target band. Switch ON/OFF is NOT the
 *        operator's to make here, so the switch is disabled and reads the mode.
 *   MAN  the operator holds the heater: ON keeps it running, OFF keeps it
 *        stopped, regardless of the temperature.
 *
 * On the wire this is exactly the firmware's `relay` topic, which is what
 * `mqtt_callback()` implements:
 *
 *   AUT      -> relay AUTO   (manual_relay_control = false, thermostat control)
 *   MAN  ON  -> relay ON     (manual_relay_control = true, heater held ON)
 *   MAN  OFF -> relay OFF    (manual_relay_control = true, heater held OFF)
 *
 * and the unit reports it back as `manual_control` (the mode) plus
 * `relay_state` (the heater inside MAN) — which is what this app reads, so it
 * can never show a selection the hardware is not in. Crucially, a flip of the
 * ON/OFF switch never changes the mode: the mode used to be lost on every
 * switch-on, because ON sent relay AUTO.
 *
 * Switching a brooder off mid-batch is destructive, so MAN OFF asks for
 * confirmation first; the other transitions are immediate. A LOCKED system
 * (lapsed subscription) is disabled like every other control, because the
 * firmware silently ignores relay commands while `device_locked`.
 */
export function PowerSwitch({ device, lang = 'en', small = false, showLabel = true, showHint = false }) {
  const { state, dispatch } = useStore();
  const [confirmOff, setConfirmOff] = useState(false);
  if (!device) return null;

  const now = new Date().toISOString();
  const name = device.name || device.id;
  const mode = deviceMode(device);
  const manual = mode === 'manual';
  // In AUT the system is running and the thermostat owns the heater, so the
  // knob reads that instead of a state somebody set.
  const on = manual ? device.systemOn !== false : true;
  const avg = avgTemp(device.sensors);
  const canControl = controlAllowed(device, now, avg);
  const canFlip = canControl && manual;

  // What the HARDWARE reports, not what the app hopes: a live unit confirms the
  // mode through its own `manual_control` flag and the heater through
  // `relay_state`, so both controls can say whether the command landed.
  const live = device.live === true;
  const modePending = live && device.modePending === true;
  const modeUnconfirmed = live && device.modeUnconfirmed === true;
  const modeFailed = modeUnconfirmed && (device.powerRetries || 0) >= POWER_MAX_REASSERTS;
  const pending = live && device.powerPending === true;
  const unconfirmed = live && device.powerUnconfirmed === true;
  const gaveUp = unconfirmed && (device.powerRetries || 0) >= POWER_MAX_REASSERTS;

  // This app is wired to the control server, but THIS card has no unit behind
  // it — a seeded demo system, or one the server does not know. Choosing a mode
  // or flipping it cannot move any hardware, and the card must say so instead
  // of claiming a command that never left the browser.
  const demoCard = liveConfig.enabled && !live;
  // ... and if the control server itself is not answering, NO control can reach
  // a unit, which is the one thing the operator must be told.
  const health = state?.liveHealth || null;
  const serverDown = liveConfig.enabled && health?.ok === false;

  let status = null;
  let statusKind = '';
  if (demoCard) {
    status = t('power.demoCard', lang);
    statusKind = 'pending';
  } else if (serverDown) {
    status = t('power.serverDown', lang);
    statusKind = 'bad';
  } else if (live) {
    if (modePending) { status = t('mode.unitSending', lang); statusKind = 'pending'; }
    else if (modeFailed) { status = t('mode.unitNoConfirm', lang); statusKind = 'bad'; }
    else if (modeUnconfirmed) { status = t('mode.unitRetrying', lang); statusKind = 'pending'; }
    else if (pending) { status = t('power.unitSending', lang); statusKind = 'pending'; }
    else if (gaveUp) { status = t('power.unitNoConfirm', lang); statusKind = 'bad'; }
    else if (unconfirmed) { status = t('power.unitRetrying', lang); statusKind = 'pending'; }
    else status = manual
      ? (device.heaterOn ? t('power.unitManualOn', lang) : t('power.unitManualOff', lang))
      : t('power.unitAuto', lang);
  } else if (showHint) {
    status = canControl
      ? (manual
        ? (device.heaterOn ? t('mode.hintManualOn', lang) : t('power.hintOff', lang))
        : t('power.hintOn', lang))
      : t('power.locked', lang);
  }

  // Why the heater is (not) running right now — in AUT the difference between
  // the target band and the temperature is invisible on the hardware.
  const heaterLine = live && showHint && !manual
    ? (device.heaterOn
      ? t('power.heaterRunning', lang)
      : t('power.heaterIdle', lang, {
        temp: avg === null ? '—' : avg.toFixed(1),
        min: device.targets?.min ?? device.baseMin,
        max: device.targets?.max ?? device.baseMax,
      }))
    : null;
  // MAN ON holds the relay on whatever the temperature does — that is the point
  // of manual heating, and the operator should read it where they are looking.
  const manualOnLine = manual && showHint && device.heaterOn === true ? t('mode.heldOn', lang) : null;
  const showStatus = demoCard || serverDown || showHint
    || (live && (pending || unconfirmed || modePending || modeUnconfirmed || !!device.powerError));

  const apply = (next) => {
    dispatch({ type: 'SET_SYSTEM_POWER', deviceId: device.id, on: next });
    // A simulated system has no unit to answer, so it confirms at once. A live
    // one is confirmed by the hardware itself (the status line reads that back)
    // and a refusal returns as an error toast from the store.
    if (!live) {
      dispatch({
        type: 'TOAST',
        msg: demoCard
          ? t('power.demoFlip', lang, { name })
          : t(next ? 'power.switchedOn' : 'power.switchedOff', lang, { name }),
      });
    }
  };

  const setMode = (next) => {
    if (next === mode) return;
    // Choosing MAN takes the heater over in the state it is already in, so the
    // mode button itself never moves the relay.
    dispatch({
      type: 'SET_SYSTEM_MODE',
      deviceId: device.id,
      mode: next,
      on: next === 'manual' ? device.heaterOn === true : undefined,
    });
    if (!live) {
      dispatch({
        type: 'TOAST',
        msg: demoCard
          ? t('mode.demoFlip', lang, { name })
          : t(next === 'manual' ? 'mode.switchedManual' : 'mode.switchedAuto', lang, { name }),
      });
    }
  };

  const actionLabel = manual
    ? t(on ? 'power.turnOff' : 'power.turnOn', lang, { name })
    : t('mode.autoTitle', lang);

  return (
    <div className={`power-switch-wrap ${small ? 'small' : ''}`}>
      {/* SYSTEM [ON/OFF] on the left, MODE [AUT|MAN] to its right — one row,
          so the two controls that belong together read together. */}
      <div className="power-controls">
        <div className="power-row">
          {showLabel && <span className="power-switch-label">{t('power.system', lang)}</span>}
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={actionLabel}
            title={canControl ? actionLabel : t('power.locked', lang)}
            className={`power-switch ${on ? 'on' : 'off'} ${small ? 'small' : ''}`}
            data-device-id={device.id}
            data-power={on ? 'on' : 'off'}
            data-mode={mode}
            disabled={!canFlip}
            onClick={(e) => {
              e.stopPropagation();
              if (!manual) return; // AUT: the system switches the heater itself
              if (on) setConfirmOff(true);
              else apply(true);
            }}
          >
            <span className="power-switch-track" aria-hidden="true"><span className="power-switch-knob" /></span>
            <span className="power-switch-state">
              <Icon name="power" size={small ? 12 : 13} />
              {manual ? (on ? t('power.on', lang) : t('power.off', lang)) : t('mode.auto', lang)}
            </span>
          </button>
        </div>
        <div className="mode-row">
          {showLabel && <span className="power-switch-label">{t('mode.label', lang)}</span>}
          <div className={`mode-options ${small ? 'small' : ''}`} role="group" aria-label={t('mode.group', lang)}>
            <button
              type="button"
              className={`mode-option ${manual ? '' : 'active'}`}
              aria-pressed={!manual}
              data-mode-device-id={device.id}
              data-mode="auto"
              disabled={!canControl}
              title={canControl ? t('mode.autoTitle', lang) : t('power.locked', lang)}
              onClick={(e) => { e.stopPropagation(); setMode('auto'); }}
            >
              {t('mode.auto', lang)}
            </button>
            <button
              type="button"
              className={`mode-option manual-option ${manual ? 'active' : ''}`}
              aria-pressed={manual}
              data-mode-device-id={device.id}
              data-mode="manual"
              disabled={!canControl}
              title={canControl ? t('mode.manualTitle', lang) : t('power.locked', lang)}
              onClick={(e) => { e.stopPropagation(); setMode('manual'); }}
            >
              {t('mode.manual', lang)}
            </button>
          </div>
        </div>
      </div>
      {showStatus && status && (
        <div className={`muted small power-switch-status ${statusKind}`} role="status" style={{ maxWidth: 340 }}>
          {status}
        </div>
      )}
      {heaterLine && <div className="muted small" style={{ maxWidth: 340 }}>{heaterLine}</div>}
      {manualOnLine && <div className="muted small" style={{ maxWidth: 340 }}>{manualOnLine}</div>}
      {device.powerError && (
        <div className="small power-switch-status bad" style={{ maxWidth: 340 }}>{device.powerError}</div>
      )}
      {confirmOff && (
        <Modal title={t('power.confirmTitle', lang, { name })} onClose={() => setConfirmOff(false)}>
          <p>{t('power.confirmBody', lang)}</p>
          <div className="btn-row">
            <Btn variant="danger" onClick={() => { setConfirmOff(false); apply(false); }}>
              {t('power.confirmYes', lang)}
            </Btn>
            <Btn onClick={() => setConfirmOff(false)}>{t('common.cancel', lang)}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default PowerSwitch;
