import React from 'react';

export function Card({ title, actions, children, className = '' }) {
  return (
    <div className={`card ${className}`}>
      {title && (
        <div className="row-between" style={{ marginBottom: 12 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>{title}</div>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function Stat({ icon, label, value, sub, tone }) {
  return (
    <div className="card stat">
      <div className="row">
        <span className="stat-icon">{icon}</span>
        <span className="stat-label">{label}</span>
      </div>
      <div className="stat-value" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  );
}

const STATUS_TONE = { online: 'ok', offline: 'off', warning: 'warn', critical: 'crit', locked: 'off' };
const STATUS_ICON = { online: '🟢', offline: '⚫', warning: '🟠', critical: '🔴', locked: '🔒' };

export function StatusBadge({ status, label }) {
  const tone = STATUS_TONE[status] || 'off';
  return (
    <span className={`badge ${tone}`}>
      <span className="status-dot" style={{ background: 'currentColor' }} />
      {label || status}
    </span>
  );
}

export function SeverityBadge({ severity, label }) {
  const tone = { critical: 'crit', warning: 'warn', info: 'info' }[severity] || 'info';
  const icon = { critical: '🔴', warning: '🟠', info: '🔵' }[severity] || '🔵';
  return (
    <span className={`badge ${tone}`}>{icon} {label || severity}</span>
  );
}

export function Badge({ tone = 'info', children }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function StatusDot({ status }) {
  const cls = { online: 'ok', offline: 'off', warning: 'warn', critical: 'crit', locked: 'locked' }[status] || 'off';
  return <span className={`status-dot ${cls}`} />;
}

export function Btn({ children, onClick, variant, small, disabled, title, type }) {
  return (
    <button type={type || 'button'} className={`btn ${variant || ''} ${small ? 'small' : ''}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

export function Modal({ title, onClose, children, width }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={width ? { maxWidth: width } : undefined} onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function Progress({ value, tone = 'green' }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="progress">
      <div style={{ width: `${pct}%`, background: `var(--${tone === 'green' ? 'brand-green' : tone})` }} />
    </div>
  );
}

export function EmptyState({ icon = '📭', text = 'Nothing here yet' }) {
  return (
    <div className="empty">
      <div style={{ fontSize: 34, marginBottom: 8 }}>{icon}</div>
      <div>{text}</div>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <div key={t.key} className={`tab ${active === t.key ? 'active' : ''}`} onClick={() => onChange(t.key)}>
          {t.label}
        </div>
      ))}
    </div>
  );
}

export function downloadCsv(filename, rows) {
  if (!rows.length) return;
  const header = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const csv = [header.join(','), ...rows.map((r) => header.map((h) => esc(r[h])).join(','))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function DataTable({ columns, rows, onRowClick, empty = 'No records' }) {
  if (!rows.length) return <EmptyState text={empty} />;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r._key || i} onClick={onRowClick ? () => onRowClick(r) : undefined} style={onRowClick ? { cursor: 'pointer' } : undefined}>
              {columns.map((c) => <td key={c.key}>{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Toast({ toast }) {
  if (!toast) return null;
  return <div className="toast">{toast.msg}</div>;
}
