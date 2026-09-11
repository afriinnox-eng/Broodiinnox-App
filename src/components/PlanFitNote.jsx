import React from 'react';
import {
  TERMS, bandLabel, coverageFor, deviceBand, planFit, priceFor, recommendedTerm,
} from '../lib/subscriptions.js';
import { Icon } from './icons.jsx';
import { fmtMoney } from '../i18n/strings.js';
import { fmtDate } from '../lib/time.js';

/**
 * What the subscription does about a batch of this length.
 *
 * It belongs beside the batch duration because the two are one decision: the
 * plan is what pays for the batch, a plan shorter than the batch has to be
 * extended before the cycle ends, and a plan that runs out mid-cycle locks the
 * unit with the animals still inside.
 */
export function PlanFitNote({ device, durationDays, startDate }) {
  const now = new Date().toISOString();
  const days = Number(durationDays);
  if (!Number.isInteger(days) || days < 1) return null;

  const band = deviceBand(device);
  const sub = device.subscription;
  const recommended = recommendedTerm(days);
  const recommendedPrice = band ? priceFor(band, recommended?.id) : null;
  const term = sub?.planId ? TERMS.find((t) => t.id === sub.planId) : null;

  // The batch as it would be: its own start date, its own length.
  const prospective = {
    ...device.batch,
    startDate: startDate || device.batch?.startDate || now,
    durationDays: days,
  };
  const cover = term ? coverageFor(sub, prospective, now) : null;
  const fit = term ? planFit(term.days, days) : null;
  const active = sub?.status === 'active' && !cover?.expired;

  return (
    <div style={{ marginTop: 10 }}>
      <div className="muted small">
        {recommended && (
          <>
            Recommended plan for a {days}-day batch: <b>{recommended.name}</b>
            {recommendedPrice !== null
              ? ` — ${fmtMoney(recommendedPrice)} for ${bandLabel(band)}`
              : band ? '' : ' — this system has no farm size recorded, so it cannot be priced yet'}
          </>
        )}
      </div>
      {fit && (
        <div className="muted small">
          A {term.name} pays for {fit.cycles} whole cycle{fit.cycles === 1 ? '' : 's'} of {days} days
          {fit.spareDays ? `, with ${fit.spareDays} days to spare` : ', with nothing to spare'}.
        </div>
      )}
      {!term && (
        <div className="warn-banner" style={{ marginTop: 8 }}>
          <Icon name="lock" size={18} />
          <div>No plan is paying for this system, so it stays locked until one is bought.</div>
        </div>
      )}
      {term && active && cover && !cover.coversBatch && (
        <div className="warn-banner" style={{ marginTop: 8 }}>
          <Icon name="alert" size={18} />
          <div>
            Your {term.name} ends {fmtDate(sub.endDate)} — {cover.shortfallDays} day
            {cover.shortfallDays === 1 ? '' : 's'} before this batch would. Renew or extend it, or the system
            locks with the animals still in the house.
          </div>
        </div>
      )}
      {term && active && cover && cover.coversBatch && (
        <div className="muted small" style={{ marginTop: 4 }}>
          Your {term.name} covers this batch to its last day ({fmtDate(cover.batchEndsAt)}).
        </div>
      )}
    </div>
  );
}

export default PlanFitNote;
