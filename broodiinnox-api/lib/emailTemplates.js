/**
 * Every email Broodiinnox sends, rendered from one place.
 *
 * Each template is a pure function of its data: no clock, no store, no network.
 * That is what makes the whole set testable, and it is why a malformed record
 * can never make a notification throw — a missing field renders as a sensible
 * blank rather than crashing the request that was only trying to send a receipt.
 *
 * The templates here cover the moments this system actually reaches a person:
 *
 *   welcome                a farmer is registered / invited
 *   password_reset         someone asked to set a new password
 *   payment_received       the gateway confirmed money, days were added
 *   payment_failed         a payment attempt did not go through
 *   device_alert           the unit raised a critical or warning condition
 *   subscription_expiring  the paid period is nearly over
 *
 * Every interpolated value is HTML-escaped. A farmer whose name contains `<`
 * must not be able to inject markup into a receipt, so escaping happens inside
 * `layout()` and the templates never write markup around raw data themselves.
 *
 * Emails are written in English. The dashboard is trilingual (English, French,
 * Kinyarwanda), so a farmer who uses the app in Kinyarwanda still receives
 * English mail — the `lang` on a contact is recorded but not yet used to pick a
 * translation.
 */

/** Escape the five characters that matter in HTML text and attributes. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `25000 / 'RWF'` -> `'RWF 25,000'`. Tolerates a missing or odd amount. */
export function formatAmount(amount, currency = 'RWF') {
  const n = Number(amount);
  const cur = String(currency || 'RWF').toUpperCase();
  if (!Number.isFinite(n)) return cur;
  return `${cur} ${n.toLocaleString('en-US')}`;
}

