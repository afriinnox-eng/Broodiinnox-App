import React, { useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { Btn, Card, Field } from '../../components/ui.jsx';
import { Icon } from '../../components/icons.jsx';
import { LANGS, t } from '../../i18n/strings.js';

export default function AdminSettings() {
  const { state, dispatch } = useStore();
  const lang = state.lang || 'en';
  const [safetyFloor, setSafetyFloor] = useState(20);
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div>
      <h1>{t('nav.settings', lang)}</h1>
      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <Card title="Platform">
          <Field label="Safety floor temperature (°C)">
            <input type="number" value={safetyFloor} onChange={(e) => setSafetyFloor(Number(e.target.value))} />
          </Field>
          <p className="muted small">Below this temperature a locked device may still run the heater (failsafe) — subscription enforcement never creates an unsafe condition.</p>
          <div className="row-between">
            <span>Language</span>
            <select value={lang} onChange={(e) => dispatch({ type: 'SET_LANG', lang: e.target.value })}>
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </div>
          <div className="row-between" style={{ marginTop: 10 }}>
            <span>Dark mode</span>
            <button className="icon-btn" onClick={() => dispatch({ type: 'SET_THEME', theme: state.theme === 'dark' ? 'light' : 'dark' })} title="Toggle theme">
              <Icon name={state.theme === 'dark' ? 'sun' : 'moon'} size={18} />
            </button>
          </div>
          <Btn small variant="primary" style={{ marginTop: 14 }} onClick={() => dispatch({ type: 'TOAST', msg: 'Settings saved (demo).' })}>Save settings</Btn>
        </Card>

        <Card title="Data & demo">
          <p className="muted small">The app runs on a simulated backend with seeded demo data. Use the button to restore the original demo dataset.</p>
          {confirmReset ? (
            <div className="btn-row">
              <Btn variant="danger" onClick={() => { dispatch({ type: 'RESET_DATA' }); dispatch({ type: 'TOAST', msg: 'Demo data reset.' }); setConfirmReset(false); }}>Yes, reset everything</Btn>
              <Btn onClick={() => setConfirmReset(false)}>Cancel</Btn>
            </div>
          ) : (
            <Btn variant="danger" onClick={() => setConfirmReset(true)}>Reset demo data</Btn>
          )}
          <div className="muted small" style={{ marginTop: 16 }}>
            Version 1.0.0 · React + Vite · Deployed on Render · Mock IoT backend (swap for MQTT bridge + API later)
          </div>
        </Card>
      </div>
    </div>
  );
}
