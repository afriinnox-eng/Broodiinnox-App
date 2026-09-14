import React, { useMemo, useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { Badge, Btn, EmptyState } from '../../components/ui.jsx';
import { Icon } from '../../components/icons.jsx';
import PayModal from '../../components/PayModal.jsx';
import { paymentFailureNote, paymentPendingNote, providerDisabledNote } from '../../lib/payments.js';
import { fmtDateTime } from '../../lib/time.js';
import { fmtMoney, t } from '../../i18n/strings.js';

export default function FarmerPayments() {
  const { state, dispatch } = useStore();
  const lang = state.lang || 'en';
  const [payFor, setPayFor] = useState(null);
  const myPayments = useMemo(() => state.payments.filter((p) => p.farmerId === state.session.id), [state.payments, state.session.id]);
  const myDevices = useMemo(() => state.devices.filter((d) => d.farmerId === state.session.id), [state.devices, state.session.id]);
  const planOf = (id) => state.plans.find((p) => p.id === id);
  // The API reports whether it can collect payments at all (the Ekorana
  // credentials present). When it cannot, the farmer is told before typing a
  // number rather than after a payment that could never be collected.
  const paymentsOff = state.provider ? state.provider.enabled === false : false;

  return (
    <div>
      <div className="row-between">
        <h1>{t('nav.payments', lang)}</h1>
        {/* One button per system: a farmer with two brooders must be able to
            start a payment for the second one, not only for the first. */}
        {myDevices.length === 0
          ? <Btn variant="green" disabled>+ New payment</Btn>
          : (
            <div className="row">
              {myDevices.map((d) => (
                <Btn key={d.id} variant="green" disabled={paymentsOff} onClick={() => setPayFor(d)}>
                  + Pay for {d.name} ({d.serial})
                </Btn>
              ))}
            </div>
          )}
      </div>
      <p className="muted">Pay subscriptions directly with MTN Mobile Money. Payments are verified with the provider before a device unlocks.</p>

      {paymentsOff && (
        <div className="warn-banner" style={{ margin: '12px 0' }}>
          <Icon name="alert" size={20} />
          <div>{providerDisabledNote(state.provider)}</div>
        </div>
      )}

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
                  <td style={{ maxWidth: 340 }}>
                    <Badge tone={{ successful: 'ok', pending: 'warn', failed: 'crit', cancelled: 'off' }[p.status] || 'off'}>
                      {p.status === 'successful' ? 'Successful' : p.status}
                    </Badge>
                    {p.providerRef && <div className="muted small">MTN ref {p.providerRef}</div>}
                    {p.status === 'successful' && p.providerConfirmed === true
                      && <div className="muted small">verified by MTN MoMo</div>}
                    {p.status === 'pending' && (
                      <div className="muted small">
                        {p.provider === true
                          ? (p.submitting ? 'Sending the request to MTN MoMo…' : paymentPendingNote(p))
                          : 'waiting for provider…'}
                      </div>
                    )}
                    {p.status === 'pending' && p.apiId && (
                      <Btn small onClick={() => dispatch({ type: 'PAYMENT_CHECK', paymentId: p.id })} disabled={p.submitting}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <Icon name="refresh" size={14} /> Check status with MTN
                        </span>
                      </Btn>
                    )}
                    {p.status === 'failed' && (
                      <div className="small" style={{ color: 'var(--crit)' }}>{paymentFailureNote(p)}</div>
                    )}
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
