import React, { useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store.jsx';
import { LANGS, t } from '../i18n/strings.js';
import { fmtDateTime } from '../lib/time.js';

const FARMER_NAV = [
  ['dashboard', '📊'], ['systems', '🛠️'], ['batches', '🐣'], ['alerts', '🔔'],
  ['subscriptions', '💳'], ['payments', '💰'], ['support', '🆘'], ['notifications', '📨'],
  ['tips', '📖'], ['settings', '⚙️'],
];

const ADMIN_NAV = [
  ['dashboard', '📊'], ['farmers', '👨‍🌾'], ['devices', '🛠️'], ['live', '📡'], ['map', '🗺️'],
  ['batches', '🐣'], ['subscriptions', '💳'], ['payments', '💰'], ['reports', '📈'],
  ['alerts', '🔔'], ['tickets', '🎫'], ['messages', '✉️'], ['admins', '👤'], ['audit', '🧾'],
  ['maintenance', '🔧'], ['inventory', '📦'], ['settings', '⚙️'],
];

function NavSection({ section, items, base, lang }) {
  return (
    <>
      <div className="nav-section">{section}</div>
      {items.map(([key, icon]) => (
        <NavLink key={key} to={`${base}/${key}`} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span>{icon}</span> {t(`nav.${key}`, lang)}
        </NavLink>
      ))}
    </>
  );
}

function GlobalSearch({ role }) {
  const { state } = useStore();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const results = useMemo(() => {
    if (!q.trim()) return [];
    const needle = q.toLowerCase();
    const farmers = state.farmers.filter((f) => `${f.name} ${f.phone} ${f.email}`.toLowerCase().includes(needle));
    const devices = state.devices.filter((d) => `${d.serial} ${d.name} ${d.location?.district}`.toLowerCase().includes(needle));
    return [...farmers.slice(0, 4).map((f) => ({ label: `👨‍🌾 ${f.name} · ${f.phone}`, to: `/${role}/farmers/${f.id}` })),
      ...devices.slice(0, 4).map((d) => ({ label: `🛠️ ${d.serial} — ${d.name}`, to: `/${role}/systems/${d.id}` }))];
  }, [q, state]);
  if (role !== 'admin') return null;
  return (
    <div style={{ position: 'relative', flex: 1, maxWidth: 420 }}>
      <input className="topbar-search" placeholder={t('common.search', 'en')} value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onBlur={() => setTimeout(() => setOpen(false), 200)} />
      {open && results.length > 0 && (
        <div className="card" style={{ position: 'absolute', top: 44, left: 0, right: 0, zIndex: 50, padding: 6 }}>
          {results.map((r, i) => (
            <div key={i} className="nav-item" style={{ color: 'var(--text)', borderRadius: 8 }}
              onMouseDown={() => { navigate(r.to); setOpen(false); setQ(''); }}>
              {r.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationBell({ role }) {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const items = role === 'farmer'
    ? state.notifications.filter((n) => n.farmerId === state.session?.id)
    : state.alerts.filter((a) => !a.read).slice(0, 8);
  const unread = role === 'farmer' ? items.filter((n) => !n.read).length : items.length;
  return (
    <div style={{ position: 'relative' }}>
      <button className="icon-btn" onClick={() => setOpen(!open)}>
        🔔 {unread > 0 && <span className="dot-badge">{unread}</span>}
      </button>
      {open && (
        <div className="card" style={{ position: 'absolute', right: 0, top: 46, width: 320, zIndex: 60, maxHeight: 400, overflowY: 'auto' }}>
          <div className="row-between">
            <b>{role === 'farmer' ? t('nav.notifications', 'en') : t('nav.alerts', 'en')}</b>
            <button className="btn small" onClick={() => dispatch({ type: role === 'farmer' ? 'MARK_ALL_NOTIF_READ' : 'MARK_ALL_ALERTS_READ' })}>
              Mark all read
            </button>
          </div>
          {items.length === 0 && <div className="muted small" style={{ padding: 12 }}>All clear ✨</div>}
          {items.map((n) => (
            <div key={n.id} className="alert-line" style={{ opacity: n.read ? 0.6 : 1 }}>
              <span>{n.severity === 'critical' ? '🔴' : n.severity === 'warning' ? '🟠' : '🔵'}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 12.5 }}>{n.title || n.message}</div>
                {n.body && <div className="muted small">{n.body}</div>}
                <div className="muted small">{fmtDateTime(n.at)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AppShell({ children }) {
  const { state, dispatch } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const role = state.session?.role;
  const base = role === 'admin' ? '/admin' : '/farmer';
  const nav = role === 'admin' ? ADMIN_NAV : FARMER_NAV;
  const section = location.pathname.split('/')[2] || 'dashboard';

  const lang = state.lang || 'en';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <div className="brand-name">AFRIINNOX</div>
            <div className="brand-sub">Broodiinnox</div>
          </div>
        </div>
        <NavSection section={role === 'admin' ? 'Afriinnox Admin' : 'Farmer App'} items={nav} base={base} lang={lang} />
        <div className="spacer" />
        <div className="nav-item" onClick={() => { dispatch({ type: 'LOGOUT' }); navigate('/'); }}>
          <span>🚪</span> {t('common.logout', lang)}
        </div>
      </aside>
      <div>
        <header className="topbar">
          <b style={{ fontSize: 15, textTransform: 'capitalize' }}>{t(`nav.${section}`, lang)}</b>
          <GlobalSearch role={role} />
          <div className="spacer" />
          <select className="field" style={{ width: 'auto', padding: '7px 10px', borderRadius: 999, border: '1px solid var(--border)' }}
            value={lang} onChange={(e) => dispatch({ type: 'SET_LANG', lang: e.target.value })}>
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          <button className="icon-btn" title="Toggle theme" onClick={() => dispatch({ type: 'SET_THEME', theme: state.theme === 'dark' ? 'light' : 'dark' })}>
            {state.theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <NotificationBell role={role} />
          <div className="chip">{state.session?.name}</div>
        </header>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
