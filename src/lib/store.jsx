import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { buildSeed } from './seed.js';
import { addDays, nowIso } from './time.js';
import {
  apiDeviceToVm, createIotApi,
} from './iot.js';
import {
  deviceMode, liveCommandPlan, liveConfig, overlayLiveDevice, powerReassertPlan, storeDeviceFromVm,
} from './live.js';
import {
  createPaymentsApi, momoPhoneError, normalizeMomoPhone, paymentsConfig, providerFieldsFromRow,
} from './payments.js';
import {
  coverageFor, describeChange, deviceChicks, draftError, planFrom, publishImpact, reconcilePlans,
  sheetBandForChicks, sheetBandLabel, sheetBands, sheetChanges, sheetOf, sheetPrice, termById,
} from './subscriptions.js';
import {
  avgTemp, batchDay, generateAlerts, heaterDecision, makeAudit, paymentVerified,
  simulateMoMo, stepDownTargets, uid, PAYMENT_STATUS, SEVERITY,
} from './services.js';

const STORAGE_KEY = 'broodiinnox_app_v1';
const ALERT_DEDUPE_MS = 30 * 60000;
const REMINDER_KEYS = ['7d', '3d', '1d', 'expired'];

/* ------------------------------ reducer ------------------------------ */

function reducer(state, action) {
  switch (action.type) {
    case 'LOGIN':
      return { ...state, session: action.user };
    case 'LOGOUT':
      return { ...state, session: null };
    case 'SET_LANG':
      return { ...state, lang: action.lang };
    case 'SET_THEME':
      return { ...state, theme: action.theme };
    case 'TOAST':
      return { ...state, toast: { msg: action.msg, kind: action.kind || 'info', at: Date.now() } };
    case 'CLEAR_TOAST':
      return state.toast && Date.now() - state.toast.at > 3500 ? { ...state, toast: null } : state;

    case 'TICK':
      return tick(state);

    case 'SET_TARGETS': {
      const { deviceId, min, max } = action;
      const dev = state.devices.find((d) => d.id === deviceId);
      if (!dev) return state;
      return withAudit(
        {
          ...state,
          devices: state.devices.map((d) => (d.id === deviceId ? { ...d, baseMin: min, baseMax: max } : d)),
        },
        { user: state.session?.name, role: state.session?.role, action: 'temperature.change', details: `${deviceId} min ${dev.baseMin}°C→${min}°C, max ${dev.baseMax}°C→${max}°C`, prev: { min: dev.baseMin, max: dev.baseMax }, next: { min, max } }
      );
    }

    case 'SET_SENSOR': {
      const { deviceId, sensorId, enabled } = action;
      return {
        ...state,
        devices: state.devices.map((d) =>
          d.id === deviceId
            ? { ...d, sensors: d.sensors.map((s) => (s.id === sensorId ? { ...s, enabled } : s)) }
            : d
        ),
      };
    }

    case 'SET_SYSTEM_MODE': {
      // The AUT/MAN selector — deliberately separate from the ON/OFF switch,
      // because the two answer different questions. AUT means the system heats
      // by itself from the temperature (the firmware's thermostat); MAN means
      // the operator holds the heater on or off. The MODE is what is remembered
      // across a flip: switching OFF inside MAN and switching ON again must come
      // back to MAN, which is exactly what used to snap back to AUT because a
      // switch-on always sent relay AUTO.
      const { deviceId, mode } = action;
      if (mode !== 'auto' && mode !== 'manual') return state;
      const dev = state.devices.find((d) => d.id === deviceId);
      if (!dev) return state;
      const manual = mode === 'manual';
      // Choosing MAN holds the heater where it is RIGHT NOW, so the mode button
      // itself never moves the relay — the operator uses the switch for that.
      // No known relay state defaults to OFF: never a forced heater ON that
      // nobody asked for.
      const on = manual ? (action.on === undefined ? dev.heaterOn === true : !!action.on) : false;
      const at = nowIso();
      return withAudit(
        {
          ...state,
          devices: state.devices.map((d) => (d.id === deviceId
            ? {
              ...d,
              mode,
              modeSetByUser: true,
              modeSetAt: at,
              modeIntent: mode,
              modeIntentAt: at,
              modePending: !!d.live,
              modeUnconfirmed: false,
              // A new selection restarts the re-send budget.
              powerRetries: 0,
              powerRetryAt: null,
              powerError: null,
              ...(manual
                ? {
                  powerIntent: on ? 'on' : 'off',
                  powerIntentAt: at,
                  powerSetByUser: true,
                  powerSetAt: at,
                  powerPending: !!d.live,
                  powerUnconfirmed: false,
                  systemOn: on,
                  // A manual OFF must not show as heating; a live unit keeps
                  // reporting its own relay state either way.
                  heaterOn: d.live ? d.heaterOn : on,
                }
                : {
                  // AUT: the thermostat owns the heater, so no manual command
                  // stands any more and the system is running by itself.
                  powerIntent: null,
                  powerSetByUser: false,
                  powerPending: false,
                  powerUnconfirmed: false,
                  systemOn: true,
                }),
            }
            : d)),
        },
        {
          user: state.session?.name,
          role: state.session?.role,
          action: 'system.mode',
          // A card with no unit behind it (the demo fleet, or a device the
          // control server does not know) must not write a hardware-sounding
          // audit line: nothing was sent anywhere.
          details: (liveConfig.enabled && dev.live !== true)
            ? `${deviceId} demo system set to ${manual ? 'MAN (manual)' : 'AUT (automatic)'} — no unit connected, nothing was sent`
            : `${deviceId} control mode set to ${manual
              ? `MAN (manual — heater held ${on ? 'ON' : 'OFF'})`
              : 'AUT (relay AUTO — the thermostat decides)'}`,
          prev: { mode: deviceMode(dev) },
          next: { mode },
        }
      );
    }

    case 'SET_SYSTEM_POWER': {
      // Master ON/OFF switch for one Broodiinnox system (farmer or supervisor).
      // The firmware has no "power down the ESP32" topic — a unit that is off
      // cannot be switched back on remotely — so the switch drives the relay:
      // inside MAN, ON holds the heater on and OFF holds it off, while the unit
      // keeps reporting so it can always be switched back. `powerIntent` records
      // what was commanded; the unit's own `manual_control` + `relay_state`
      // report is what confirms it (and re-sends it if a reboot drops it), so
      // the switch can never claim a state the hardware is not in.
      //
      // In AUT the system switches the heater itself, so the command is refused
      // here as well as being disabled in the UI: a switch that cannot be obeyed
      // must not be recorded as if it had been.
      const { deviceId, on } = action;
      const dev = state.devices.find((d) => d.id === deviceId);
      if (!dev) return state;
      if (deviceMode(dev) !== 'manual') return state;
      const powerOn = !!on;
      return withAudit(
        {
          ...state,
          devices: state.devices.map((d) => (d.id === deviceId
            ? {
              ...d,
              systemOn: powerOn,
              powerSetByUser: true,
              powerSetAt: nowIso(),
              powerIntent: powerOn ? 'on' : 'off',
              powerIntentAt: nowIso(),
              powerPending: !!d.live,
              powerUnconfirmed: false,
              powerError: null,
              powerRetries: 0,
              powerRetryAt: null,
              // MAN ON holds the heater ON and MAN OFF holds it OFF, so a
              // simulated system follows the switch. A real (live) device keeps
              // reporting its own relay state instead.
              heaterOn: d.live ? d.heaterOn : powerOn,
            }
            : d)),
        },
        {
          user: state.session?.name,
          role: state.session?.role,
          action: powerOn ? 'system.on' : 'system.off',
          details: (liveConfig.enabled && dev.live !== true)
            ? `${deviceId} demo system toggled ${powerOn ? 'ON' : 'OFF'} — no unit connected, nothing was sent`
            : `${deviceId} system switched ${powerOn ? 'ON (MAN, relay ON)' : 'OFF (MAN, relay OFF)'}`,
          prev: { systemOn: dev.systemOn !== false },
          next: { systemOn: powerOn },
        }
      );
    }

    // The API answered a power command: 2xx means "published to the unit",
    // 4xx/5xx means the unit never got it. Only the hardware report confirms.
    case 'POWER_COMMAND_RESULT': {
      const { deviceId, ok, error } = action;
      const dev = state.devices.find((d) => d.id === deviceId);
      if (!dev) return state;
      if (ok) {
        return {
          ...state,
          devices: state.devices.map((d) => (d.id === deviceId ? { ...d, powerAckAt: nowIso() } : d)),
        };
      }
      // Refused or not published (device LOCKED, bridge down…): drop the
      // command so the selector and the switch show the unit's real state again,
      // and say why instead of leaving controls that silently do nothing.
      return {
        ...state,
        devices: state.devices.map((d) => (d.id === deviceId
          ? {
            ...d,
            // Back to what the UNIT reports — the only mode we can vouch for.
            mode: d.manual === true ? 'manual' : 'auto',
            modeIntent: null,
            modeSetByUser: false,
            modePending: false,
            modeUnconfirmed: false,
            powerIntent: null,
            powerSetByUser: false,
            powerPending: false,
            powerUnconfirmed: false,
            powerRetries: 0,
            powerRetryAt: null,
            powerError: error || 'The unit did not accept the command.',
            systemOn: d.manual === true ? d.heaterOn !== false : true,
          }
          : d)),
        toast: {
          msg: action.what === 'SET_SYSTEM_MODE'
            ? `Could not change the mode of ${dev.name || deviceId}: ${error || 'the unit did not accept the command'}`
            : `Could not switch ${dev.name || deviceId}: ${error || 'the unit did not accept the command'}`,
          kind: 'error',
          at: Date.now(),
        },
      };
    }

    // A re-send of an unconfirmed power command was issued (rate limiting).
    case 'POWER_REASSERT_SENT':
      return {
        ...state,
        devices: state.devices.map((d) => (d.id === action.deviceId
          ? { ...d, powerRetries: (d.powerRetries || 0) + 1, powerRetryAt: action.at }
          : d)),
      };

    case 'START_BATCH': {
      const { deviceId, animal, startDate, durationDays, count } = action;
      const dev = state.devices.find((d) => d.id === deviceId);
      if (!dev) return state;
      const preset = { chicken: [35, 37], duck: [33, 35], turkey: [34, 36], pig: [30, 32] }[animal] || [35, 37];
      const batch = { animal, startDate, durationDays, count, status: 'running' };
      // The subscription is what pays for a batch, so the batch is recorded
      // against it — and the log says plainly whether the plan reaches the end
      // of the cycle the farmer is starting.
      const cover = coverageFor(dev.subscription, batch, nowIso());
      const covered = !!cover.term && !cover.expired;
      const fit = !covered
        ? ' — no subscription is paying for it'
        : cover.coversBatch
          ? ` — ${cover.term.name} covers it (${cover.batchesUsed + 1} of ${cover.batchesCovered} batches)`
          : ` — ${cover.term.name} ends ${cover.shortfallDays}d before it (renew or extend)`;
      return withAudit(
        {
          ...state,
          devices: state.devices.map((d) =>
            d.id === deviceId
              ? {
                ...d,
                batch,
                baseMin: preset[0],
                baseMax: preset[1],
                subscription: covered && d.subscription
                  ? { ...d.subscription, batchesUsed: (d.subscription.batchesUsed || 0) + 1 }
                  : d.subscription,
              }
              : d
          ),
        },
        { user: state.session?.name, role: state.session?.role, action: 'batch.start', details: `${deviceId} started ${animal} batch (${durationDays}d, ${count} animals)${fit}` }
      );
    }

    case 'END_BATCH': {
      const { deviceId } = action;
      const dev = state.devices.find((d) => d.id === deviceId);
      if (!dev) return state;
      return withAudit(
        {
          ...state,
          devices: state.devices.map((d) =>
            d.id === deviceId
              ? { ...d, batch: { ...d.batch, status: 'ended' }, lastBatchEnd: nowIso() }
              : d
          ),
        },
        { user: state.session?.name, role: state.session?.role, action: 'batch.end', details: `${deviceId} batch ended` }
      );
    }

    case 'RENAME_DEVICE':
      return withAudit(
        {
          ...state,
          devices: state.devices.map((d) => (d.id === action.deviceId ? { ...d, name: action.name } : d)),
        },
        { user: state.session?.name, role: state.session?.role, action: 'device.rename', details: `${action.deviceId} → ${action.name}` }
      );

    case 'RESTART_DEVICE': {
      const { deviceId } = action;
      const dev = state.devices.find((d) => d.id === deviceId);
      if (!dev) return state;
      const now = nowIso();
      return withAudit(
        {
          ...state,
          devices: state.devices.map((d) =>
            d.id === deviceId ? { ...d, lastSeen: now, restartedAt: now } : d
          ),
        },
        { user: state.session?.name, role: state.session?.role, action: 'device.restart', details: `${deviceId} restarted remotely` }
      );
    }

    case 'SYNC_TIME': {
      const { deviceId } = action;
      const dev = state.devices.find((d) => d.id === deviceId);
      if (!dev) return state;
      const now = nowIso();
      return withAudit(
        {
          ...state,
          devices: state.devices.map((d) =>
            d.id === deviceId ? { ...d, timeSyncedAt: now } : d
          ),
        },
        { user: state.session?.name, role: state.session?.role, action: 'device.time_sync', details: `${deviceId} time synchronized` }
      );
    }

    case 'REQUEST_PAYMENT': {
      const { farmerId, deviceId, planId, phone } = action;
      const dev = state.devices.find((d) => d.id === deviceId);
      const term = planOf(state, planId);
      // Money leaving somebody's wallet is worth refusing early: a number MTN
      // MoMo cannot reach is a charge that cannot land, and a system that
      // already has a prompt live must not be prompted (or charged) twice.
      // Both checks apply to REAL payments only — the demo's simulated provider
      // behaves as it always has.
      if (paymentsConfig.enabled && !normalizeMomoPhone(phone)) {
        return { ...state, toast: { msg: momoPhoneError(phone), kind: 'error', at: Date.now() } };
      }
      if (state.payments.some((p) => p.deviceId === deviceId && p.status === PAYMENT_STATUS.PENDING && p.provider === true)) {
        return { ...state, toast: { msg: 'A payment for this system is already waiting for MTN MoMo — approve the prompt on your phone, or check its status.', kind: 'error', at: Date.now() } };
      }
      // The price is the SHEET's price for this farm size as the admin has it
      // now — what a farmer is charged is never a separate opinion.
      const band = sheetBandForChicks(state.sheet, deviceChicks(dev));
      const amount = sheetPrice(state.sheet, band, term);
      // A plan only has a price against a farm size, and the sheet quotes nothing
      // above 15,999 chicks. Refuse and say why rather than charge a guess.
      if (!dev || !term || amount === null) {
        return {
          ...state,
          toast: {
            msg: !dev
              ? 'That system is not in this account.'
              : !band
                ? 'No farm size is recorded for this system yet — Afriinnox records it at installation, and every plan is priced from it.'
                : 'This farm size is quoted individually — contact Afriinnox for a custom plan.',
            kind: 'error',
            at: Date.now(),
          },
        };
      }
      // The number as MTN MoMo will charge it: the record, the prompt note and
      // the request all carry one MSISDN, not whatever spacing was typed. A
      // number that cannot be normalized (the demo provider) is kept as it was.
      const msisdn = normalizeMomoPhone(phone) || phone;
      const payment = {
        id: uid('pay'), farmerId, deviceId, planId, phone: msisdn,
        bandId: band.id, farmSize: deviceChicks(dev), amount,
        method: 'MTN MoMo', status: PAYMENT_STATUS.PENDING,
        providerConfirmed: false, providerRef: null,
        period: `${planName(term)} — ${sheetBandLabel(state.sheet, band)}`, createdAt: nowIso(), confirmedAt: null,
        // `provider: true` means real money collected by MTN MoMo through the
        // Ekorana gateway: only the gateway may settle it
        // (PAYMENT_PROVIDER_STATUS), and only a gateway-confirmed payment
        // unlocks the unit. With no API configured the built-in simulation
        // settles it, as it always has.
        provider: paymentsConfig.enabled === true,
        currency: 'RWF',
        apiId: null, financialTxId: null, failureReason: null,
        submitting: false, submitError: null, statusCheckedAt: null,
      };
      return withAudit(
        { ...state, payments: [payment, ...state.payments] },
        { user: state.session?.name, role: state.session?.role, action: 'payment.request', details: `MoMo payment requested for ${deviceId}: ${planName(term)} for ${sheetBandLabel(state.sheet, band)} (RWF ${amount})` }
      );
    }

    case 'CONFIRM_PAYMENT': {
      // The demo provider (and an admin marking a demo payment paid). A REAL
      // payment is settled by the payment gateway and by nothing else: pressing
      // a button in the browser must never unlock a system nobody has paid for.
      const payment = state.payments.find((p) => p.id === action.paymentId);
      if (!payment || payment.status !== PAYMENT_STATUS.PENDING) return state;
      if (payment.provider === true) {
        return { ...state, toast: { msg: 'This payment is confirmed by the payment gateway, not by the app.', kind: 'error', at: Date.now() } };
      }
      const ok = action.ok !== undefined ? action.ok : true;
      return withAudit(
        applyPaymentOutcome(state, payment, { confirmed: ok, now: nowIso() }),
        { user: state.session?.name, role: state.session?.role, action: ok ? 'payment.success' : 'payment.failed', details: `MoMo payment ${ok ? 'confirmed' : 'failed'} for ${payment.deviceId} (RWF ${payment.amount})` }
      );
    }

    /* ---- the real provider: MTN MoMo, collected by the Ekorana gateway ---- */

    // The request is being handed to the API. The reducer stays pure, so the
    // call itself lives in the store's effect (see below).
    case 'PAYMENT_SUBMITTING':
      return {
        ...state,
        payments: state.payments.map((p) => (p.id === action.paymentId ? { ...p, submitting: true, submitError: null } : p)),
      };

    // The API answered a payment request: either a prompt is live on the
    // farmer's phone (keep the provider's reference so its status can be
    // polled) or the request was refused before anything was charged.
    case 'PAYMENT_PROVIDER_RESULT': {
      const payment = state.payments.find((p) => p.id === action.paymentId);
      if (!payment) return state;
      const fields = providerFieldsFromRow(action.row);
      if (action.ok) {
        return {
          ...state,
          payments: state.payments.map((p) => (p.id === payment.id
            ? { ...p, ...(fields || {}), submitting: false, submitError: null }
            : p)),
        };
      }
      const reason = action.error || 'The MTN MoMo request failed.';
      return withAudit(
        {
          ...state,
          payments: state.payments.map((p) => (p.id === payment.id
            ? {
              ...p,
              ...(fields || {}),
              status: PAYMENT_STATUS.FAILED,
              providerConfirmed: false,
              submitting: false,
              submitError: reason,
              failureReason: reason,
              confirmedAt: null,
            }
            : p)),
          toast: { msg: reason, kind: 'error', at: Date.now() },
        },
        { user: state.session?.name, role: state.session?.role, action: 'payment.failed', details: `MoMo payment for ${payment.deviceId} (RWF ${payment.amount}) was not requested: ${reason}` }
      );
    }

    // What MTN MoMo decided. This is the ONLY thing that settles a real
    // payment — a pending one stays pending until the provider answers.
    case 'PAYMENT_PROVIDER_STATUS': {
      const payment = state.payments.find((p) => p.id === action.paymentId);
      // A payment the gateway has already settled is never rewritten. One that
      // this server failed for want of an answer is still open to the gateway's
      // verdict — see awaitsProvider in broodiinnox-api/lib/payments.js — so its
      // answer may settle it now.
      if (!payment || payment.providerConfirmed === true) return state;
      const fields = providerFieldsFromRow(action.row);
      if (!fields) return state;
      const at = nowIso();
      if (fields.providerStatus === 'successful' && fields.providerConfirmed) {
        return withAudit(
          applyPaymentOutcome(state, payment, { confirmed: true, now: at, fields }),
          {
            user: state.session?.name,
            role: state.session?.role,
            action: 'payment.success',
            details: `MoMo payment confirmed by MTN for ${payment.deviceId} (RWF ${payment.amount})${fields.financialTxId ? ` — MTN ${fields.financialTxId}` : ''}${fields.providerRef ? `, ref ${fields.providerRef}` : ''}`,
          }
        );
      }
      if (fields.providerStatus === 'failed') {
        return withAudit(
          applyPaymentOutcome(state, payment, { confirmed: false, now: at, fields }),
          {
            user: state.session?.name,
            role: state.session?.role,
            action: 'payment.failed',
            details: `MoMo payment failed for ${payment.deviceId} (RWF ${payment.amount})${fields.failureReason ? ` — ${fields.failureReason}` : ''}`,
          }
        );
      }
      // Still pending: record what the provider said and when, nothing more.
      return {
        ...state,
        payments: state.payments.map((p) => (p.id === payment.id ? { ...p, ...fields } : p)),
      };
    }

    // "Check status": no provider call happens here — the API is asked (see
    // dispatchLive) and the answer arrives as PAYMENT_PROVIDER_STATUS. It marks
    // the row as already asked, so a payment the gateway has settled is not
    // asked about over and over.
    case 'PAYMENT_CHECK':
      return {
        ...state,
        payments: state.payments.map((p) => (p.id === action.paymentId ? { ...p, statusAsked: true } : p)),
      };

    // Whether this server can take payments at all, so the app can say so
    // before it takes somebody's number instead of failing their payment.
    case 'PROVIDER_HEALTH':
      return { ...state, provider: action.provider ?? null };

    /* Plans are edited as part of the price list, through the draft — see the
       SHEET_* actions below — so there is no separate plan write path. */

    /* ---- the price list: the admin edits a working copy, saves it, publishes it ---- */

    case 'SHEET_SAVE': {
      // Afriinnox owns the price list; a farmer must never reach this.
      if (state.session?.role !== 'admin') return state;
      const working = { bands: action.bands, plans: action.plans };
      const published = { bands: sheetBands(state.sheet), plans: state.plans };
      const reason = draftError(published, working);
      if (reason) return { ...state, toast: { msg: reason, kind: 'error', at: Date.now() } };
      const changes = sheetChanges(published, working);
      return withAudit(
        {
          ...state,
          sheetDraft: { bands: working.bands, plans: working.plans, savedAt: nowIso(), savedBy: state.session?.name || 'admin' },
        },
        {
          user: state.session?.name, role: state.session?.role, action: 'price_sheet.save',
          details: `Saved ${changes.length} unpublished change${changes.length === 1 ? '' : 's'} to the price list${changes.length ? ` — ${changes.slice(0, 3).map((c) => describeChange(c, working)).join('; ')}${changes.length > 3 ? `; +${changes.length - 3} more` : ''}` : ''}`,
          prev: null, next: { changes: changes.length },
        }
      );
    }

    case 'SHEET_DISCARD':
      if (state.session?.role !== 'admin') return state;
      if (!state.sheetDraft) return { ...state, toast: { msg: 'There is nothing saved to discard.', kind: 'error', at: Date.now() } };
      return withAudit(
        { ...state, sheetDraft: null },
        { user: state.session?.name, role: state.session?.role, action: 'price_sheet.discard', details: 'Discarded unpublished changes to the price list' }
      );

    case 'SHEET_PUBLISH': {
      if (state.session?.role !== 'admin') return state;
      const draft = state.sheetDraft;
      if (!draft) return { ...state, toast: { msg: 'There is nothing saved to publish.', kind: 'error', at: Date.now() } };
      const published = { bands: sheetBands(state.sheet), plans: state.plans };
      const reason = draftError(published, draft);
      if (reason) return { ...state, toast: { msg: reason, kind: 'error', at: Date.now() } };

      const changes = sheetChanges(published, draft);
      const impact = publishImpact(state.devices, changes, draft);
      const at = nowIso();
      // Every farmer the change touches hears about it, once, in their own words.
      const notices = impact.map(({ farmerId, items }) => ({
        id: uid('n'),
        farmerId,
        title: 'Price list updated',
        body: `${items.join('; ')}. This applies from now on — nothing you have already paid for changes.`,
        severity: 'info',
        read: false,
        at,
      }));

      const next = {
        ...state,
        sheet: {
          ...state.sheet,
          bands: draft.bands,
          updatedAt: at, updatedBy: state.session?.name || 'admin',
          publishedAt: at, publishedBy: state.session?.name || 'admin',
        },
        plans: draft.plans,
        sheetDraft: null,
        notifications: [...notices, ...state.notifications],
      };
      return withAudit(next, {
        user: state.session?.name, role: state.session?.role, action: 'price_sheet.publish',
        details: `Published the price list: ${changes.length} change${changes.length === 1 ? '' : 's'}${changes.length ? ` — ${changes.slice(0, 3).map((c) => describeChange(c, draft)).join('; ')}${changes.length > 3 ? `; +${changes.length - 3} more` : ''}` : ''}; ${notices.length} farmer(s) notified`,
        prev: null, next: { changes: changes.length, notified: notices.length },
      });
    }


    case 'SET_DEVICE_FARM_SIZE': {
      // The farm size is what a subscription is priced on, so it is set by
      // Afriinnox (the admin console) and only shown to a farmer: a farmer must
      // not be able to lower their own bill. A subscription already bought keeps
      // the band and price it was bought at — history is never re-derived.
      const { deviceId, farmSize } = action;
      if (state.session?.role !== 'admin') return state;
      const dev = state.devices.find((d) => d.id === deviceId);
      if (!dev) return state;
      const size = Number.isInteger(farmSize) && farmSize > 0 ? farmSize : null;
      if (size === null) return state;
      const band = sheetBandForChicks(state.sheet, size);
      return withAudit(
        { ...state, devices: state.devices.map((d) => (d.id === deviceId ? { ...d, farmSize: size } : d)) },
        {
          user: state.session?.name,
          role: state.session?.role,
          action: 'device.farm_size',
          details: `${deviceId} farm size set to ${size} chicks${band ? ` (${sheetBandLabel(state.sheet, band)})` : ' — above the published price list'}`,
          prev: { farmSize: dev.farmSize ?? null },
          next: { farmSize: size },
        }
      );
    }

    case 'REGISTER_DEVICE': {
      const farmSize = Number.isInteger(action.farmSize) && action.farmSize > 0 ? action.farmSize : null;
      const dev = {
        id: action.serial, serial: action.serial, name: action.name || action.serial, farmerId: action.farmerId || null,
        firmware: 'v2.1.0', installedAt: nowIso(), location: action.location || { district: '—', sector: '—', lat: 0, lng: 0 },
        baseMin: 35, baseMax: 37, safetyFloor: 20, batch: null,
        sensors: [1, 2, 3, 4].map((i) => ({ id: i, enabled: true, lastReading: 24, health: 'ok' })),
        heaterOn: false, lastSeen: nowIso(),
        // The farm size is recorded WITH the device: it is what every plan is
        // priced against, so it can never be guessed at billing time.
        farmSize,
        subscription: { planId: null, bandId: null, price: null, status: 'inactive', startDate: null, endDate: null },
        manualStatus: null,
      };
      const band = sheetBandForChicks(state.sheet, farmSize);
      return withAudit(
        { ...state, devices: [...state.devices, dev] },
        {
          user: state.session?.name,
          role: state.session?.role,
          action: 'device.register',
          details: `Registered ${action.serial}${band ? ` — farm size ${farmSize} chicks (${sheetBandLabel(state.sheet, band)})` : ' — farm size not set'}`,
        }
      );
    }

    case 'LIVE_SYNC': {
      // Overlay real broodiinnox-api state onto every store device whose id
      // matches a live device (so a device registered in the UI shows the
      // SAME real values as Admin Live), and add API-registered devices that
      // are not in the store yet. Devices absent from the API are untouched.
      const vms = (action.devices || []).filter((v) => v && v.id);
      const byVm = new Map(vms.map((v) => [v.id, v]));
      const liveIds = new Set(byVm.keys());
      const now = nowIso();
      let devices = state.devices.map((d) => (liveIds.has(d.id) ? overlayLiveDevice(d, byVm.get(d.id), now) : d));
      const have = new Set(devices.map((d) => d.id));
      for (const vm of vms) {
        if (!have.has(vm.id)) devices = [...devices, storeDeviceFromVm(vm, now)];
      }
      return {
        ...state,
        devices,
        liveDeviceIds: [...liveIds],
        // This API is the ONLY path to the hardware: record that it answered so
        // the UI can say plainly when it stops answering.
        liveHealth: { ok: true, at: action.at || now, error: null },
      };
    }

    case 'LIVE_POLL_FAILED': {
      // The control server did not answer. Keep the last good overlay, but stop
      // pretending: no switch can reach a unit until it answers again.
      const prev = state.liveHealth || {};
      return {
        ...state,
        liveHealth: {
          ok: false,
          at: action.at || nowIso(),
          error: action.error || 'control server unreachable',
          lastOkAt: prev.ok ? prev.at : (prev.lastOkAt || null),
        },
      };
    }

    case 'ASSIGN_DEVICE':
      return withAudit(
        { ...state, devices: state.devices.map((d) => (d.id === action.deviceId ? { ...d, farmerId: action.farmerId } : d)) },
        { user: state.session?.name, role: state.session?.role, action: 'device.assign', details: `${action.deviceId} → farmer ${action.farmerId}` }
      );

    case 'LOCK_DEVICE':
      return withAudit(
        { ...state, devices: state.devices.map((d) => (d.id === action.deviceId ? { ...d, manualLock: !!action.lock } : d)) },
        { user: state.session?.name, role: state.session?.role, action: action.lock ? 'device.lock' : 'device.unlock', details: `${action.deviceId} ${action.lock ? 'locked' : 'unlocked'} by admin` }
      );

    case 'REGISTER_FARMER': {
      const farmer = { id: uid('f'), status: 'active', createdAt: nowIso(), ...action.farmer };
      return withAudit(
        { ...state, farmers: [farmer, ...state.farmers] },
        { user: state.session?.name, role: state.session?.role, action: 'farmer.create', details: `Created farmer ${farmer.name}` }
      );
    }

    case 'UPDATE_FARMER':
      return withAudit(
        { ...state, farmers: state.farmers.map((f) => (f.id === action.id ? { ...f, ...action.patch } : f)) },
        { user: state.session?.name, role: state.session?.role, action: 'farmer.update', details: `Updated farmer ${action.id}` }
      );

    case 'ADD_TICKET': {
      const ticket = { id: uid('t'), status: 'new', assignee: null, messages: [], createdAt: nowIso(), ...action.ticket };
      return withAudit(
        { ...state, tickets: [ticket, ...state.tickets] },
        { user: state.session?.name, role: state.session?.role, action: 'ticket.open', details: `Ticket ${ticket.id}: ${ticket.subject}` }
      );
    }

    case 'UPDATE_TICKET':
      return withAudit(
        { ...state, tickets: state.tickets.map((t) => (t.id === action.id ? { ...t, ...action.patch } : t)) },
        { user: state.session?.name, role: state.session?.role, action: 'ticket.update', details: `Ticket ${action.id} → ${action.patch.status || 'updated'}` }
      );

    case 'TICKET_MESSAGE': {
      const msg = { author: action.author, at: nowIso(), text: action.text };
      return {
        ...state,
        tickets: state.tickets.map((t) => (t.id === action.id ? { ...t, messages: [...t.messages, msg] } : t)),
      };
    }

    case 'SEND_MESSAGE': {
      const msg = { id: uid('msg'), ...action.msg, sentAt: nowIso() };
      return withAudit(
        { ...state, messages: [msg, ...state.messages] },
        { user: state.session?.name, role: state.session?.role, action: 'message.send', details: `Message sent to ${action.msg.audience}` }
      );
    }

    case 'ADD_ADMIN':
      return withAudit(
        { ...state, admins: [...state.admins, { id: uid('a'), status: 'active', createdAt: nowIso(), ...action.admin }] },
        { user: state.session?.name, role: state.session?.role, action: 'admin.create', details: `Created admin ${action.admin.name} (${action.admin.role})` }
      );

    case 'UPDATE_ADMIN':
      return withAudit(
        { ...state, admins: state.admins.map((a) => (a.id === action.id ? { ...a, ...action.patch } : a)) },
        { user: state.session?.name, role: state.session?.role, action: 'admin.update', details: `Updated admin ${action.id}` }
      );

    case 'MAINTENANCE_UPDATE':
      return withAudit(
        { ...state, maintenance: state.maintenance.map((m) => (m.id === action.id ? { ...m, ...action.patch } : m)) },
        { user: state.session?.name, role: state.session?.role, action: 'maintenance.update', details: `Maintenance ${action.id} updated` }
      );

    case 'MAINTENANCE_ADD': {
      const rec = { id: uid('m'), status: 'ok', notes: '', ...action.record };
      return withAudit(
        { ...state, maintenance: [...state.maintenance, rec] },
        { user: state.session?.name, role: state.session?.role, action: 'maintenance.add', details: `Maintenance record for ${rec.deviceId}` }
      );
    }

    case 'INVENTORY_UPDATE':
      return { ...state, inventory: state.inventory.map((i) => (i.id === action.id ? { ...i, ...action.patch } : i)) };

    case 'INVENTORY_ADD':
      return { ...state, inventory: [...state.inventory, { id: uid('inv'), ...action.item }] };

    case 'MARK_ALERT_READ': {
      const id = action.id;
      return { ...state, alerts: state.alerts.map((a) => (a.id === id ? { ...a, read: true } : a)) };
    }

    case 'MARK_ALL_ALERTS_READ':
      return { ...state, alerts: state.alerts.map((a) => ({ ...a, read: true })) };

    case 'MARK_NOTIF_READ': {
      const id = action.id;
      return { ...state, notifications: state.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) };
    }

    case 'MARK_ALL_NOTIF_READ':
      return { ...state, notifications: state.notifications.map((n) => ({ ...n, read: true })) };

    case 'RESET_DATA':
      return { ...state, ...buildSeed(), reminderSent: [], session: null };

    default:
      return state;
  }
}

