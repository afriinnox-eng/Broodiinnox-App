import React, { useState } from 'react';
import { useStore } from '../lib/store.jsx';
import { avgTemp, controlAllowed } from '../lib/services.js';
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
  const canControl = controlAllowed(device, now, avgTemp(device.sensors));

  const apply = (next) => {
    dispatch({ type: 'SET_SYSTEM_POWER', deviceId: device.id, on: next });
    dispatch({
      type: 'TOAST',
      msg: t(next ? 'power.switchedOn' : 'power.switchedOff', lang, { name }),
    });
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
      {showHint && (
        <div className="muted small" style={{ maxWidth: 340 }}>
          {canControl ? (on ? t('power.hintOn', lang) : t('power.hintOff', lang)) : t('power.locked', lang)}
        </div>
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
