import React, { useState } from 'react';
import { useStore } from '../lib/store.jsx';
import { avgTemp, controlAllowed } from '../lib/services.js';
import { POWER_MAX_REASSERTS } from '../lib/live.js';
import { Btn, Modal } from './ui.jsx';
import { Icon } from './icons.jsx';
import { t } from '../i18n/strings.js';

/**
 * Master ON/OFF switch for one Broodiinnox system — the farmer's and the
 * supervisor's remote power switch.
 *
 * What it drives on the hardware: the firmware has no "power the ESP32 down"
 * topic (a unit that is off could never be switched back on remotely), so the
 * switch drives the relay exactly the way the firmware's `relay` topic does:
 *
 *   ON  -> relay AUTO : thermostat control resumes, the heater follows the
 *                       target range again (never a forced heater ON, which
 *                       would overheat the house)
 *   OFF -> relay OFF  : heating is forced off, the unit keeps reporting, so it
 *                       can always be switched back on from the app
 *
 * Switching a brooder off mid-batch is destructive, so OFF asks for
 * confirmation first; ON is immediate. A LOCKED system (lapsed subscription)
 * is disabled like every other control, because the firmware silently ignores
 * relay commands while `device_locked`.
 */
export function PowerSwitch({ device, lang = 'en', small = false, showLabel = true, showHint = false }) {
  const { dispatch } = useStore();
  const [confirmOff, setConfirmOff] = useState(false);
  if (!device) return null;

  const now = new Date().toISOString();
  const name = device.name || device.id;
  const on = device.systemOn !== false; // unknown => the system is running
  const avg = avgTemp(device.sensors);
  const canControl = controlAllowed(device, now, avg);

  // What the HARDWARE reports, not what the app hopes: a live unit confirms a
  // relay command through its own `manual_control` flag, so the switch can say
  // whether the command landed — and retry while it has not.
  const live = device.live === true;
  const pending = live && device.powerPending === true;
  const unconfirmed = live && device.powerUnconfirmed === true;
  const gaveUp = unconfirmed && (device.powerRetries || 0) >= POWER_MAX_REASSERTS;

  let status = null;
  let statusKind = '';
  if (live) {
    if (pending) { status = t('power.unitSending', lang); statusKind = 'pending'; }
    else if (gaveUp) { status = t('power.unitNoConfirm', lang); statusKind = 'bad'; }
    else if (unconfirmed) { status = t('power.unitRetrying', lang); statusKind = 'pending'; }
    else status = on ? t('power.unitAuto', lang) : t('power.unitManualOff', lang);
  } else if (showHint) {
    status = canControl ? (on ? t('power.hintOn', lang) : t('power.hintOff', lang)) : t('power.locked', lang);
  }

  // Why the heater is (not) running right now — the difference between ON and
  // OFF is invisible on the hardware while the temperature sits in the band.
  const heaterLine = live && showHint
    ? (device.heaterOn
      ? t('power.heaterRunning', lang)
      : t('power.heaterIdle', lang, {
        temp: avg === null ? '—' : avg.toFixed(1),
        min: device.targets?.min ?? device.baseMin,
        max: device.targets?.max ?? device.baseMax,
      }))
    : null;
  const showStatus = showHint || (live && (pending || unconfirmed || !!device.powerError));

  const apply = (next) => {
    dispatch({ type: 'SET_SYSTEM_POWER', deviceId: device.id, on: next });
    // A simulated system has no unit to answer, so it confirms at once. A live
    // one is confirmed by the hardware itself (the status line reads that back)
    // and a refusal returns as an error toast from the store.
    if (!live) {
      dispatch({
        type: 'TOAST',
        msg: t(next ? 'power.switchedOn' : 'power.switchedOff', lang, { name }),
      });
    }
  };

  const actionLabel = t(on ? 'power.turnOff' : 'power.turnOn', lang, { name });

  return (
    <div className={`power-switch-wrap ${small ? 'small' : ''}`}>
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
        disabled={!canControl}
        onClick={(e) => {
          e.stopPropagation();
          if (on) setConfirmOff(true);
          else apply(true);
        }}
      >
        <span className="power-switch-track" aria-hidden="true"><span className="power-switch-knob" /></span>
        <span className="power-switch-state">
          <Icon name="power" size={small ? 12 : 13} />
          {on ? t('power.on', lang) : t('power.off', lang)}
        </span>
      </button>
      {showStatus && status && (
        <div className={`muted small power-switch-status ${statusKind}`} role="status" style={{ maxWidth: 340 }}>
          {status}
        </div>
      )}
      {heaterLine && <div className="muted small" style={{ maxWidth: 340 }}>{heaterLine}</div>}
      {showHint && device.powerError && (
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
