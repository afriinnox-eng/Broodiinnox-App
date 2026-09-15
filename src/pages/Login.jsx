import React, { useState } from 'react';
import { useStore } from '../lib/store.jsx';
import { LANGS, t } from '../i18n/strings.js';
import { Icon } from '../components/icons.jsx';
import brandIcon from '../assets/afriinnox-icon.png';

/* The home screen's brand plate: the Afriinnox mark drawn as a ribbon along all
   four edges of the panel that holds the words — the crest that used to be a single
   line, now closed into a square around them. Each edge falls away from its own
   middle — biggest and solid at the centre, smaller and fainter toward the corners
   — so the frame is loudest where it is longest and quiet where the edges meet. */
function edgeMarks(count, maxSize, minSize, maxOpacity, minOpacity) {
  const half = (count - 1) / 2;
  return Array.from({ length: count }, (_, i) => {
    const away = Math.abs(i - half) / half; // 0 at the middle of the edge, 1 at a corner
    return {
      size: Math.round(maxSize - (maxSize - minSize) * away),
      opacity: Number((maxOpacity - (maxOpacity - minOpacity) * away).toFixed(2)),
    };
  });
}

const PLATE_HORIZONTAL = edgeMarks(9, 30, 17, 1, 0.42);
const PLATE_VERTICAL = edgeMarks(5, 24, 16, 0.9, 0.4);

/** One edge of the plate: the marks, in order, on a rail that never takes a click. */
function PlateRail({ edge, marks }) {
  return (
    <span className={`login-plate-rail ${edge}`} aria-hidden="true">
      {marks.map((m, i) => (
        <span key={i} className="login-plate-mark" style={{
          width: m.size, height: m.size, borderRadius: Math.round(m.size * 0.29), opacity: m.opacity,
        }}>
          <img src={brandIcon} alt="" />
        </span>
      ))}
    </span>
  );
}

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
        <div className="login-plate">
          <PlateRail edge="top" marks={PLATE_HORIZONTAL} />
          <PlateRail edge="bottom" marks={PLATE_HORIZONTAL} />
          <PlateRail edge="side left" marks={PLATE_VERTICAL} />
          <PlateRail edge="side right" marks={PLATE_VERTICAL} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div className="login-brand" style={{ width: 54, height: 54, borderRadius: 14, background: '#fff', display: 'grid', placeItems: 'center', padding: 5, flex: 'none' }}>
              <img src={brandIcon} alt="Afriinnox" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
            </div>
            <div>
              <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: 0.5 }}>BROODIINNOX</div>
              <div style={{ opacity: 0.85, fontSize: 12, letterSpacing: 1 }}>by AFRIINNOX Ltd</div>
            </div>
          </div>
          <h1 style={{ fontSize: 30, maxWidth: 420 }}>{t('app.subtitle', lang)}</h1>
          <p style={{ opacity: 0.85, maxWidth: 460, lineHeight: 1.6, margin: 0 }}>
            Monitor temperature, manage batches, control your brooding systems remotely and keep your chicks,
            ducklings, poults and piglets safe — from anywhere with signal.
          </p>
          <div className="row" style={{ gap: 20, margin: '4px 0 2px' }}>
            {[['flame', 'Automatic failsafe heating'], ['wifi', 'Remote control & live alerts'], ['card', 'MTN MoMo subscriptions']].map(([ic, tx]) => (
              <div key={ic} className="row" style={{ gap: 8, fontSize: 12.5, lineHeight: 1.35, alignItems: 'flex-start', maxWidth: 130 }}>
                <span style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(255,255,255,0.14)', display: 'grid', placeItems: 'center', flex: 'none' }}>
                  <Icon name={ic} size={17} />
                </span>
                <span style={{ opacity: 0.95 }}>{tx}</span>
              </div>
            ))}
          </div>
          <div className="row" style={{ gap: 8, marginTop: 2 }}>
            {['en', 'fr', 'rw'].map((c) => (
              <button key={c} className="btn" style={{ background: lang === c ? '#fff' : 'rgba(255,255,255,0.15)', color: lang === c ? '#1c3a96' : '#fff', borderColor: 'transparent' }}
                onClick={() => dispatch({ type: 'SET_LANG', lang: c })}>
                {LANGS.find((l) => l.code === c).label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', placeItems: 'center', padding: 32 }}>
        <div style={{ width: '100%', maxWidth: 400 }}>
          <div className="tabs" style={{ borderBottom: 'none', justifyContent: 'center', marginBottom: 20 }}>
            <div className={`tab ${isFarmer ? 'active' : ''}`} style={{
              fontSize: 15, display: 'flex', alignItems: 'center', gap: 7,
              color: isFarmer ? '#1c3a96' : 'var(--text-muted)',
              borderBottom: isFarmer ? '2.5px solid #1c3a96' : '2.5px solid transparent',
            }} onClick={() => setMode('farmer')}><Icon name="users" size={17} /> {t('login.farmer', lang)}</div>
            <div className={`tab ${!isFarmer ? 'active' : ''}`} style={{
              fontSize: 15, display: 'flex', alignItems: 'center', gap: 7,
              color: !isFarmer ? '#0b0f1a' : 'var(--text-muted)',
              borderBottom: !isFarmer ? '2.5px solid #0b0f1a' : '2.5px solid transparent',
            }} onClick={() => setMode('admin')}><Icon name="shield" size={17} /> {t('login.admin', lang)}</div>
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
            <button className="btn" style={{
              width: '100%', justifyContent: 'center', padding: 11,
              background: isFarmer ? 'var(--brand-blue)' : '#0b0f1a',
              borderColor: isFarmer ? 'var(--brand-blue)' : '#0b0f1a',
              color: '#fff',
            }}>{t('login.signIn', lang)}</button>
          </form>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span className="muted small">{t('login.or', lang)}</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          <div className="grid cols-2">
            <button className="btn" style={{ justifyContent: 'center' }} onClick={() => doLogin(isFarmer ? { id: 'f1', name: 'Jean Damascene', role: 'farmer', phone: '0788123456' } : { id: 'a1', name: 'Innocent Ingabire', role: 'admin', adminRole: 'super', email: 'admin@afriinnox.com' })}>
              <Icon name={isFarmer ? 'users' : 'shield'} size={16} /> {t(isFarmer ? 'login.demoFarmer' : 'login.demoAdmin', lang)}
            </button>
            <button className="btn" style={{ justifyContent: 'center' }} onClick={() => doLogin(isFarmer ? { id: 'f2', name: 'Clarisse Uwera', role: 'farmer', phone: '0788222333' } : { id: 'a2', name: 'Grace Uwase', role: 'admin', adminRole: 'operations', email: 'ops@afriinnox.com' })}>
              <Icon name="user" size={16} /> {isFarmer ? 'Clarisse' : 'Ops Admin'}
            </button>
          </div>
          <p className="muted small" style={{ textAlign: 'center', marginTop: 16 }}>{t('login.demoHint', lang)}</p>

          {/* The price sheet publishes these; the sign-in screen is exactly where a
              locked-out or offline subscriber lands, so the real channels sit here. */}
          <div className="login-contact">
            <span className="login-contact-label">Need a hand getting in?</span>
            <a href="mailto:info@afriinnox.com"><Icon name="mail" size={15} /> info@afriinnox.com</a>
            <a href="tel:+250795814403"><Icon name="phone" size={15} /> +250 795 814 403</a>
          </div>
        </div>
      </div>
    </div>
  );
}