function withAudit(state, entry) {
  const audit = [makeAudit(entry), ...state.audit].slice(0, 500);
  return { ...state, audit };
}

/**
 * Settle a payment and, when it was confirmed, apply what it bought.
 *
 * EVERY path that settles a payment goes through here — the demo simulation,
 * the real one whose verdict arrives from broodiinnox-api, an admin marking a
 * demo payment paid — so there is exactly one definition of what "paid" does:
 * the subscription is EXTENDED (days already paid for are never thrown away),
 * the price and band it was bought at stay on the record as history, and the
 * farmer is told. A payment that was not confirmed only records why.
 */
function applyPaymentOutcome(state, payment, { confirmed, now, fields = null } = {}) {
  const at = now || nowIso();
  const settled = {
    ...payment,
    ...(fields || {}),
    status: confirmed ? PAYMENT_STATUS.SUCCESSFUL : PAYMENT_STATUS.FAILED,
    providerConfirmed: confirmed === true,
    submitting: false,
    submitError: confirmed ? null : (fields?.submitError || payment.submitError || null),
    confirmedAt: confirmed ? at : null,
    settledAt: at,
  };
  if (!confirmed) {
    return { ...state, payments: state.payments.map((p) => (p.id === settled.id ? settled : p)) };
  }

  const term = termById(settled.planId);
  const start = at;
  const devices = state.devices.map((d) => {
    if (d.id !== settled.deviceId) return d;
    const current = d.subscription;
    // A renewal EXTENDS the cover the farmer already has instead of throwing
    // the days left away; the price paid is the sum of what was paid.
    const stillRunning = !!current && current.status === 'active'
      && Date.parse(current.endDate || '') > Date.parse(start);
    const beginsAt = stillRunning ? current.endDate : start;
    return {
      ...d,
      subscription: {
        planId: settled.planId,
        bandId: settled.bandId ?? current?.bandId ?? null,
        farmSize: settled.farmSize ?? d.farmSize ?? null,
        price: stillRunning && typeof current.price === 'number'
          ? current.price + settled.amount
          : settled.amount,
        status: 'active',
        startDate: stillRunning ? current.startDate : start,
        endDate: term ? addDays(beginsAt, term.days) : beginsAt,
        batchesUsed: stillRunning ? (current.batchesUsed || 0) : 0,
      },
    };
  });

  return {
    ...state,
    payments: state.payments.map((p) => (p.id === settled.id ? settled : p)),
    devices,
    notifications: [
      { id: uid('n'), farmerId: settled.farmerId, title: 'Payment received', body: `Your RWF ${settled.amount} payment was confirmed. Device unlocked.`, severity: 'info', read: false, at },
      ...state.notifications,
    ],
  };
}

