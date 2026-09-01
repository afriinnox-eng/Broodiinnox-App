import React, { useState } from 'react';
import { useStore } from '../lib/store.jsx';
import { LANGS, t } from '../i18n/strings.js';

export default function Login() {
  const { state, dispatch } = useStore();
  const [mode, setMode] = useState('farmer'); // farmer | admin
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const lang = state.lang || 'en';
  const isFarmer = mode === 'farmer';

  const doLogin = (user) => {
    dispatch({ type: 'LOGIN', user });
  };

  const submit = (e) => {
    e.preventDefault();
    if (isFarmer) {
      const farmer = state.farmers.find((f) => f.phone === id.replace(/\s/g, ''));
      if (farmer) return doLogin({ id: farmer.id, name: farmer.name, role: 'farmer', phone: farmer.phone });
      if (id) return doLogin({ id: 'f-demo', name: id, role: 'farmer', phone: id });
    } else {
      const admin = state.admins.find((a) => a.email.toLowerCase() === id.toLowerCase());
      if (admin) return doLogin({ id: admin.id, name: admin.name, role: 'admin', adminRole: admin.role, email: admin.email });
      if (id) return doLogin({ id: 'a-demo', name: id, role: 'admin', adminRole: 'super', email: id });
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '1fr 1fr', background: 'var(--bg)' }}>
      <div style={{
        background: 'linear-gradient(150deg, #1c3a96 0%, #12266a 60%, #3d5d30 130%)',
        color: '#fff', padding: 48, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 18,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 54, height: 54, borderRadius: 14, background: '#fff', color: '#1c3a96', display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 26 }}>A</div>
          <div>
            <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: 0.5 }}>AFRIINNOX</div>
            <div style={{ opacity: 0.85, textTransform: 'uppercase', fontSize: 12, letterSpacing: 2 }}>Broodiinnox Smart Brooding</div>
          </div>
        </div>
        <h1 style={{ fontSize: 30, maxWidth: 420 }}>{t('app.subtitle', lang)}</h1>
        <p style={{ opacity: 0.85, maxWidth: 460, lineHeight: 1.6 }}>
          Monitor temperature, manage batches, control your brooding systems remotely and keep your chicks,
          ducklings, poults and piglets safe — from anywhere with signal.
        </p>
        <div className="row" style={{ gap: 8 }}>
          {['en', 'fr', 'rw'].map((c) => (
            <button key={c} className="btn" style={{ background: lang === c ? '#fff' : 'rgba(255,255,255,0.15)', color: lang === c ? '#1c3a96' : '#fff', borderColor: 'transparent' }}
              onClick={() => dispatch({ type: 'SET_LANG', lang: c })}>
              {LANGS.find((l) => l.code === c).label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', placeItems: 'center', padding: 32 }}>
        <div style={{ width: '100%', maxWidth: 400 }}>
          <div className="tabs" style={{ borderBottom: 'none', justifyContent: 'center', marginBottom: 20 }}>
            <div className={`tab ${isFarmer ? 'active' : ''}`} style={{ fontSize: 15 }} onClick={() => setMode('farmer')}>👨‍🌾 {t('login.farmer', lang)}</div>
            <div className={`tab ${!isFarmer ? 'active' : ''}`} style={{ fontSize: 15 }} onClick={() => setMode('admin')}>🏢 {t('login.admin', lang)}</div>
          </div>
          <h2 style={{ textAlign: 'center' }}>{t('login.title', lang)}</h2>
          <p className="muted" style={{ textAlign: 'center', marginBottom: 24 }}>{t('login.subtitle', lang)}</p>

          <form onSubmit={submit}>
            <div className="field">
              <label>{isFarmer ? t('login.phone', lang) : t('login.email', lang)}</label>
              <input value={id} onChange={(e) => setId(e.target.value)}
                placeholder={isFarmer ? '0788123456' : 'admin@afriinnox.com'} required />
            </div>
            <div className="field">
              <label>{t('login.password', lang)}</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••" required />
            </div>
            <button className="btn primary" style={{ width: '100%', justifyContent: 'center', padding: 11 }}>{t('login.signIn', lang)}</button>
          </form>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span className="muted small">{t('login.or', lang)}</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          <div className="grid cols-2">
            <button className="btn" onClick={() => doLogin(isFarmer ? { id: 'f1', name: 'Jean Damascene', role: 'farmer', phone: '0788123456' } : { id: 'a1', name: 'Innocent Ingabire', role: 'admin', adminRole: 'super', email: 'admin@afriinnox.com' })}>
              {isFarmer ? '👨‍🌾' : '🛡️'} {t(isFarmer ? 'login.demoFarmer' : 'login.demoAdmin', lang)}
            </button>
            <button className="btn" onClick={() => doLogin(isFarmer ? { id: 'f2', name: 'Clarisse Uwera', role: 'farmer', phone: '0788222333' } : { id: 'a2', name: 'Grace Uwase', role: 'admin', adminRole: 'operations', email: 'ops@afriinnox.com' })}>
              {isFarmer ? '👩‍🌾' : '🛡️'} {isFarmer ? 'Clarisse' : 'Ops Admin'}
            </button>
          </div>
          <p className="muted small" style={{ textAlign: 'center', marginTop: 16 }}>{t('login.demoHint', lang)}</p>
        </div>
      </div>
    </div>
  );
}
