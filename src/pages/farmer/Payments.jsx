import React, { useMemo, useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { Badge, Btn, EmptyState } from '../../components/ui.jsx';
import PayModal from '../../components/PayModal.jsx';
import { fmtDateTime } from '../../lib/time.js';
import { fmtMoney, t } from '../../i18n/strings.js';

export default function FarmerPayments() {
  const { state } = useStore();
  const lang = state.lang || 'en';
  const [payFor, setPayFor] = useState(null);
  const myPayments = useMemo(() => state.payments.filter((p) => p.farmerId === state.session.id), [state.payments, state.session.id]);
  const myDevices = useMemo(() => state.devices.filter((d) => d.farmerId === state.session.id), [state.devices, state.session.id]);
  const planOf = (id) => state.plans.find((p) => p.id === id);

  return (
    <div>
      <div className="row-between">
        <h1>{t('nav.payments', lang)}</h1>
        <Btn variant="green" onClick={() => setPayFor(myDevices[0] || { id: null })} disabled={!myDevices.length}>+ New payment</Btn>
      </div>
      <p className="muted">Pay subscriptions directly with MTN Mobile Money. Payments are verified with the provider before a device unlocks.</p>

      {myPayments.length === 0 ? <EmptyState icon="wallet" text="No payments yet." /> : (
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead><tr><th>Date</th><th>System</th><th>Plan / period</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead>
            <tbody>
              {myPayments.map((p) => (
                <tr key={p.id}>
                  <td>{fmtDateTime(p.createdAt)}</td>
                  <td>{p.deviceId}</td>
                  <td>{planOf(p.planId)?.name || '—'}</td>
                  <td><b>{fmtMoney(p.amount)}</b></td>
                  <td>{p.method} <span className="muted small">{p.phone}</span></td>
                  <td>
                    <Badge tone={{ successful: 'ok', pending: 'warn', failed: 'crit', cancelled: 'off' }[p.status] || 'off'}>
                      {p.status === 'successful' ? 'Successful' : p.status}
                    </Badge>
                    {p.providerRef && <div className="muted small">{p.providerRef}</div>}
                    {p.status === 'pending' && <div className="muted small">waiting for provider…</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {payFor && payFor.id && <PayModal device={payFor} onClose={() => setPayFor(null)} />}
    </div>
  );
}
