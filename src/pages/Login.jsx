import React, { useState } from 'react';
import { useStore } from '../lib/store.jsx';
import { LANGS, t } from '../i18n/strings.js';
import { Icon } from '../components/icons.jsx';
import brandIcon from '../assets/afriinnox-icon.png';

/* The home screen's brand plate: the Afriinnox mark drawn as a ribbon along all
   four edges of the panel that sits below the mark and the product name — the crest
   that used to be a single line, now closed into a square around the rest of what
   the screen says. Each edge falls away from its own middle — biggest and solid at
   the centre, smaller and fainter toward the corners — so the frame is loudest where
   it is longest and quiet where the edges meet. */
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
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const lang = state.lang || 'en';

  const doLogin = (user) => {
    setError('');
    dispatch({ type: 'LOGIN', user });
  };

  /* Who someone is comes from the registration, not from a choice on this screen. The
     Super Admin registers every account, so the identifier they were given - an email
     or a phone number - is what decides which shell they land in, a farmer's or the
     console's. An identifier nobody registered signs nobody in. */
  const lookup = (raw) => {
    const typed = raw.trim();
    if (!typed) return null;
    const byEmail = typed.includes('@');
    const phone = typed.replace(/[\s-]/g, '');
    const farmer = state.farmers.find((f) => (byEmail
      ? (f.email || '').toLowerCase() === typed.toLowerCase()
      : f.phone === phone));
    if (farmer) return { id: farmer.id, name: farmer.name, role: 'farmer', phone: farmer.phone, email: farmer.email };
    const admin = state.admins.find((a) => (byEmail
      ? a.email.toLowerCase() === typed.toLowerCase()
      : (a.phone || '').replace(/[\s-]/g, '') === phone));
    if (admin) return { id: admin.id, name: admin.name, role: 'admin', adminRole: admin.role, email: admin.email, phone: admin.phone };
    return null;
  };

  const submit = (e) => {
    e.preventDefault();
    const account = lookup(id);
    if (!account) return setError(t('login.notRegistered', lang));
    doLogin(account);
  };

  /* the demo shortcuts sign in as the first registered account of each kind, through
     the same lookup - there is no second way in */
  const demo = (list) => (list[0] ? lookup(list[0].email || list[0].phone) : null);

  return (
    <div className="login-shell">
      <div className="login-brand-pane">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="login-brand" style={{ width: 54, height: 54, borderRadius: 14, background: '#fff', display: 'grid', placeItems: 'center', padding: 5, flex: 'none' }}>
            <img src={brandIcon} alt="Afriinnox" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
          </div>
          <div>
            <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: 0.5 }}>BROODIINNOX</div>
            <div style={{ opacity: 0.85, fontSize: 12, letterSpacing: 1 }}>by AFRIINNOX Ltd</div>
          </div>
        </div>
        {/* the frame starts below the mark and the product name, and circles only
            what follows it — not the icon, not BROODIINNOX */}
        <div className="login-plate">
          <PlateRail edge="top" marks={PLATE_HORIZONTAL} />
          <PlateRail edge="bottom" marks={PLATE_HORIZONTAL} />
          <PlateRail edge="side left" marks={PLATE_VERTICAL} />
          <PlateRail edge="side right" marks={PLATE_VERTICAL} />
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: 0.2, margin: 0 }}>{t('app.subtitle', lang)}</h1>
          <p className="login-plate-line">
            Monitor temperature, control the brooding, and keep every batch of chicks, ducks and turkeys safe.
          </p>

          <div className="login-promises">
            {[['wifi', 'Monitor & control anywhere, anytime!'], ['chart', 'Every batch on record, for years'], ['bulb', 'Professional brooding tips']].map(([ic, tx]) => (
              <div key={ic} className="login-promise">
                <span className="login-promise-icon"><Icon name={ic} size={16} /></span>
                <span className="login-promise-label">{tx}</span>
              </div>
            ))}
          </div>

          <div className="login-langs">
            {['en', 'fr', 'rw'].map((c) => (
              <button key={c} type="button" className={`login-lang${lang === c ? ' on' : ''}`} aria-pressed={lang === c}
                onClick={() => dispatch({ type: 'SET_LANG', lang: c })}>
                {LANGS.find((l) => l.code === c).label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="login-form-pane">
        <div style={{ width: '100%', maxWidth: 400 }}>
          <h2 style={{ textAlign: 'center' }}>{t('login.title', lang)}</h2>
          <p className="muted" style={{ textAlign: 'center', marginBottom: 24 }}>{t('login.subtitle', lang)}</p>

          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="login-id">{t('login.identifier', lang)}</label>
              <input id="login-id" value={id} autoComplete="username"
                onChange={(e) => { setId(e.target.value); if (error) setError(''); }}
                placeholder={t('login.identifierPh', lang)} required />
            </div>
            <div className="field">
              <label htmlFor="login-password">{t('login.password', lang)}</label>
              <input id="login-password" type="password" value={password} autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)} placeholder="••••••" required />
            </div>
            {error && (
              <div className="warn-banner" role="alert" style={{ marginBottom: 12, alignItems: 'center' }}>
                <Icon name="alert" size={16} /> {error}
              </div>
            )}
            <button className="btn" style={{
              width: '100%', justifyContent: 'center', padding: 11,
              background: 'var(--brand-blue)', borderColor: 'var(--brand-blue)', color: '#fff',
            }}><Icon name="lock" size={16} /> {t('login.signIn', lang)}</button>
          </form>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span className="muted small">{t('login.or', lang)}</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          <div className="grid cols-2">
            <button className="btn" style={{ justifyContent: 'center' }} disabled={!demo(state.farmers)}
              onClick={() => doLogin(demo(state.farmers))}>
              <Icon name="users" size={16} /> {t('login.demoFarmer', lang)}
            </button>
            <button className="btn" style={{ justifyContent: 'center' }} disabled={!demo(state.admins)}
              onClick={() => doLogin(demo(state.admins))}>
              <Icon name="shield" size={16} /> {t('login.demoAdmin', lang)}
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
