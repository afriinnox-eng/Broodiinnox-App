import React, { useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { Btn, Card, Field } from '../../components/ui.jsx';
import { Icon } from '../../components/icons.jsx';
import { LANGS, t } from '../../i18n/strings.js';

export default function FarmerSettings() {
  const { state, dispatch } = useStore();
  const lang = state.lang || 'en';
  const me = state.farmers.find((f) => f.id === state.session.id) || { name: state.session.name, phone: state.session.phone, email: '' };
  const [name, setName] = useState(me.name);
  const [phone, setPhone] = useState(me.phone);
  const [email, setEmail] = useState(me.email || '');
  const [pwd, setPwd] = useState('');
  const [twoFa, setTwoFa] = useState(false);
  const [unit, setUnit] = useState('C');
  const [saved, setSaved] = useState(false);

  const save = () => {
    dispatch({ type: 'UPDATE_FARMER', id: me.id, patch: { name, phone, email } });
    dispatch({ type: 'TOAST', msg: 'Profile saved.' });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <h1>{t('nav.settings', lang)}</h1>
      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <Card title="Account">
          <Field label="Full name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Phone number"><input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label="Email"><input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Btn variant="primary" onClick={save}>{saved ? 'Saved' : 'Save changes'}</Btn>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title="Application">
            <Field label="Language">
              <select value={lang} onChange={(e) => dispatch({ type: 'SET_LANG', lang: e.target.value })}>
                {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </Field>
            <div className="row-between">
              <span>Temperature unit</span>
              <select value={unit} onChange={(e) => setUnit(e.target.value)}>
                <option value="C">°Celsius</option>
                <option value="F">°Fahrenheit</option>
              </select>
            </div>
            <div className="row-between" style={{ marginTop: 10 }}>
              <span>Dark mode</span>
              <button className="icon-btn" onClick={() => dispatch({ type: 'SET_THEME', theme: state.theme === 'dark' ? 'light' : 'dark' })} title="Toggle theme">
                <Icon name={state.theme === 'dark' ? 'sun' : 'moon'} size={18} />
              </button>
            </div>
          </Card>

          <Card title="Security">
            <Field label="Change password"><input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="New password" /></Field>
            <Btn small onClick={() => { if (pwd) { dispatch({ type: 'TOAST', msg: 'Password updated (demo).' }); setPwd(''); } }}>Update password</Btn>
            <div className="row-between" style={{ marginTop: 12 }}>
              <span>Two-factor authentication</span>
              <input type="checkbox" checked={twoFa} onChange={(e) => setTwoFa(e.target.checked)} />
            </div>
            <div className="muted small" style={{ marginTop: 10 }}>Active sessions: this device · Kigali, RW</div>
          </Card>
        </div>
      </div>
    </div>
  );
}
