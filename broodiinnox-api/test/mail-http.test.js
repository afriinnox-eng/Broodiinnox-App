/**
 * Mail over HTTPS.
 *
 * This file exists because of one specific failure: the mailbox was configured,
 * the credentials were right, every credential check passed — and every send
 * timed out, because the host dropped outbound traffic to ports 25, 465 and 587
 * and there was nothing in the code that could say so. The fix is a second way
 * out (a provider's REST API on 443), and these tests are what makes it real:
 * they pin which route is chosen, exactly what each provider is asked for, and
 * that a refusal or a dead network comes back as a result rather than an
 * exception on the way to somebody's password reset.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMailer,
  describeMailConfig,
  providerMailError,
  resolveMailConfig,
} from '../lib/mail.js';
import { sendTemplate } from '../lib/notify.js';

const KEY = 're_test_key_that_is_not_a_real_one';
const FROM = 'Broodiinnox <no-reply@afriinnox.com>';
const RESEND = { MAIL_HTTP_API_KEY: KEY, MAIL_FROM: FROM };

/** A fetch that answers once and remembers what it was asked. No network. */
function fetchRecorder({ status = 200, body = { id: 'msg_1' }, throws = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    if (throws) throw new Error(throws);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { calls, fetchImpl };
}

/* ------------------------------------------------------------ which way out */

test('a provider key alone chooses the HTTPS route, with no other variable set', () => {
  const config = resolveMailConfig(RESEND);
  assert.equal(config.enabled, true);
  assert.equal(config.transport, 'http');
  assert.equal(config.http.provider, 'resend', 'the provider is inferred from the key');
  assert.equal(config.http.endpoint, 'https://api.resend.com/emails');
  assert.deepEqual(config.missing, [], 'nothing is reported missing');
});

test('the provider is inferred from whichever key is present', () => {
  const brevo = resolveMailConfig({ BREVO_API_KEY: 'xkeysib-not-real' });
  assert.equal(brevo.transport, 'http');
  assert.equal(brevo.http.provider, 'brevo');
  assert.equal(brevo.http.endpoint, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(resolveMailConfig({ RESEND_API_KEY: KEY }).http.provider, 'resend');
});

test('MAIL_HTTP_PROVIDER wins over inference, and the generic key works with it', () => {
  const config = resolveMailConfig({ MAIL_HTTP_PROVIDER: 'brevo', MAIL_HTTP_API_KEY: KEY });
  assert.equal(config.http.provider, 'brevo');
  assert.equal(config.http.endpoint, 'https://api.brevo.com/v3/smtp/email');
});

test('HTTPS is preferred when both routes are configured', () => {
  // The host may block SMTP, so a key that is present must actually be used.
  const config = resolveMailConfig({ ...RESEND, SMTP_USER: 'info@afriinnox.com', SMTP_PASSWORD: 'x' });
  assert.equal(config.transport, 'http');
});

test('a server with nothing configured names the variables that would fix it', () => {
  const config = resolveMailConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.transport, null);
  assert.deepEqual(config.missing, ['MAIL_HTTP_API_KEY', 'SMTP_USER', 'SMTP_PASSWORD']);
});

test('a provider chosen without a key asks for that provider key by name', () => {
  const config = resolveMailConfig({ MAIL_HTTP_PROVIDER: 'brevo', SMTP_USER: 'a@b.rw', SMTP_PASSWORD: 'p' });
  assert.equal(config.transport, 'smtp', 'the mailbox still works as a fallback');
  assert.deepEqual(resolveMailConfig({ MAIL_HTTP_PROVIDER: 'brevo' }).missing, ['BREVO_API_KEY', 'SMTP_USER', 'SMTP_PASSWORD']);
});

test('a provider nobody supports is invalid, not silently ignored', () => {
  const config = resolveMailConfig({ MAIL_HTTP_PROVIDER: 'sendmail', MAIL_HTTP_API_KEY: KEY });
  assert.deepEqual(config.invalid, ['MAIL_HTTP_PROVIDER']);
  assert.equal(config.enabled, false, 'a misconfigured server does not pretend to send');
});

test('the safe description carries the provider but never the key', () => {
  const safe = describeMailConfig(resolveMailConfig(RESEND));
  assert.equal(safe.transport, 'http');
  assert.equal(safe.http_provider, 'resend');
  assert.equal(safe.http_key_set, true);
  assert.ok(!JSON.stringify(safe).includes(KEY), 'the key is not in the payload the health route returns');
});

/* --------------------------------------------------- what the provider sees */

test('resend: one POST, the key in the header, the message as Resend wants it', async () => {
  const { calls, fetchImpl } = fetchRecorder();
  const mailer = createMailer(resolveMailConfig(RESEND), { fetchImpl });

  const out = await mailer.send({
    to: 'afriinnox@gmail.com',
    subject: 'Reset your Broodiinnox password',
    text: 'plain body',
    html: '<p>rich body</p>',
  });

  assert.equal(calls.length, 1, 'exactly one request');
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${KEY}`);
  assert.deepEqual(calls[0].body, {
    from: FROM,
    to: ['afriinnox@gmail.com'],
    subject: 'Reset your Broodiinnox password',
    text: 'plain body',
    html: '<p>rich body</p>',
    reply_to: 'no-reply@afriinnox.com',
  });
  assert.equal(out.ok, true);
  assert.equal(out.id, 'msg_1');
  assert.deepEqual(out.recipients, ['afriinnox@gmail.com']);
});

test('brevo: the same message in Brevo\'s shape', async () => {
  const { calls, fetchImpl } = fetchRecorder({ body: { messageId: 'brevo-7' } });
  const config = resolveMailConfig({ MAIL_HTTP_PROVIDER: 'brevo', MAIL_HTTP_API_KEY: KEY, MAIL_FROM: FROM });
  const out = await createMailer(config, { fetchImpl }).send({ to: ['a@b.rw'], subject: 's', text: 't' });

  assert.equal(calls[0].url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(calls[0].options.headers['api-key'], KEY);
  assert.deepEqual(calls[0].body.sender, { email: 'no-reply@afriinnox.com', name: 'Broodiinnox' });
  assert.deepEqual(calls[0].body.to, [{ email: 'a@b.rw' }]);
  assert.equal(calls[0].body.textContent, 't');
  assert.equal(out.id, 'brevo-7');
});

test('several recipients are one request, not one each', async () => {
  const { calls, fetchImpl } = fetchRecorder();
  await createMailer(resolveMailConfig(RESEND), { fetchImpl })
    .send({ to: 'one@farm.rw, two@farm.rw', subject: 's', text: 't' });
  assert.deepEqual(calls[0].body.to, ['one@farm.rw', 'two@farm.rw']);
});

test('an unusable recipient is dropped before the provider is bothered', async () => {
  const { calls, fetchImpl } = fetchRecorder();
  const out = await createMailer(resolveMailConfig(RESEND), { fetchImpl })
    .send({ to: 'not-an-address', subject: 's', text: 't' });
  assert.equal(out.skipped, true);
  assert.equal(calls.length, 0);
});

/* ------------------------------------------------------------- when it fails */

test('a refusal is the provider\'s own words, and never the key', async () => {
  const { fetchImpl } = fetchRecorder({
    status: 403,
    body: { statusCode: 403, name: 'validation_error', message: 'The afriinnox.com domain is not verified.' },
  });
  const out = await createMailer(resolveMailConfig(RESEND), { fetchImpl })
    .send({ to: 'a@b.rw', subject: 's', text: 't' });

  assert.equal(out.ok, false);
  assert.match(out.error, /HTTP 403/);
  assert.match(out.error, /domain is not verified/, 'the reason reaches email_log');
  assert.ok(!out.error.includes(KEY), 'a failed send never leaks the credential');
});

test('a dead network is a result, not an exception', async () => {
  const { fetchImpl } = fetchRecorder({ throws: 'fetch failed' });
  const out = await createMailer(resolveMailConfig(RESEND), { fetchImpl })
    .send({ to: 'a@b.rw', subject: 's', text: 't' });
  assert.equal(out.ok, false);
  assert.match(out.error, /fetch failed/);
});

test('the HTTPS route never opens an SMTP socket, even with a mailbox configured', async () => {
  const { fetchImpl } = fetchRecorder();
  let touched = false;
  const transport = { sendMail: async () => { touched = true; return { messageId: 'smtp' }; } };

  const config = resolveMailConfig({ ...RESEND, SMTP_USER: 'info@afriinnox.com', SMTP_PASSWORD: 'x' });
  const out = await createMailer(config, { transport, fetchImpl }).send({ to: 'a@b.rw', subject: 's', text: 't' });

  assert.equal(touched, false, 'the blocked port is not even attempted');
  assert.equal(out.id, 'msg_1');
});

test('providerMailError tolerates a body it did not expect', () => {
  assert.equal(providerMailError(500, null), 'HTTP 500: the provider refused the request');
  assert.match(providerMailError(401, { error: 'invalid api key' }), /invalid api key/);
  assert.ok(providerMailError(400, { message: 'x'.repeat(900) }).length <= 300);
});

test('verify asks the provider a read-only question with the key', async () => {
  const { calls, fetchImpl } = fetchRecorder({ body: { data: [] } });
  const out = await createMailer(resolveMailConfig(RESEND), { fetchImpl }).verify();
  assert.equal(calls[0].url, 'https://api.resend.com/domains');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(out.ok, true);
  assert.equal(out.provider, 'resend');

  const refused = fetchRecorder({ status: 401, body: { message: 'API key is invalid' } });
  const bad = await createMailer(resolveMailConfig(RESEND), { fetchImpl: refused.fetchImpl }).verify();
  assert.equal(bad.ok, false);
  assert.match(bad.error, /API key is invalid/);
});

/* ----------------------------------------------------- and the whole errand */

test('a password reset leaves over HTTPS with the link inside it', async () => {
  const { calls, fetchImpl } = fetchRecorder({ body: { id: 'msg_reset' } });
  const mailer = createMailer(resolveMailConfig(RESEND), { fetchImpl });

  const logged = [];
  const store = { logEmail: async (row) => { logged.push(row); return row; } };
  const url = 'https://broodiinnox-app.onrender.com/#/reset-password?token=abc123';

  const out = await sendTemplate({
    store,
    mailer,
    to: [{ email: 'afriinnox@gmail.com', name: 'Afriinnox' }],
    template: 'password_reset',
    data: { name: 'Afriinnox', email: 'afriinnox@gmail.com', resetUrl: url, expiresMinutes: 60 },
    event: 'password.reset.requested',
  });

  assert.equal(out.configured, true, 'the notification layer sees a configured mailer');
  assert.equal(out.sent, 1);
  assert.equal(calls[0].body.subject, 'Reset your Broodiinnox password');
  assert.deepEqual(calls[0].body.to, ['afriinnox@gmail.com']);
  assert.ok(calls[0].body.html.includes(url), 'the link is in the HTML');
  assert.ok(calls[0].body.text.includes(url), 'and in the plain text');
  assert.equal(logged[0].status, 'sent');
  assert.equal(logged[0].template, 'password_reset');
  assert.equal(logged[0].provider_id, 'msg_reset');
});
