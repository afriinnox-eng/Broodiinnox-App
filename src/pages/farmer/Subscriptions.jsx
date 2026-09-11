import React, { useMemo, useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { subscriptionState } from '../../lib/services.js';
import {
  BANDS, TERMS, bandLabel, coverageFor, deviceBand, deviceChicks, farmSizeIsEstimated,
  planFit, plansForBand, priceFor,
} from '../../lib/subscriptions.js';
import { fmtDate, fmtDateTime } from '../../lib/time.js';
import { Badge, Btn, Card, EmptyState } from '../../components/ui.jsx';
import { Icon } from '../../components/icons.jsx';
import PayModal from '../../components/PayModal.jsx';
import { fmtMoney, t } from '../../i18n/strings.js';

/**
 * The farmer's subscriptions.
 *
 * A subscription is bought per batch, and what it costs is decided by the farm
 * size the device was registered with (the maximum number of chicks brooded at
 * once). So the plans shown by default are the ones priced for THAT farm size,
 * and one button opens the whole published price list for farmers who want to
 * compare what other sizes pay.
 */
export default function FarmerSubscriptions() {
  const { state, dispatch } = useStore();
  const lang = state.lang || 'en';
  const now = new Date().toISOString();
  const myDevices = useMemo(() => state.devices.filter((d) => d.farmerId === state.session.id), [state.devices, state.session.id]);
  const [payFor, setPayFor] = useState(null); // { device, planId }
  const [showAll, setShowAll] = useState(false);

  const planOf = (id) => state.plans.find((p) => p.id === id) || TERMS.find((x) => x.id === id);
  const myBands = new Set(myDevices.map((d) => deviceBand(d)?.id).filter(Boolean));

  const locked = myDevices.filter((d) => subscriptionState(d.subscription?.endDate, now) !== 'active');
  const shortOfBatch = myDevices.filter((d) => {
    const c = coverageFor(d.subscription, d.batch, now);
    return c.term && !c.expired && c.batchDays && !c.coversBatch;
  });

  /** "covers it" / "ends N days before it" for a subscription and its batch. */
  const coverLine = (c) => {
    if (!c.term) return 'No subscription yet — the system is locked.';
    if (c.expired) return 'This subscription has ended.';
    if (!c.batchDays) return 'No batch is running, so there is nothing for it to cover.';
    if (c.coversBatch) return `Covers this whole ${c.batchDays}-day batch, to its last day.`;
    return `Ends ${c.shortfallDays} day${c.shortfallDays === 1 ? '' : 's'} before this ${c.batchDays}-day batch does.`;
  };

  /** What a plan can pay for, in whole cycles of the batch running now. */
  const capacityLine = (device, termId) => {
    const fit = planFit(TERMS.find((x) => x.id === termId)?.days, device.batch?.durationDays);
    if (!fit) return '—';
    if (fit.tooShort) return `Too short for one ${fit.batchDays}-day cycle — you would have to extend it`;
    return `${fit.cycles} cycle${fit.cycles === 1 ? '' : 's'} of ${fit.batchDays} days${fit.spareDays ? `, with ${fit.spareDays} days to spare` : ', with nothing to spare'}`;
  };

  return (
    <div>
      <h1>{t('nav.subscriptions', lang)}</h1>
      <p className="muted">
        You pay per batch, and the price of a plan is set by your farm size — the maximum
        number of chicks your system broods at once. A longer plan can pay for several batches in a row;
        a plan shorter than one batch has to be extended before the cycle ends.
      </p>

      {locked.length > 0 && (
        <div className="warn-banner" style={{ margin: '12px 0' }}>
          <Icon name="lock" size={20} />
          <div>
            <b>{locked.length} system(s) are locked</b> because their subscription lapsed. Renew below to
            unlock instantly after MoMo confirmation.
          </div>
        </div>
      )}
      {shortOfBatch.length > 0 && (
        <div className="warn-banner" style={{ margin: '12px 0' }}>
          <Icon name="clock" size={20} />
          <div>
            <b>{shortOfBatch.length} subscription(s) end before their batch does.</b> The system locks when the
            days run out, with the animals still in the house — renew or extend to cover the rest of the cycle.
          </div>
        </div>
      )}

      <h3 style={{ marginTop: 8 }}>Your systems and their plans</h3>
      {myDevices.length === 0 && <EmptyState icon="card" text="No systems yet." />}
      <div className="grid cols-2">
        {myDevices.map((d) => {
          const sub = d.subscription;
          const band = deviceBand(d);
          const chicks = deviceChicks(d);
          const active = sub?.status === 'active' && subscriptionState(sub.endDate, now) === 'active';
          const c = coverageFor(sub, d.batch, now);
          const plans = plansForBand(band);
          const subBand = sub?.bandId ? BANDS.find((b) => b.id === sub.bandId) : null;

          return (
            <Card key={d.id} title={`${d.name} (${d.serial})`}>
              <div className="muted small">
                Farm size: <b>{chicks ? `${chicks.toLocaleString('en-US')} chicks` : 'not recorded yet'}</b>
                {band ? ` · ${bandLabel(band)}` : ''}
                {farmSizeIsEstimated(d) ? ' (estimated from the batch running now)' : ''}
              </div>

              <div className="row-between" style={{ marginTop: 8 }}>
                <div>
                  {active ? (
                    <>
                      <div style={{ fontWeight: 800 }}>
                        {planOf(sub.planId)?.name || 'Plan'} — {fmtMoney(sub.price ?? 0)}
                      </div>
                      <div className="muted small">
                        Started {fmtDate(sub.startDate)} · expires {fmtDate(sub.endDate)}
                        {subBand ? ` · bought for ${bandLabel(subBand)}` : ''}
                      </div>
                    </>
                  ) : (
                    <div style={{ fontWeight: 700, color: 'var(--crit)' }}>
                      {sub ? 'Expired' : 'No subscription'} — device locked
                    </div>
                  )}
                </div>
                {active
                  ? <Badge tone={c.daysLeft <= 7 ? 'warn' : 'ok'}>{c.daysLeft} days left</Badge>
                  : <Badge tone="crit">Locked</Badge>}
              </div>

              {sub?.planId && (
                <div
                  className={`small ${c.term && !c.expired && c.batchDays && !c.coversBatch ? 'power-switch-status bad' : 'muted'}`}
                  style={{ marginTop: 6 }}
                >
                  {coverLine(c)}
                  {c.term && c.batchesCovered > 0 && c.batchDays
                    ? ` · ${c.batchesUsed} of ${c.batchesCovered} batches paid for (${c.batchDays} days each)`
                    : ''}
                  {c.leftover ? ` · ${c.leftover} paid days fall outside a whole batch` : ''}
                </div>
              )}

              {band ? (
                <>
                  <div className="muted small" style={{ marginTop: 10, fontWeight: 700 }}>
                    Plans for {bandLabel(band)}
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Plan</th>
                          <th>Days</th>
                          <th>Your price</th>
                          <th>Pays for</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {plans.map(({ term, price }) => (
                          <tr key={term.id}>
                            <td>
                              <b>{term.name}</b>
                              <div className="muted small">{term.description}</div>
                            </td>
                            <td>{term.days}</td>
                            <td>{price === null ? 'Customized' : fmtMoney(price)}</td>
                            <td className="muted small">{capacityLine(d, term.id)}</td>
                            <td>
                              <Btn
                                small
                                variant={active && sub?.planId === term.id ? 'primary' : 'green'}
                                disabled={price === null}
                                onClick={() => setPayFor({ device: d, planId: term.id })}
                              >
                                {active ? 'Renew / extend' : 'Choose'}
                              </Btn>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="warn-banner" style={{ marginTop: 10 }}>
                  <Icon name="alert" size={18} />
                  <div>
                    No farm size is recorded for this system yet, so no price can be quoted. Afriinnox records
                    it at installation — the plans below the price list show what each size pays.
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <div className="row-between" style={{ marginTop: 20 }}>
        <h3 style={{ margin: 0 }}>{showAll ? 'The full price list' : 'Subscriptions for other farm sizes'}</h3>
        <Btn small onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Hide other farm sizes' : 'View all subscription plans'}
        </Btn>
      </div>

      {showAll ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Farm size (chicks)</th>
                {TERMS.map((term) => <th key={term.id}>{term.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {BANDS.map((band) => {
                const mine = myBands.has(band.id);
                return (
                  <tr key={band.id} style={mine ? { background: 'var(--surface-2)', fontWeight: 700 } : undefined}>
                    <td>{bandLabel(band)}{mine ? ' · your size' : ''}</td>
                    {TERMS.map((term) => {
                      const price = priceFor(band, term);
                      return <td key={term.id}>{price === null ? 'Customized' : fmtMoney(price)}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small">
          {myBands.size === 0
            ? 'Your farm size has not been recorded yet — the full price list shows what every size pays.'
            : 'Your systems\' own sizes are shown above. Open the full price list to compare what other farm sizes pay.'}
        </p>
      )}

      <h3 style={{ marginTop: 20 }}>Payment history</h3>
      {state.payments.filter((p) => p.farmerId === state.session.id).length === 0 ? <EmptyState icon="wallet" text="No payments yet." /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>System</th><th>Plan</th><th>Farm size</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {state.payments.filter((p) => p.farmerId === state.session.id).slice(0, 8).map((p) => (
                <tr key={p.id}>
                  <td>{fmtDateTime(p.createdAt)}</td>
                  <td>{p.deviceId}</td>
                  <td>{planOf(p.planId)?.name || '—'}</td>
                  <td className="muted small">{p.farmSize ? `${p.farmSize.toLocaleString('en-US')} chicks` : '—'}</td>
                  <td>{fmtMoney(p.amount)}</td>
                  <td>
                    <Badge tone={{ successful: 'ok', pending: 'warn', failed: 'crit', cancelled: 'off' }[p.status] || 'off'}>
                      {p.status}{p.providerRef ? ` · ${p.providerRef}` : ''}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {payFor && <PayModal device={payFor.device} initialPlanId={payFor.planId} onClose={() => setPayFor(null)} />}
    </div>
  );
}