/** A short, human date. Falls back to an empty string rather than "Invalid Date". */
export function formatWhen(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function str(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  const s = String(value).trim();
  return s || fallback;
}

/** The shared shell. All data interpolation into HTML goes through escape(). */
function layout({ title, intro, rows = [], paragraphs = [], action = null, footerNote = '' }) {
  const e = escapeHtml;

  const rowHtml = rows
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    .map(([k, v]) => (
      `<tr>` +
        `<td style="padding:6px 0;color:#6b7280;font-size:13px;">${e(k)}</td>` +
        `<td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;text-align:right;">${e(v)}</td>` +
      `</tr>`
    ))
    .join('');

  const bodyHtml = paragraphs
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 12px;color:#374151;font-size:14px;line-height:1.6;">${e(p)}</p>`)
    .join('');

  const actionHtml = action
    ? `<p style="margin:20px 0 4px;">` +
        `<a href="${e(action.url)}" style="display:inline-block;background:#0f766e;color:#ffffff;` +
        `padding:11px 20px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">${e(action.label)}</a>` +
      `</p>` +
      `<p style="margin:8px 0 0;color:#6b7280;font-size:12px;word-break:break-all;">${e(action.url)}</p>`
    : '';

  const rowsHtml = rowHtml
    ? `<table style="width:100%;border-collapse:collapse;margin:16px 0 4px;">${rowHtml}</table>`
    : '';

  const footHtml = footerNote
    ? `<p style="margin:18px 0 0;color:#6b7280;font-size:12px;line-height:1.6;">${e(footerNote)}</p>`
    : '';

  return (
    `<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f6;">` +
    `<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:Arial,Helvetica,sans-serif;">` +
      `<div style="background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e5e7eb;">` +
        `<p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#0f766e;">Broodiinnox</p>` +
        `<h1 style="margin:0 0 12px;font-size:19px;color:#111827;">${e(title)}</h1>` +
        (intro ? `<p style="margin:0 0 12px;color:#374151;font-size:14px;line-height:1.6;">${e(intro)}</p>` : '') +
        rowsHtml +
        bodyHtml +
        actionHtml +
        footHtml +
      `</div>` +
      `<p style="margin:14px 0 0;color:#9ca3af;font-size:11px;text-align:center;">` +
        `Broodiinnox — Afriinnox Ltd. This message was sent automatically.` +
      `</p>` +
    `</div></body></html>`
  );
}

function plain(lines) {
  return lines.filter((l) => l !== undefined && l !== null && String(l).trim() !== '').join('\n') + '\n';
}

function rowLines(rows) {
  return rows
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    .map(([k, v]) => `${k}: ${String(v)}`);
}

/**
 * The templates. Each returns { subject, text, html }.
 * `data` is whatever the caller has; nothing here requires a field to exist.
 */
export const EMAIL_TEMPLATES = {
  /** A new farmer account / invitation. */
  welcome(data = {}) {
    const name = str(data.name, 'there');
    const appUrl = str(data.appUrl);
    const rows = [
      ['Name', str(data.name)],
      ['Phone', str(data.phone)],
      ['System', str(data.deviceId)],
    ];
    return {
      subject: 'Your Broodiinnox account is ready',
      text: plain([
        `Hello ${name},`,
        '',
        'A Broodiinnox account has been created for you. You can now sign in to monitor and control your brooding system from your phone.',
        '',
        ...rowLines(rows),
        '',
        appUrl ? `Sign in: ${appUrl}` : '',
        '',
        'If you were not expecting this, please contact Afriinnox.',
      ]),
      html: layout({
        title: 'Your Broodiinnox account is ready',
        intro: `Hello ${name}, a Broodiinnox account has been created for you. You can now sign in to monitor and control your brooding system from your phone.`,
        rows,
        action: appUrl ? { url: appUrl, label: 'Open Broodiinnox' } : null,
        footerNote: 'If you were not expecting this, please contact Afriinnox.',
      }),
    };
  },

  /** The reset link. Single-use and time-limited; the token is never echoed. */
  password_reset(data = {}) {
    const name = str(data.name, 'there');
    // Accept either a bare URL string or a `{ url }` object, and reduce both to
    // one string — an object reaching escapeHtml() would render as
    // "[object Object]" in the link, which is a broken reset nobody can use.
    const url = data.resetUrl && typeof data.resetUrl === 'object'
      ? str(data.resetUrl.url)
      : str(data.resetUrl);
    const minutes = Number.isFinite(Number(data.expiresMinutes)) ? Number(data.expiresMinutes) : 60;
    const rows = [
      ['Account', str(data.email)],
      ['Valid for', `${minutes} minutes`],
    ];
    return {
      subject: 'Reset your Broodiinnox password',
      text: plain([
        `Hello ${name},`,
        '',
        'Someone asked to reset the password for your Broodiinnox account. If that was you, open this link to choose a new one:',
        '',
        url,
        '',
        `This link can only be used once and expires in ${minutes} minutes.`,
        '',
        'If you did not ask for this, you can ignore this email — your password has not changed.',
      ]),
      html: layout({
        title: 'Reset your Broodiinnox password',
        intro: `Hello ${name}, someone asked to reset the password for your Broodiinnox account. If that was you, open this link to choose a new one.`,
        rows,
        action: url ? { url, label: 'Choose a new password' } : null,
        footerNote: `This link can only be used once and expires in ${minutes} minutes. If you did not ask for this, you can ignore this email — your password has not changed.`,
      }),
    };
  },

  /** The sign-in code. Short-lived, single-use, and never long enough to copy down. */
  login_code(data = {}) {
    const name = str(data.name, 'there');
    const code = str(data.code);
    const minutes = Number.isFinite(Number(data.expiresMinutes)) ? Number(data.expiresMinutes) : 10;
    const rows = [
      ['Account', str(data.email)],
      ['Code', code],
      ['Valid for', `${minutes} minutes`],
    ];
    return {
      subject: 'Your Broodiinnox sign-in code',
      text: plain([
        `Hello ${name},`,
        '',
        `Your Broodiinnox sign-in code is ${code}.`,
        '',
        `It works once and expires in ${minutes} minutes. Enter it on the sign-in screen to finish signing in.`,
        '',
        ...rowLines([['Account', str(data.email)]]),
        '',
        'If you did not try to sign in, someone has your password. Change it from the sign-in screen and tell Afriinnox.',
      ]),
      html: layout({
        title: 'Your sign-in code',
        intro: `Hello ${name}, enter this code on the sign-in screen to finish signing in.`,
        rows,
        footerNote: `It works once and expires in ${minutes} minutes. If you did not try to sign in, someone has your password — change it and tell Afriinnox.`,
      }),
    };
  },

  /** Money confirmed by the gateway: the days were added and the unit unlocked. */
  payment_received(data = {}) {
    const name = str(data.name, 'there');
    const amount = formatAmount(data.amount, data.currency);
    const rows = [
      ['Amount', amount],
      ['System', str(data.deviceId)],
      ['Plan', str(data.planId)],
      ['Days added', data.daysAdded === undefined || data.daysAdded === null ? '' : String(data.daysAdded)],
      ['Reference', str(data.reference)],
      ['Paid at', formatWhen(data.paidAt)],
      ['Phone', str(data.phone)],
    ];
    return {
      subject: `Payment received — ${amount}`,
      text: plain([
        `Hello ${name},`,
        '',
        'We received your Broodiinnox subscription payment and your system is active again. Thank you.',
        '',
        ...rowLines(rows),
        '',
        str(data.appUrl) ? `Open Broodiinnox: ${str(data.appUrl)}` : '',
      ]),
      html: layout({
        title: 'Payment received',
        intro: `Hello ${name}, we received your Broodiinnox subscription payment and your system is active again. Thank you.`,
        rows,
        action: str(data.appUrl) ? { url: str(data.appUrl), label: 'Open Broodiinnox' } : null,
        footerNote: `Keep this as your receipt. Reference ${str(data.reference) || 'n/a'}.`,
      }),
    };
  },

  /** The attempt did not go through. Explains why in the payer's terms. */
  payment_failed(data = {}) {
    const name = str(data.name, 'there');
    const amount = formatAmount(data.amount, data.currency);
    const rows = [
      ['Amount', amount],
      ['System', str(data.deviceId)],
      ['Reference', str(data.reference)],
      ['Reason', str(data.reason)],
    ];
    return {
      subject: 'Your Broodiinnox payment was not completed',
      text: plain([
        `Hello ${name},`,
        '',
        'Your Broodiinnox subscription payment was not completed, so your system is still locked.',
        '',
        ...rowLines(rows),
        '',
        'You can try again from the app. If the money left your Mobile Money account but the system did not unlock, contact Afriinnox with the reference above — do not pay twice.',
      ]),
      html: layout({
        title: 'Your payment was not completed',
        intro: 'Your Broodiinnox subscription payment was not completed, so your system is still locked.',
        rows,
        action: str(data.appUrl) ? { url: str(data.appUrl), label: 'Try again' } : null,
        footerNote: 'If the money left your Mobile Money account but the system did not unlock, contact Afriinnox with the reference above — do not pay twice.',
      }),
    };
  },

  /** A device condition that needs a person. `severity` drives the wording. */
  device_alert(data = {}) {
    const name = str(data.name, 'there');
    const severity = str(data.severity, 'warning').toLowerCase();
    const critical = severity === 'critical';
    const headline = critical ? 'Your system needs attention now' : 'Your system reported a condition';
    const rows = [
      ['System', str(data.deviceId)],
      ['Condition', str(data.kind)],
      ['Severity', severity],
      ['Detected', formatWhen(data.ts)],
      ['Average temperature', data.aveTemp === undefined || data.aveTemp === null ? '' : `${data.aveTemp}°C`],
    ];
    const detail = str(data.message);
    return {
      subject: `${critical ? 'Action needed' : 'Notice'}: ${str(data.deviceId, 'your system')} — ${str(data.kind, 'condition')}`,
      text: plain([
        `Hello ${name},`,
        '',
        detail || 'Your Broodiinnox system reported a condition that needs your attention.',
        '',
        ...rowLines(rows),
        '',
        str(data.appUrl) ? `Open Broodiinnox: ${str(data.appUrl)}` : '',
      ]),
      html: layout({
        title: headline,
        intro: detail || 'Your Broodiinnox system reported a condition that needs your attention.',
        rows,
        action: str(data.appUrl) ? { url: str(data.appUrl), label: 'Open Broodiinnox' } : null,
        footerNote: critical
          ? 'This is a critical condition: please check the birds and the unit as soon as you can.'
          : 'You are receiving this because device alerts are switched on for your account.',
      }),
    };
  },

  /** The paid period is nearly over. */
  subscription_expiring(data = {}) {
    const name = str(data.name, 'there');
    const daysLeft = Number(data.daysLeft);
    const left = Number.isFinite(daysLeft) ? daysLeft : null;
    const when = left === null ? 'soon' : (left <= 1 ? 'tomorrow' : `in ${left} days`);
    const rows = [
      ['System', str(data.deviceId)],
      ['Expires', formatWhen(data.endsAt)],
      ['Days left', left === null ? '' : String(left)],
      ['Plan', str(data.planId)],
    ];
    return {
      subject: `Your Broodiinnox subscription expires ${when}`,
      text: plain([
        `Hello ${name},`,
        '',
        `Your Broodiinnox subscription for ${str(data.deviceId, 'your system')} expires ${when}. Renew to keep the system running — it locks automatically when the paid days end.`,
        '',
        ...rowLines(rows),
        '',
        str(data.appUrl) ? `Renew: ${str(data.appUrl)}` : '',
      ]),
      html: layout({
        title: 'Your subscription is ending',
        intro: `Your Broodiinnox subscription for ${str(data.deviceId, 'your system')} expires ${when}. Renew to keep the system running — it locks automatically when the paid days end.`,
        rows,
        action: str(data.appUrl) ? { url: str(data.appUrl), label: 'Renew now' } : null,
        footerNote: 'You are receiving this because subscription reminders are switched on for your account.',
      }),
    };
  },
};

/** Every template name, for validation and for tests that sweep the set. */
export const EMAIL_TEMPLATE_NAMES = Object.keys(EMAIL_TEMPLATES);

/**
 * Render one email. Returns null for an unknown template so a caller can decide
 * whether that is an error rather than getting an empty message sent.
 */
export function renderEmail(template, data = {}) {
  const fn = EMAIL_TEMPLATES[template];
  if (typeof fn !== 'function') return null;
  const out = fn(data) || {};
  const subject = str(out.subject);
  if (!subject) return null;
  return {
    template,
    subject,
    text: typeof out.text === 'string' ? out.text : '',
    html: typeof out.html === 'string' ? out.html : '',
  };
}
