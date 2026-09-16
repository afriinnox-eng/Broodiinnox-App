import React, { useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store.jsx';
import { LANGS, t } from '../i18n/strings.js';
import { Icon } from '../components/icons.jsx';
import {
  authApiFor, CODE_LENGTH, maskEmail, phoneKey, sessionFromAccount, validateCode,
} from '../lib/auth.js';
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
  const [busy, setBusy] = useState(false);
  /* One screen, three steps: the credentials, the emailed code, and the way back
     in when the password is gone. The identifier is held across all three, so
     nothing typed is lost in between. */
  const [mode, setMode] = useState('credentials');
  const [challenge, setChallenge] = useState(null); // { challengeId, sentTo, expiresMinutes }
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false); // the reset request was accepted
  const lang = state.lang || 'en';

  /* Null unless a broodiinnox-api was configured at build time - the same switch
     every other live feature uses. With no server configured this screen
     behaves exactly as it did before the code step existed, which is what keeps
     a build with no VITE_IOT_API_URL able to sign anyone in. */
  const api = useMemo(() => authApiFor(import.meta.env), []);

  /* The phone layout stacks this screen, which puts the sign-in form below the
     mark, the plate and the promises - so the one thing a returning farmer came
     here to press is the one thing that is not on the first screen. This ref is
     the shortcut to it: scroll the form pane into view and leave the cursor in
     its first field, whatever step of the flow it is showing. `scrollIntoView`
     is not implemented in every environment, so it is called only when it
     exists - the focus alone still lands the person in the right place. */
  const formPane = useRef(null);

  const goToSignIn = () => {
    const pane = formPane.current;
    if (!pane) return;
    if (typeof pane.scrollIntoView === 'function') pane.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const field = pane.querySelector('input');
    if (field && typeof field.focus === 'function') field.focus({ preventScroll: true });
  };

  const doLogin = (user) => {
    setError('');
    setSent(false);
    dispatch({ type: 'LOGIN', user });
  };

  /* Who someone is comes from the registration, not from a choice on this screen. The
     Super Admin registers every account, so the identifier they were given - an email
     or a phone number - is what decides which shell they land in, a farmer's or the
     console's. An identifier nobody registered signs nobody in.

     A NUMBER IS COMPARED THROUGH phoneKey - the canonical rule auth.js and
     broodiinnox-api both use - and not by stripping a space or two. That is the
     difference that made signing in impossible from a phone: a keypad, a contact
     card or an autofill hands over "+250 788 123 456" or "0788-123-456", while the
     account was registered as "0788123456". Those are one identifier, and every
     shape of it has to find the account. */
  const lookup = (raw) => {
    const typed = raw.trim();
    if (!typed) return null;
    const byEmail = typed.includes('@');
    const email = typed.toLowerCase();
    const key = byEmail ? '' : phoneKey(typed);
    if (!byEmail && !key) return null; // no digits: nothing a number could match
    const farmer = state.farmers.find((f) => (byEmail
      ? (f.email || '').toLowerCase() === email
      : phoneKey(f.phone) === key));
    if (farmer) return { id: farmer.id, name: farmer.name, role: 'farmer', phone: farmer.phone, email: farmer.email };
    const admin = state.admins.find((a) => (byEmail
      ? (a.email || '').toLowerCase() === email
      : phoneKey(a.phone) === key));
    if (admin) return { id: admin.id, name: admin.name, role: 'admin', adminRole: admin.role, email: admin.email, phone: admin.phone };
    return null;
  };

  /* Step one. The registered identifier still decides who gets in - the Super
     Admin registers every account - and it is checked before anything is sent
     anywhere, so an identifier nobody registered never reaches the server and
     never opens a shell. */
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const account = lookup(id);
    if (!account) {
      /* Nobody holds that identifier. Which sentence is said depends only on the
         SHAPE of what was typed, never on who exists: a NUMBER that matches no
         account is told that console accounts sign in with their email, which is
         the difference between "you cannot get in" and "you used the wrong kind
         of identifier". A value that is not a number gets the ordinary sentence -
         telling someone their typing is a number when it is not is its own kind
         of unhelpful. */
      const typed = String(id).trim();
      const looksLikeNumber = !typed.includes('@') && phoneKey(typed) !== '';
      return setError(t(looksLikeNumber ? 'login.notRegisteredPhone' : 'login.notRegistered', lang));
    }
    setError('');
    if (!api) return doLogin(account);

    setBusy(true);
    const out = await api.login({ identifier: id.trim(), password });
    setBusy(false);

    if (out.kind === 'code-sent') {
      setChallenge({
        challengeId: out.challengeId,
        sentTo: out.sentTo || maskEmail(account.email || ''),
        expiresMinutes: out.expiresMinutes,
      });
      setCode('');
      setMode('code');
      return;
    }

    /* The server would not take the password: either it disagrees, or no
       password has been recorded for this account yet - which is every account
       until a reset link sets one. The registration above has already decided
       this person may come in, so they come in, exactly as they did before this
       step existed. That is deliberate: the code step may never become the
       reason a farmer cannot reach their own chicks.

       It is also deliberately SILENT about why, including when the server says
       it cannot send email (503 mail-not-configured). The only screen that could
       say so unmounts on the next line, and this app renders no toast anywhere,
       so a message set here would exist in state and never be seen. The copy
       lives where it can be read instead: the "forgot password" step says it
       plainly, and so does the reset screen. */
    doLogin(account);
  };

  /* Step two: the code the server emailed. Nothing is decided here - the server
     checked the password in step one and only the server can say these digits
     are right. */
  const verify = async (e) => {
    e.preventDefault();
    if (busy || !challenge) return;
    const shape = validateCode(code);
    if (!shape.ok) return setError(t('login.codeShape', lang, { n: CODE_LENGTH }));
    setError('');
    setBusy(true);
    const out = await api.verifyCode({ challengeId: challenge.challengeId, code: shape.value });
    setBusy(false);

    if (out.kind === 'verified') {
      const account = sessionFromAccount(out.account, state) || lookup(id);
      if (!account) return setError(t('login.notRegistered', lang));
      return doLogin(account);
    }
    if (out.kind !== 'refused') return setError(t('login.codeUnavailable', lang));
    if (out.reason === 'wrong' && out.attemptsLeft === 0) return setError(t('login.codeDead', lang));
    const wrong = t('login.codeWrong', lang);
    setError(out.attemptsLeft ? `${wrong} ${t('login.codeAttempts', lang, { n: out.attemptsLeft })}` : wrong);
  };

  /* Another code for the same account: the password is still in hand, so this is
     step one again rather than a second way in. */
  const resend = async () => {
    if (busy || !api) return;
    setError('');
    setBusy(true);
    const out = await api.login({ identifier: id.trim(), password });
    setBusy(false);
    if (out.kind === 'code-sent') {
      setChallenge({ challengeId: out.challengeId, sentTo: out.sentTo || challenge?.sentTo || '', expiresMinutes: out.expiresMinutes });
      setCode('');
      return;
    }
    setError(out.kind === 'unavailable' ? t('login.codeUnavailable', lang) : out.message);
  };

  const backToCredentials = () => {
    setMode('credentials');
    setChallenge(null);
    setCode('');
    setSent(false);
    setError('');
  };

  /* The "forgot password" request. Its answer says only that the request was
     looked at: the server replies the same way for an address it knows and one
     it has never seen, so this screen must not add a hint of its own. */
  const askForReset = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!api) return setError(t('login.forgotUnavailable', lang));
    setError('');
    setBusy(true);
    const out = await api.forgotPassword({ identifier: id.trim() });
    setBusy(false);
    if (out.kind === 'sent') return setSent(true);
    setError(t('login.forgotUnavailable', lang));
  };

  return (
    <div className="login-shell">
      <div className="login-brand-pane">
        <div className="login-brand-row">
          <div className="login-brand" style={{ width: 54, height: 54, borderRadius: 14, background: '#fff', display: 'grid', placeItems: 'center', padding: 5, flex: 'none' }}>
            <img src={brandIcon} alt="Afriinnox" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
          </div>
          <div>
            <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: 0.5 }}>BROODIINNOX</div>
            <div style={{ opacity: 0.85, fontSize: 12, letterSpacing: 1 }}>by AFRIINNOX Ltd</div>
          </div>
          {/* On a phone this is the only way in that is visible at a glance, so it
              sits in the top right corner of the screen, beside the mark. It is
              hidden where the form is already beside the brand, and it never
              submits anything itself: it only takes the person to the form. */}
          <button type="button" className="login-quick" aria-label={t('login.quickSignIn', lang)} onClick={goToSignIn}>
            <Icon name="lock" size={15} /> {t('login.signIn', lang)}
          </button>
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

      <div className="login-form-pane" ref={formPane}>
        <div style={{ width: '100%', maxWidth: 400 }}>
          {mode === 'forgot' ? (
            <>
              <h2 style={{ textAlign: 'center' }}>{t('login.forgotTitle', lang)}</h2>
              <p className="muted" style={{ textAlign: 'center', marginBottom: 24 }}>{t('login.forgotSubtitle', lang)}</p>

              {sent ? (
                <div className="auth-note" role="status">{t('login.forgotSent', lang)}</div>
              ) : (
                <form onSubmit={askForReset}>
                  <div className="field">
                    <label htmlFor="forgot-id">{t('login.identifier', lang)}</label>
                    <input id="forgot-id" value={id} autoComplete="username"
                      onChange={(e) => { setId(e.target.value); if (error) setError(''); }}
                      placeholder={t('login.identifierPh', lang)} required />
                  </div>
                  {error && (
                    <div className="warn-banner" role="alert" style={{ marginBottom: 12, alignItems: 'center' }}>
                      <Icon name="alert" size={16} /> {error}
                    </div>
                  )}
                  <button className="btn" disabled={busy} style={{
                    width: '100%', justifyContent: 'center', padding: 11,
                    background: 'var(--brand-blue)', borderColor: 'var(--brand-blue)', color: '#fff',
                  }}><Icon name="mail" size={16} /> {busy ? t('login.sending', lang) : t('login.forgotSend', lang)}</button>
                </form>
              )}

              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <button type="button" className="link-btn" onClick={backToCredentials}>{t('login.backToSignIn', lang)}</button>
              </div>
            </>
          ) : mode === 'code' ? (
            <>
              <h2 style={{ textAlign: 'center' }}>{t('login.codeTitle', lang)}</h2>
              <p className="muted" style={{ textAlign: 'center', marginBottom: 24 }}>
                {t('login.codeSubtitle', lang, { n: CODE_LENGTH, to: challenge?.sentTo || '', min: challenge?.expiresMinutes || 10 })}
              </p>

              <form onSubmit={verify}>
                <div className="field">
                  <label htmlFor="login-code">{t('login.codeLabel', lang)}</label>
                  <input id="login-code" value={code} inputMode="numeric" autoComplete="one-time-code"
                    maxLength={CODE_LENGTH + 2}
                    onChange={(e) => { setCode(e.target.value); if (error) setError(''); }}
                    placeholder={'0'.repeat(CODE_LENGTH)} required />
                </div>
                {error && (
                  <div className="warn-banner" role="alert" style={{ marginBottom: 12, alignItems: 'center' }}>
                    <Icon name="alert" size={16} /> {error}
                  </div>
                )}
                <button className="btn" disabled={busy} style={{
                  width: '100%', justifyContent: 'center', padding: 11,
                  background: 'var(--brand-blue)', borderColor: 'var(--brand-blue)', color: '#fff',
                }}><Icon name="lock" size={16} /> {busy ? t('login.verifying', lang) : t('login.codeVerify', lang)}</button>
              </form>

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 14 }}>
                <button type="button" className="link-btn" onClick={resend}>{t('login.codeResend', lang)}</button>
                <button type="button" className="link-btn" onClick={backToCredentials}>{t('login.codeBack', lang)}</button>
              </div>
            </>
          ) : (
            <>
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
                <div style={{ textAlign: 'right', marginBottom: 12 }}>
                  <button type="button" className="link-btn" onClick={() => { setMode('forgot'); setError(''); setSent(false); }}>
                    {t('login.forgot', lang)}
                  </button>
                </div>
                {error && (
                  <div className="warn-banner" role="alert" style={{ marginBottom: 12, alignItems: 'center' }}>
                    <Icon name="alert" size={16} /> {error}
                  </div>
                )}
                <button className="btn" disabled={busy} style={{
                  width: '100%', justifyContent: 'center', padding: 11,
                  background: 'var(--brand-blue)', borderColor: 'var(--brand-blue)', color: '#fff',
                }}><Icon name="lock" size={16} /> {t('login.signIn', lang)}</button>
              </form>
            </>
          )}

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
