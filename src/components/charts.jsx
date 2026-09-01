import React from 'react';

/** Simple SVG line/area chart for temperature history. */
export function LineChart({ points, width = 480, height = 150, color = '#1c3a96', unit = '°C' }) {
  if (!points || points.length < 2) {
    return (
      <div style={{ width, height, display: 'grid', placeItems: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        {points && points.length === 1 ? `${points[0].v.toFixed(1)}°C` : 'Collecting data…'}
      </div>
    );
  }
  const pad = { l: 34, r: 10, t: 10, b: 20 };
  const vals = points.map((p) => p.v);
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  const span = max - min || 2;
  min -= span * 0.25;
  max += span * 0.25;
  const x = (i) => pad.l + (i / (points.length - 1)) * (width - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - min) / (max - min)) * (height - pad.t - pad.b);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = `${d} L${x(points.length - 1).toFixed(1)},${height - pad.b} L${x(0).toFixed(1)},${height - pad.b} Z`;
  const last = points[points.length - 1];
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <path d={area} fill={color} opacity="0.10" />
      <path d={d} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx={x(points.length - 1)} cy={y(last.v)} r="3.5" fill={color} />
      <text x={pad.l} y={height - 4} fontSize="10" fill="var(--text-muted)">{min.toFixed(1)}{unit}</text>
      <text x={x(points.length - 1) - 30} y={y(last.v) - 6} fontSize="11" fontWeight="700" fill={color}>
        {last.v.toFixed(1)}{unit}
      </text>
      <text x={width - 6} y={height - 4} fontSize="10" fill="var(--text-muted)" textAnchor="end">{max.toFixed(1)}{unit}</text>
    </svg>
  );
}

export function BarChart({ data, height = 150, color = '#3d5d30' }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${data.length * 46 + 20} ${height}`} style={{ display: 'block' }}>
      {data.map((d, i) => {
        const h = (d.value / max) * (height - 30);
        const x = 10 + i * 46;
        return (
          <g key={i}>
            <rect x={x} y={height - 20 - h} width="28" height={Math.max(h, 2)} rx="4" fill={d.color || color} />
            <text x={x + 14} y={height - 8} fontSize="9.5" textAnchor="middle" fill="var(--text-muted)">{d.label}</text>
            <text x={x + 14} y={height - 26 - h} fontSize="9.5" textAnchor="middle" fontWeight="700" fill="var(--text)">{d.value}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function Donut({ segments, size = 120, label }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = size / 2 - 12;
  const cx = size / 2;
  const cy = size / 2;
  let angle = -90;
  const arcs = segments.map((s) => {
    const frac = s.value / total;
    const a0 = angle;
    const a1 = angle + frac * 360;
    angle = a1;
    const large = a1 - a0 > 180 ? 1 : 0;
    const x0 = cx + r * Math.cos((a0 * Math.PI) / 180);
    const y0 = cy + r * Math.sin((a0 * Math.PI) / 180);
    const x1 = cx + r * Math.cos((a1 * Math.PI) / 180);
    const y1 = cy + r * Math.sin((a1 * Math.PI) / 180);
    return { d: `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`, fill: s.color };
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <svg width={size} height={size}>
        <circle cx={cx} cy={cy} r={r} fill="var(--surface-2)" />
        {arcs.map((a, i) => <path key={i} d={a.d} fill={a.fill} stroke="var(--surface)" strokeWidth="2" />)}
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize="14" fontWeight="800" fill="var(--text)">{label ?? total}</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5 }}>
        {segments.map((s, i) => (
          <div key={i} className="row" style={{ gap: 6 }}>
            <span className="status-dot" style={{ background: s.color }} />
            <span>{s.label}</span>
            <b>{s.value}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