/** The plan an id refers to: the app's own plans first, the published terms second. */
function planOf(state, id) {
  return planFrom(state.plans, id);
}

/** How a plan is named everywhere: the name the admin gave it first, the sheet's second. */
function planName(plan) {
  const own = typeof plan?.name === 'string' ? plan.name.trim() : '';
  return own || termById(plan?.id)?.name || '';
}

/**
 * A saved working copy of the price list, repaired the way the list itself is:
 * its prices and labels are the admin's, but its plans are the sheet's five, so
 * a draft cannot carry a column the published list will never have.
 */
function reconcileDraft(draft) {
  if (!draft || typeof draft !== 'object' || !Array.isArray(draft.bands)) return null;
  return { ...draft, plans: reconcilePlans(draft.plans) };
}

/* ------------------------------- TICK -------------------------------- */

function tick(state) {
  const now = nowIso();
  const devices = state.devices.map((dev) => {
    // Real devices are written by LIVE_SYNC from the API — the mock ticker
    // must never wander their sensors or pretend they are fresh.
    if (dev.live) return dev;
    const day = dev.batch ? batchDay(dev.batch.startDate, dev.batch.durationDays, now) : 1;
    const { min, max } = stepDownTargets(dev.baseMin, dev.baseMax, day);
    const mid = (min + max) / 2;
    const sensors = dev.sensors.map((s) => {
      if (!s.enabled) return s;
      const cur = typeof s.lastReading === 'number' ? s.lastReading : mid;
      const wander = cur + (Math.random() - 0.5) * 0.3 + (mid - cur) * 0.06;
      return { ...s, lastReading: Math.round(wander * 10) / 10 };
    });
    const avg = avgTemp(sensors);
    // MAN holds the heater exactly where the operator put it (the firmware does
    // the same: manual_relay_control short-circuits the thermostat), AUT lets it
    // follow the target band, and a system switched off stays off.
    const heaterOn = deviceMode(dev) === 'manual'
      ? (dev.systemOn === false ? false : dev.heaterOn === true)
      : (dev.systemOn === false ? false : heaterDecision(avg, min, max, dev.heaterOn));
    return { ...dev, sensors, heaterOn, lastSeen: now, day, targets: { min, max } };
  });

  let alerts = [...state.alerts];
  for (const dev of devices) {
    for (const a of generateAlerts(dev, now)) {
      const fresh = alerts.find((x) => x.deviceId === dev.id && x.key === a.key && (new Date(now) - new Date(x.at)) < ALERT_DEDUPE_MS);
      if (!fresh) {
        alerts = [{ id: uid('al'), deviceId: dev.id, key: a.key, severity: a.severity, message: a.message, at: now, read: false }, ...alerts];
      }
    }
  }

  // maintenance due alerts (dedupe 12h)
  for (const m of state.maintenance) {
    if (new Date(now) >= new Date(m.nextMaintenance) && m.status !== 'completed') {
      const fresh = alerts.find((x) => x.deviceId === m.deviceId && x.key === 'maintenance_due' && (new Date(now) - new Date(x.at)) < 12 * 3600000);
      if (!fresh) {
        alerts = [{ id: uid('al'), deviceId: m.deviceId, key: 'maintenance_due', severity: SEVERITY.WARNING, message: `Maintenance due for ${m.deviceId}.`, at: now, read: false }, ...alerts];
      }
    }
  }

  // expiry reminders (once per day per device+key)
  let reminderSent = [...(state.reminderSent || [])];
  let notifications = [...state.notifications];
  for (const dev of devices) {
    const sub = dev.subscription;
    if (!sub || sub.status !== 'active') continue;
    const dayKey = new Date(now).toISOString().slice(0, 10);
    for (const key of REMINDER_KEYS) {
      const due = key === 'expired'
        ? new Date(now) > new Date(sub.endDate)
        : Math.ceil((new Date(sub.endDate) - new Date(now)) / 86400000) === Number(key.replace('d', ''));
      const sentKey = `${dev.id}:${key}:${dayKey}`;
      if (due && !reminderSent.includes(sentKey)) {
        reminderSent = [...reminderSent, sentKey].slice(-200);
        notifications = [
          { id: uid('n'), farmerId: dev.farmerId, title: 'Subscription reminder', body: `${dev.name} subscription ${key === 'expired' ? 'has expired' : `expires in ${key.replace('d', '')} day(s)`}.`, severity: key === 'expired' ? 'critical' : 'warning', read: false, at: now },
          ...notifications,
        ];
      }
    }
  }

  // mock MoMo provider confirms pending payments older than 30s
  let payments = state.payments;
  let devices2 = devices;
  for (const p of payments) {
    // A REAL payment is settled only by the gateway's own answer, which the app
    // reads from the API: the demo ticker must never confirm one.
    if (p.provider === true) continue;
    if (p.status === PAYMENT_STATUS.PENDING && new Date(now) - new Date(p.createdAt) > 30000) {
      const ok = simulateMoMo(p).status === PAYMENT_STATUS.SUCCESSFUL;
      payments = payments.map((x) => (x.id === p.id ? { ...x, status: ok ? PAYMENT_STATUS.SUCCESSFUL : PAYMENT_STATUS.FAILED, providerConfirmed: ok, confirmedAt: now } : x));
      if (ok) {
        const plan = state.plans.find((pl) => pl.id === p.planId);
        const start = now;
        const end = plan ? addDays(start, plan.durationDays) : start;
        devices2 = devices2.map((d) => (d.id === p.deviceId ? { ...d, subscription: { planId: p.planId, status: 'active', startDate: start, endDate: end } } : d));
        notifications = [
          { id: uid('n'), farmerId: p.farmerId, title: 'Payment received', body: `Your RWF ${p.amount} payment was confirmed. Device unlocked.`, severity: 'info', read: false, at: now },
          ...notifications,
        ];
      }
    }
  }

  return {
    ...state, devices: devices2, payments, alerts, notifications, reminderSent,
  };
}

