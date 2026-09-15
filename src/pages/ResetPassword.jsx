import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store.jsx';
import { t } from '../i18n/strings.js';
import { Icon } from '../components/icons.jsx';
import { authApiFor, MIN_PASSWORD_LENGTH, resetTokenFromHash } from '../lib/auth.js';
import brandIcon from '../assets/afriinnox-icon.png';

/* Where the emailed reset link lands.
 *
 * The app is hash-routed, so the link is `{app}/#/reset-password?token=...` and
 * the token is inside the fragment. This screen reads it from the router, never
 * from a session: the person arriving here is locked out, which is the whole
 * point of the link.
 *
 * Three things it refuses to get wrong:
 *   - it will not post a password the server would reject anyway (too short),
 *     and it will not post two that disagree with each other;
 *   - it says which of the server's answers came back - an expired link and a
 *     spent link need different things from the person holding it;
 *   - once the password is stored the link is spent, so the token is taken out
 *     of the address bar (replaced, not pushed, so Back does not return to a
 *     form that cannot work).
 */
export default function ResetPassword() {
  const { state } = useStore();
  const lang = state.lang || 'en';
  const location = useLocation();
  const navigate = useNavigate();
  const api = useMemo(() => authApiFor(import.meta.env), []);

  /* The token comes out of whatever shape the URL has: the router's own
     path + search, or the raw fragment. `resetTokenFromHash` refuses a token
     that sits on any other route. */
  const token = useMemo(
    () => resetTokenFromHash(`${location.pathname}${location.search}`) || resetTokenFromHash(window.location.hash),
    [location.pathname, location.search]
  );

  // landing back here after storing one: the token is gone but the link worked,
  // so this is the success state, not a broken link
  const [done, setDone] = useState(() => new URLSearchParams(location.search).get('done') === '1');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /* What the server's refusal means, in the words of the person reading it. */
  const byReason = (reason) => {
    if (reason === 'expired') return t('reset.expired', lang);
    if (reason === 'used') return t('reset.used', lang);
    if (reason === 'invalid-password') return t('reset.tooShort', lang, { n: MIN_PASSWORD_LENGTH });
    return t('reset.unknown', lang);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (password.length < MIN_PASSWORD_LENGTH) return setError(t('reset.tooShort', lang, { n: MIN_PASSWORD_LENGTH }));
    if (password !== again) return setError(t('reset.mismatch', lang));
    if (!api) return setError(t('reset.serverOff', lang));

    setError('');
    setBusy(true);
    const out = await api.resetPassword({ token, password });
    setBusy(false);

    if (out.kind === 'stored') {
      setPassword('');
      setAgain('');
      setDone(true);
      navigate({ pathname: '/reset-password', search: '?done=1' }, { replace: true });
      return;
    }
    setError(out.kind === 'refused' ? byReason(out.reason) : t('reset.unavailable', lang));
  };

  const head = (
    <div className="auth-head">
      <div className="auth-head-icon">
        <img src={brandIcon} alt="Afriinnox" />
      </div>
      <div>
        <div style={{ fontSize: 19, fontWeight: 900, letterSpacing: 0.4 }}>BROODIINNOX</div>
        <div className="muted small" style={{ letterSpacing: 1 }}>by AFRIINNOX Ltd</div>
      </div>
    </div>
  );

  /* The same real channels the sign-in screen publishes: someone holding a dead
     link is exactly who needs them. */
  const contact = (
    <div className="login-contact">
      <span className="login-contact-label">Need a hand getting in?</span>
      <a href="mailto:info@afriinnox.com"><Icon name="mail" size={15} /> info@afriinnox.com</a>
      <a href="tel:+250795814403"><Icon name="phone" size={15} /> +250 795 814 403</a>
    </div>
  );

  return (
    <div className="auth-page">
      <div className="auth-card">
        {head}
        <h2 style={{ marginTop: 0 }}>{t('reset.title', lang)}</h2>

        {done ? (
          <>
            <div className="auth-note" role="status">
              <Icon name="check" size={15} /> {t('reset.done', lang)}
            </div>
            <button
              type="button"
              className="btn"
              style={{
                width: '100%', justifyContent: 'center', padding: 11, marginTop: 16,
                background: 'var(--brand-blue)', borderColor: 'var(--brand-blue)', color: '#fff',
              }}
              onClick={() => navigate('/', { replace: true })}
            >
              <Icon name="lock" size={16} /> {t('reset.signIn', lang)}
            </button>
          </>
        ) : !token ? (
          <>
            <p className="muted">{t('reset.noToken', lang)}</p>
            <button type="button" className="btn" style={{ justifyContent: 'center' }} onClick={() => navigate('/', { replace: true })}>
              <Icon name="lock" size={16} /> {t('reset.signIn', lang)}
            </button>
          </>
        ) : (
          <>
            <p className="muted">{t('reset.subtitle', lang)}</p>
            <form onSubmit={submit}>
              <div className="field">
                <label htmlFor="reset-password">{t('reset.password', lang)}</label>
                <input id="reset-password" type="password" value={password} autoComplete="new-password"
                  onChange={(e) => { setPassword(e.target.value); if (error) setError(''); }}
                  placeholder={'•'.repeat(MIN_PASSWORD_LENGTH)} required />
              </div>
              <div className="field">
                <label htmlFor="reset-confirm">{t('reset.confirm', lang)}</label>
                <input id="reset-confirm" type="password" value={again} autoComplete="new-password"
                  onChange={(e) => { setAgain(e.target.value); if (error) setError(''); }}
                  placeholder={'•'.repeat(MIN_PASSWORD_LENGTH)} required />
              </div>
              {error && (
                <div className="warn-banner" role="alert" style={{ marginBottom: 12, alignItems: 'center' }}>
                  <Icon name="alert" size={16} /> {error}
                </div>
              )}
              <button className="btn" disabled={busy} style={{
                width: '100%', justifyContent: 'center', padding: 11,
                background: 'var(--brand-blue)', borderColor: 'var(--brand-blue)', color: '#fff',
              }}>
                <Icon name="lock" size={16} /> {busy ? t('reset.saving', lang) : t('reset.submit', lang)}
              </button>
            </form>
          </>
        )}

        {contact}
      </div>
    </div>
  );
}
