import React, { useMemo, useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { subscriptionState } from '../../lib/services.js';
import { fmtDate, fmtDateTime, timeAgo } from '../../lib/time.js';
import { Badge, Btn, Card, EmptyState } from '../../components/ui.jsx';
import PayModal from '../../components/PayModal.jsx';
import { fmtMoney, t } from '../../i18n/strings.js';

export default function FarmerSubscriptions() {
  const { state, dispatch } = useStore();
  const lang = state.lang || 'en';
  const now = new Date().toISOString();
  const myDevices = useMemo(() => state.devices.filter((d) => d.farmerId === state.session.id), [state.devices, state.session.id]);
  const [payFor, setPayFor] = useState(null);

  const planOf = (id) => state.plans.find((p) => p.id === id);
  const expiredLocked = myDevices.filter((d) => subscriptionState(d.subscription?.endDate, now) !== 'active');

  return (
    <div>
      <h1>{t('nav.subscriptions', lang)}</h1>
      <p className="muted">Manage your plans. If a subscription lapses the system locks automatically (safety mode still protects the brood).</p>

      {expiredLocked.length > 0 && (
        <div className="warn-banner" style={{ margin: '12px 0' }}>
          🔒 <div><b>{expiredLocked.length} system(s) are locked</b> because their subscription lapsed. Renew below to unlock instantly after MoMo confirmation.</div>
        </div>
      )}

      <h3 style={{ marginTop: 8 }}>Available plans</h3>
      <div className="grid cols-3">
        {state.plans.filter((p) => p.active).map((p) => (
          <Card key={p.id} title={p.name}>
            <div className="big" style={{ color: 'var(--brand-green)' }}>{fmtMoney(p.price)}</div>
            <div className="muted small">{p.durationDays} days · {p.description}</div>
          </Card>
        ))}
      </div>

      <h3 style={{ marginTop: 20 }}>Your subscriptions</h3>
      {myDevices.length === 0 && <EmptyState icon="💳" text="No systems yet." />}
      <div className="grid cols-2">
        {myDevices.map((d) => {
          const sub = d.subscription;
          const active = sub?.status === 'active' && subscriptionState(sub.endDate, now) === 'active';
          const daysLeft = sub?.endDate ? Math.ceil((new Date(sub.endDate) - new Date(now)) / 86400000) : 0;
          return (
            <Card key={d.id} title={`${d.name} (${d.serial})`}>
              <div className="row-between">
                <div>
                  {active ? (
                    <>
                      <div style={{ fontWeight: 800 }}>{planOf(sub.planId)?.name || 'Plan'} — {fmtMoney(planOf(sub.planId)?.price || 0)}</div>
                      <div className="muted small">Started {fmtDate(sub.startDate)} · Expires {fmtDate(sub.endDate)}</div>
                    </>
                  ) : (
                    <div style={{ fontWeight: 700, color: 'var(--crit)' }}>{sub ? 'Expired' : 'No subscription'} — device locked</div>
                  )}
                </div>
                {active ? <Badge tone={daysLeft <= 7 ? 'warn' : 'ok'}>{daysLeft} days left</Badge> : <Badge tone="crit">Locked</Badge>}
              </div>
              {active && daysLeft <= 7 && <div className="warn-banner" style={{ marginTop: 8 }}>⏳ Renew soon to avoid locking.</div>}
              <div style={{ marginTop: 10 }}>
                <Btn variant={active ? 'primary' : 'green'} small onClick={() => setPayFor(d)}>
                  {active ? 'Renew / extend' : '🔓 Renew & unlock'}
                </Btn>
              </div>
            </Card>
          );
        })}
      </div>

      <h3 style={{ marginTop: 20 }}>Payment history</h3>
      {state.payments.filter((p) => p.farmerId === state.session.id).length === 0 ? <EmptyState icon="💰" text="No payments yet." /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>System</th><th>Plan</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead>
            <tbody>
              {state.payments.filter((p) => p.farmerId === state.session.id).slice(0, 8).map((p) => (
                <tr key={p.id}>
                  <td>{fmtDateTime(p.createdAt)}</td>
                  <td>{p.deviceId}</td>
                  <td>{planOf(p.planId)?.name || '—'}</td>
                  <td>{fmtMoney(p.amount)}</td>
                  <td>{p.method}</td>
                  <td><Badge tone={{ successful: 'ok', pending: 'warn', failed: 'crit', cancelled: 'off' }[p.status] || 'off'}>{p.status}{p.providerRef ? ` · ${p.providerRef}` : ''}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {payFor && <PayModal device={payFor} onClose={() => setPayFor(null)} />}
    </div>
  );
}