/* ------------------------------ provider ----------------------------- */

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // The price list belongs to Afriinnox, not to the browser: a state saved
      // before the sheet was editable carries none and gets the published one,
      // and the plans on it are always the approved five, however old the
      // catalogue saved alongside them is. See `reconcilePlans`.
      return {
        ...saved,
        sheet: sheetOf(saved.sheet),
        plans: reconcilePlans(saved.plans),
        sheetDraft: reconcileDraft(saved.sheetDraft),
      };
    }
  } catch {
    /* ignore */
  }
  return { ...buildSeed(), reminderSent: [] };
}

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Live API client (null when VITE_IOT_API_URL is unset — simulation mode).
  const api = useMemo(() => (liveConfig.enabled ? createIotApi(liveConfig) : null), []);

  // MTN MoMo client (null when no API is configured — the built-in simulation
  // settles its own payments then, exactly as it always has).
  const payApi = useMemo(() => (paymentsConfig.enabled ? createPaymentsApi(paymentsConfig) : null), []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore quota errors */
    }
  }, [state]);

  useEffect(() => {
    if (import.meta.env.MODE === 'test') return undefined;
    const t = setInterval(() => dispatch({ type: 'TICK' }), 5000);
    return () => clearInterval(t);
  }, []);

  // Poll broodiinnox-api so every registered device reflects its real state
  // in EVERY page (Systems, Devices, Map, details…), exactly like Admin Live.
  useEffect(() => {
    if (!liveConfig.enabled || !api) return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await api.listDevices();
        if (cancelled) return;
        const vms = (data?.devices || []).map(apiDeviceToVm).filter(Boolean);
        const at = new Date().toISOString();
        dispatch({ type: 'LIVE_SYNC', devices: vms, at });

        // Keep a switched-off system off. The firmware holds manual mode in RAM
        // only, so a reboot, a power cut or a failsafe recovery drops it and the
        // heater resumes by itself — the farmer's OFF would silently evaporate.
        // Re-send it (throttled and capped) until the unit reports it again.
        try {
          const byId = new Map(vms.map((v) => [v.id, v]));
          for (const dev of stateRef.current.devices) {
            const plan = powerReassertPlan(dev, byId.get(dev.id), at);
            if (!plan) continue;
            try {
              await api.sendCommand(dev.id, plan.command, plan.value);
            } catch {
              /* the next poll tries again, capped by POWER_MAX_REASSERTS */
            }
            if (cancelled) return;
            dispatch({ type: 'POWER_REASSERT_SENT', deviceId: dev.id, at });
          }
        } catch {
          /* never let the re-send break the poll */
        }
      } catch (err) {
        if (cancelled) return;
        // Keep the last good overlay, but never hide that the only path to
        // the units is down — a switch flipped now reaches no hardware.
        dispatch({
          type: 'LIVE_POLL_FAILED',
          at: new Date().toISOString(),
          error: err?.message || String(err),
        });
      }
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [api]);

  // Real MTN MoMo payments: hand each new one to the API, then ask the gateway
  // what it decided about the ones already asked. Nothing in here can confirm a
  // payment — it only carries the gateway's answer into the store, and that
  // answer is the only thing that ever activates a subscription or unlocks a
  // unit.
  //
  // Keyed on the payments still needing submission rather than on the whole
  // payments array, so the status updates this loop produces cannot restart it.
  const unsentPayments = state.payments
    .filter((p) => p.provider === true && p.status === PAYMENT_STATUS.PENDING && !p.apiId)
    .map((p) => p.id)
    .join(',');

  useEffect(() => {
    if (!payApi) return undefined;
    let cancelled = false;

    const submit = async () => {
      const due = stateRef.current.payments.find((p) => p.provider === true
        && p.status === PAYMENT_STATUS.PENDING && !p.apiId && !p.submitting);
      if (!due) return;
      dispatch({ type: 'PAYMENT_SUBMITTING', paymentId: due.id });
      try {
        const out = await payApi.requestPayment({
          device_id: due.deviceId,
          farmer_id: due.farmerId,
          plan_id: due.planId,
          band_id: due.bandId,
          amount: due.amount,
          phone: due.phone,
          currency: due.currency || 'RWF',
        });
        if (cancelled) return;
        dispatch({ type: 'PAYMENT_PROVIDER_RESULT', paymentId: due.id, ok: true, row: out?.payment || null });
        // The server answered 202: it could not get an answer out of the gateway
        // and the payment is still open. Saying nothing would leave the farmer
        // staring at "waiting" with no idea whether a prompt is coming.
        if (out?.notice) dispatch({ type: 'TOAST', msg: out.notice, kind: 'info' });
      } catch (err) {
        if (cancelled) return;
        dispatch({ type: 'PAYMENT_PROVIDER_RESULT', paymentId: due.id, ok: false, error: err?.message, row: err?.payment || null });
      }
    };

    const poll = async () => {
      const waiting = stateRef.current.payments.filter((p) => p.provider === true
        && p.status === PAYMENT_STATUS.PENDING && p.apiId);
      for (const p of waiting) {
        try {
          const out = await payApi.getPayment(p.apiId);
          if (cancelled) return;
          if (out?.payment) dispatch({ type: 'PAYMENT_PROVIDER_STATUS', paymentId: p.id, row: out.payment });
        } catch {
          /* the next poll asks again: a slow provider is not a failed payment */
        }
      }

      // A payment this app recorded as failed is still asked about ONCE, in case
      // the server is holding one the gateway has since settled — the case where
      // a request we never got an answer for was in fact collected. The server is
      // authoritative, so a row it has settled is left alone from then on.
      for (const p of stateRef.current.payments) {
        if (p.provider !== true || !p.apiId) continue;
        if (p.status !== PAYMENT_STATUS.FAILED || p.providerConfirmed === true || p.statusAsked) continue;
        dispatch({ type: 'PAYMENT_CHECK', paymentId: p.id });
      }
    };

    submit();
    poll();
    const timer = setInterval(() => { submit(); poll(); }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [payApi, unsentPayments]);

  // Can this server take payments at all? Asked on load and re-asked once a
  // minute, so an Ekorana key that was just set on Render shows up here — and a
  // farmer is told before typing a number, not after a wasted attempt.
  const providerDesc = state.provider
    ? `${state.provider.enabled}|${(state.provider.missing || []).join(',')}|${(state.provider.invalid || []).join(',')}`
    : '';
  useEffect(() => {
    if (!payApi) return undefined;
    let cancelled = false;
    const check = async () => {
      try {
        const provider = await payApi.providerStatus();
        if (cancelled || !provider) return;
        const desc = `${provider.enabled}|${(provider.missing || []).join(',')}|${(provider.invalid || []).join(',')}`;
        if (desc === providerDesc) return; // nothing new to say
        dispatch({ type: 'PROVIDER_HEALTH', provider });
      } catch {
        /* an API older than this app: say nothing rather than guess */
      }
    };
    check();
    const timer = setInterval(check, 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [payApi, providerDesc]);

  useEffect(() => {
    if (!state.toast) return undefined;
    const t = setTimeout(() => dispatch({ type: 'CLEAR_TOAST' }), 3600);
    return () => clearTimeout(t);
  }, [state.toast]);

  // Forward user actions that touch a real device to the hardware via the
  // API (register, targets, sensors, lock), best-effort with a toast on error.
  const dispatchLive = useCallback((action) => {
    dispatch(action);
    if (!liveConfig.enabled || !api) return;
    const st = stateRef.current;
    const toastErr = (err) =>
      dispatch({ type: 'TOAST', msg: `Live: ${err?.message || 'request failed'}`, kind: 'error' });

    // "Check status": ask the API for MTN's verdict on one payment now, rather
    // than waiting for the next poll. The answer is what settles it — never
    // this call itself.
    if (action?.type === 'PAYMENT_CHECK') {
      const p = st.payments.find((x) => x.id === action.paymentId);
      if (!p?.apiId) return;
      payApi.refreshPayment(p.apiId)
        .then((out) => {
          if (out?.payment) dispatch({ type: 'PAYMENT_PROVIDER_STATUS', paymentId: p.id, row: out.payment });
        })
        .catch((err) => dispatch({ type: 'TOAST', msg: err?.message || 'Could not check the payment with MTN MoMo.', kind: 'error' }));
      return;
    }
    if (action?.type === 'REGISTER_DEVICE') {
      const location = typeof action.location === 'string' ? action.location : action.location?.district || '';
      api.registerDevice({
        device_id: action.serial,
        name: action.name || action.serial,
        farmer_id: action.farmerId || 'dev',
        location,
      }).catch(toastErr);
      return;
    }
    if (action?.type === 'RENAME_DEVICE') {
      // Keep the API registration name in sync with the app (POST /api/devices
      // is an upsert), so Live Monitoring shows the SAME name as Systems.
      const dev = action.deviceId ? st.devices.find((d) => d.id === action.deviceId) : null;
      if (dev) {
        const loc = typeof dev.location === 'string' ? dev.location : dev.location?.district || '';
        api.registerDevice({
          device_id: dev.id,
          name: action.name,
          farmer_id: dev.farmerId || 'dev',
          location: loc,
        }).catch(toastErr);
      }
      return;
    }
    const dev = action?.deviceId ? st.devices.find((d) => d.id === action.deviceId) : null;

    // The mode selector and the master switch are the two controls the operator
    // must be able to trust: report a refusal (locked device, bridge down)
    // instead of leaving controls that silently do nothing.
    if (action?.type === 'SET_SYSTEM_POWER' || action?.type === 'SET_SYSTEM_MODE') {
      for (const c of liveCommandPlan(action, dev)) {
        api.sendCommand(action.deviceId, c.command, c.value)
          .then(() => dispatch({ type: 'POWER_COMMAND_RESULT', deviceId: action.deviceId, ok: true }))
          .catch((err) => dispatch({
            type: 'POWER_COMMAND_RESULT',
            deviceId: action.deviceId,
            ok: false,
            what: action.type,
            error: err?.message,
          }));
      }
      return;
    }

    const plan = liveCommandPlan(action, dev);
    for (const c of plan) {
      api.sendCommand(action.deviceId, c.command, c.value).catch(toastErr);
    }
  }, [api, payApi]);

  const value = useMemo(() => ({ state, dispatch: dispatchLive }), [state, dispatchLive]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  return useContext(StoreContext);
}

export { paymentVerified };
