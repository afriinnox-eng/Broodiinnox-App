import React, { useState } from 'react';
import { useStore } from '../lib/store.jsx';
import {
  batchDaysRemaining, deviceChicks, planFit, planFrom, sheetBandForChicks, sheetBandLabel,
  sheetBands, sheetPlansForBand, sheetPrice,
} from '../lib/subscriptions.js';
import { Badge, Btn, Field, Modal } from './ui.jsx';
import { Icon } from './icons.jsx';
import { fmtMoney } from '../i18n/strings.js';

/**
 * MTN MoMo payment modal — shared by the farmer Subscriptions and Payments pages.
 *
 * The plans shown first are the ones priced for THIS system's farm size, because
 * that is what sets the price; a checkbox opens the same plans for every other
 * farm size, so a farmer can compare before paying. The amount is never typed in
 * anywhere: it comes from the price sheet the admin has published, and the store
 * re-reads it from the sheet when the payment is requested.
 */
export default function PayModal({ device, initialPlanId, onClose }) {
  const { state, dispatch } = useStore();
  const [showAll, setShowAll] = useState(false);
  const sheet = state.sheet;
  const band = sheetBandForChicks(sheet, deviceChicks(device));
  const chicks = deviceChicks(device);
  const [planId, setPlanId] = useState(initialPlanId || state.plans.find((p) => p.active)?.id || state.plans[0]?.id);
  const [phone, setPhone] = useState(state.session.phone || '0788123456');
  const [sending, setSending] = useState(false);

  const plan = planFrom(state.plans, planId);
  const price = sheetPrice(sheet, band, plan);
  const payable = price !== null && !!band;
  const pending = state.payments.find((p) => p.deviceId === device.id && p.status === 'pending');

  const batchDays = device.batch?.durationDays ?? null;
  const remaining = batchDaysRemaining(device.batch, new Date().toISOString());
  const fit = planFit(plan?.durationDays ?? plan?.days, batchDays);
  const runningDaysLeft = device.subscription?.endDate
    ? Math.max(0, Math.ceil((Date.parse(device.subscription.endDate) - Date.now()) / 86400000))
    : null;
  const running = device.subscription?.status === 'active' && runningDaysLeft > 0;

  const pay = () => {
    setSending(true);
    dispatch({ type: 'REQUEST_PAYMENT', farmerId: state.session.id, deviceId: device.id, planId, phone });
    setTimeout(() => {
      dispatch({ type: 'TOAST', msg: 'MoMo payment requested — confirm on your phone.' });
      onClose();
    }, 400);
  };

  /** The plans of one farm-size band, as <option>s, priced from the sheet. */
  const optionsFor = (b) => sheetPlansForBand(sheet, b, state.plans).map(({ plan: p, price: cell }) => (
    <option key={`${b ? b.id : 'none'}-${p.id}`} value={p.id} disabled={cell === null}>
      {p.name} — {p.durationDays} days — {cell === null ? 'Customized' : fmtMoney(cell)}
    </option>
  ));

  return (
    <Modal title={`Pay for ${device.name} (${device.serial})`} onClose={onClose}>
      {pending && (
        <div className="warn-banner" style={{ marginBottom: 12 }}>
          <Icon name="clock" size={18} />
          <div>A payment is already pending for this system. It will be confirmed by MTN MoMo shortly.</div>
        </div>
      )}

      <div className="muted small" style={{ marginBottom: 10 }}>
        Farm size: <b>{chicks ? `${chicks.toLocaleString('en-US')} chicks` : 'not recorded'}</b>
        {band ? ` · ${sheetBandLabel(sheet, band)}` : ''} — this is what your price is based on.
      </div>

      <Field label="Subscription plan">
        <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
          {band && <optgroup label={`${sheetBandLabel(sheet, band)} (your farm)`}>{optionsFor(band)}</optgroup>}
          {showAll && sheetBands(sheet).filter((b) => b.id !== band?.id).map((b) => (
            <optgroup key={b.id} label={sheetBandLabel(sheet, b)}>{optionsFor(b)}</optgroup>
          ))}
        </select>
      </Field>

      <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
        Show the plans of every farm size
      </label>

      <div className="row-between" style={{ margin: '6px 0 4px' }}>
        <span className="muted small">Amount to pay</span>
        <b style={{ fontSize: 18 }}>{payable ? fmtMoney(price) : 'Customized'}</b>
      </div>
      <div className="muted small" style={{ marginBottom: 12 }}>
        {plan?.name} for {band ? sheetBandLabel(sheet, band) : 'this farm size'}
        {fit && batchDays
          ? ` · pays for ${fit.cycles} whole cycle${fit.cycles === 1 ? '' : 's'} of ${batchDays} days`
            + (fit.spareDays ? `, with ${fit.spareDays} days to spare` : ', with nothing to spare')
          : ''}
      </div>

      {!!fit && fit.tooShort && (
        <div className="warn-banner" style={{ marginBottom: 12 }}>
          <Icon name="alert" size={18} />
          <div>
            This plan is shorter than one batch of {batchDays} days, so it cannot cover a cycle on its own —
            choose a longer plan, or renew before it runs out.
          </div>
        </div>
      )}
      {!!fit && !fit.tooShort && remaining !== null && (plan?.durationDays ?? plan?.days) < remaining && (
        <div className="warn-banner" style={{ marginBottom: 12 }}>
          <Icon name="alert" size={18} />
          <div>
            Your current batch has {remaining} days left, so this plan would end {remaining - plan.durationDays} day
            {remaining - plan.durationDays === 1 ? '' : 's'} before it does.
          </div>
        </div>
      )}
      {!band && (
        <div className="warn-banner" style={{ marginBottom: 12 }}>
          <Icon name="alert" size={18} />
          <div>
            No farm size is recorded for this system yet, so it cannot be priced. Afriinnox records it at
            installation — the plans of every size can be compared above, but nothing can be paid until it is set.
          </div>
        </div>
      )}
      {running && (
        <p className="muted small" style={{ marginBottom: 12 }}>
          You already have {runningDaysLeft} day{runningDaysLeft === 1 ? '' : 's'} of cover running. Renewing adds
          the new days to the end of it — nothing you have paid for is lost.
        </p>
      )}

      <Field label="MTN MoMo number">
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0788123456" />
      </Field>
      <p className="muted small" style={{ marginBottom: 12 }}>
        You will receive an MTN MoMo prompt on {phone}. The payment is verified with the provider before the device unlocks —
        the app never unlocks a system just because a button was pressed.
      </p>
      <div className="btn-row">
        <Btn variant="green" onClick={pay} disabled={sending || !payable}>
          {sending ? 'Sending…' : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="send" size={15} /> Request MoMo payment</span>}
        </Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </div>
      <div style={{ marginTop: 10 }}><Badge tone="info">Method: MTN Mobile Money</Badge></div>
    </Modal>
  );
}
