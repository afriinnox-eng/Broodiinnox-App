import React, { useState } from 'react';
import { useStore } from '../lib/store.jsx';
import { Badge, Btn, Field, Modal } from './ui.jsx';
import { Icon } from './icons.jsx';
import { fmtMoney } from '../i18n/strings.js';

/** MTN MoMo payment modal — shared by the farmer Subscriptions and Payments pages. */
export default function PayModal({ device, onClose }) {
  const { state, dispatch } = useStore();
  const [planId, setPlanId] = useState(state.plans.find((p) => p.active)?.id || state.plans[0]?.id);
  const [phone, setPhone] = useState(state.session.phone || '0788123456');
  const [sending, setSending] = useState(false);
  const plan = state.plans.find((p) => p.id === planId);
  const pending = state.payments.find((p) => p.deviceId === device.id && p.status === 'pending');

  const pay = () => {
    setSending(true);
    dispatch({ type: 'REQUEST_PAYMENT', farmerId: state.session.id, deviceId: device.id, planId, phone });
    setTimeout(() => {
      dispatch({ type: 'TOAST', msg: 'MoMo payment requested — confirm on your phone.' });
      onClose();
    }, 400);
  };

  return (
    <Modal title={`Pay for ${device.name} (${device.serial})`} onClose={onClose}>
      {pending && (
        <div className="warn-banner" style={{ marginBottom: 12 }}>
          <Icon name="clock" size={18} />
          <div>A payment is already pending for this system. It will be confirmed by MTN MoMo shortly.</div>
        </div>
      )}
      <Field label="Subscription plan">
        <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
          {state.plans.filter((p) => p.active).map((p) => (
            <option key={p.id} value={p.id}>{p.name} — {p.durationDays} days — {fmtMoney(p.price)}</option>
          ))}
        </select>
      </Field>
      <Field label="MTN MoMo number">
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0788123456" />
      </Field>
      <div className="row-between" style={{ margin: '6px 0 14px' }}>
        <span className="muted small">Amount to pay</span>
        <b style={{ fontSize: 18 }}>{fmtMoney(plan?.price || 0)}</b>
      </div>
      <p className="muted small" style={{ marginBottom: 12 }}>
        You will receive an MTN MoMo prompt on {phone}. The payment is verified with the provider before the device unlocks —
        the app never unlocks a system just because a button was pressed.
      </p>
      <div className="btn-row">
        <Btn variant="green" onClick={pay} disabled={sending}>{sending ? 'Sending…' : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="send" size={15} /> Request MoMo payment</span>}</Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </div>
      <div style={{ marginTop: 10 }}><Badge tone="info">Method: MTN Mobile Money</Badge></div>
    </Modal>
  );
}
