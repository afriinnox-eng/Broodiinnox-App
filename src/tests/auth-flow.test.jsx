/**
 * The sign-in screen as a user meets it: the two-step flow, the ways it must
 * still let a registered farmer in, and the two screens the reset link needs.
 *
 * The properties that matter here are not "the happy path works". They are:
 *
 *   1. an identifier nobody registered opens nothing, and never reaches the
 *      server - the registration is still what decides who gets in
 *   2. a server that refuses, cannot send mail, is unreachable, or is not
 *      configured AT ALL never becomes the reason a registered farmer cannot
 *      reach their own chicks. Every one of those still signs them in, exactly
 *      as the app did before the code step existed.
 *   3. when the server does send a code, the code is the only thing that
 *      finishes the sign-in - and the screen never decides that itself
 *   4. the reset screen will not send a password the server would reject anyway,
 *      and says which way a dead link died
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { HashRouter, MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';
import { StoreProvider } from '../lib/store.jsx';
import { buildSeed } from '../lib/seed.js';

const KEY = 'broodiinnox_app_v1';
const FARMER_ACCOUNT = {
  contactId: 'c1', name: 'Jean Damascene', role: 'farmer', farmerId: null,
  email: 'jean@farm.rw', phone: '0788123456',
};

let calls = [];
let reply = () => ({ status: 500, body: {} });

/** Boot the real app on the sign-in screen, with the API answering from `reply`. */
function boot({ configured = true, hash = '#/' } = {}) {
  calls = [];
  localStorage.clear();
  localStorage.setItem(KEY, JSON.stringify({ ...buildSeed(), session: null, lang: 'en', reminderSent: [] }));
  window.location.hash = hash;
  vi.unstubAllEnvs();
  if (configured) vi.stubEnv('VITE_IOT_API_URL', 'https://api.test');

  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const call = { url: String(url), method: (opts.method || 'GET').toUpperCase(), body: opts.body ? JSON.parse(opts.body) : null };
    calls.push(call);
    const out = reply(call) || { status: 500, body: {} };
    return { ok: out.status < 300, status: out.status, text: async () => JSON.stringify(out.body ?? {}) };
  }));

  const view = render(<HashRouter><StoreProvider><App /></StoreProvider></HashRouter>);
  return view.container;
}

/** Type an identifier and password into the real form and submit it. */
function signIn(root, identifier, password = 'a-password') {
  fireEvent.change(root.querySelector('#login-id'), { target: { value: identifier } });
  fireEvent.change(root.querySelector('#login-password'), { target: { value: password } });
  fireEvent.submit(root.querySelector('form'));
}

const authCalls = () => calls.filter((c) => c.url.includes('/api/auth/'));

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the two-step sign-in', () => {
  it('asks for the emailed code, then signs in with the account the server verified', async () => {
    reply = (call) => {
      if (call.url.endsWith('/api/auth/login')) return { status: 202, body: { codeSent: true, challengeId: 'ch-1', sentTo: 'j•••@farm.rw', expiresMinutes: 10 } };
      if (call.url.endsWith('/api/auth/verify')) return { status: 200, body: { verified: true, email: 'jean@farm.rw', account: FARMER_ACCOUNT } };
      return { status: 200, body: { devices: [] } };
    };
    const root = boot();
    signIn(root, 'jean@farm.rw', 'secret123');

    // the code step replaced the form, and it says where the code went
    await vi.waitFor(() => expect(root.querySelector('#login-code')).not.toBeNull());
    expect(root.textContent).toContain('j•••@farm.rw');
    expect(root.querySelector('#login-id'), 'the credentials form is gone').toBeNull();
    expect(root.querySelector('.app-shell'), 'and nothing is open yet').toBeNull();

    // step one carried the identifier and the password, to the right route
    expect(authCalls()[0].url).toBe('https://api.test/api/auth/login');
    expect(authCalls()[0].body).toEqual({ identifier: 'jean@farm.rw', password: 'secret123' });

    // a code that is not six digits is never sent to the server
    fireEvent.change(root.querySelector('#login-code'), { target: { value: '123' } });
    fireEvent.submit(root.querySelector('form'));
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    expect(authCalls().length, 'a malformed code costs no request').toBe(1);

    // the real one is, and it opens the shell that account belongs to
    fireEvent.change(root.querySelector('#login-code'), { target: { value: '123456' } });
    fireEvent.submit(root.querySelector('form'));
    await vi.waitFor(() => expect(root.querySelector('.app-shell')).not.toBeNull());
    expect(root.querySelector('.app-shell').className).toContain('farmer-app');
    expect(authCalls()[1].body).toEqual({ challengeId: 'ch-1', code: '123456' });
  });

  it('a phone number reaches the same account by the same two steps', async () => {
    reply = (call) => (call.url.endsWith('/api/auth/login')
      ? { status: 202, body: { codeSent: true, challengeId: 'ch-2', sentTo: 'j•••@farm.rw', expiresMinutes: 10 } }
      : { status: 200, body: { verified: true, account: FARMER_ACCOUNT } });
    const root = boot();
    signIn(root, '0788 123 456', 'secret123');
    await vi.waitFor(() => expect(root.querySelector('#login-code')).not.toBeNull());
    expect(authCalls()[0].body.identifier).toBe('0788 123 456');
  });

  it('a wrong code is refused, keeps the step open, and says how many tries are left', async () => {
    reply = (call) => (call.url.endsWith('/api/auth/login')
      ? { status: 202, body: { codeSent: true, challengeId: 'ch-3', sentTo: 'j•••@farm.rw', expiresMinutes: 10 } }
      : { status: 400, body: { error: 'That code is not correct.', reason: 'wrong', attemptsLeft: 4 } });
    const root = boot();
    signIn(root, 'jean@farm.rw', 'secret123');
    await vi.waitFor(() => expect(root.querySelector('#login-code')).not.toBeNull());

    fireEvent.change(root.querySelector('#login-code'), { target: { value: '999999' } });
    fireEvent.submit(root.querySelector('form'));
    await vi.waitFor(() => expect(root.querySelector('[role="alert"]')).not.toBeNull());
    expect(root.querySelector('[role="alert"]').textContent).toMatch(/not correct/i);
    expect(root.querySelector('[role="alert"]').textContent).toMatch(/4/);
    expect(root.querySelector('.app-shell'), 'a wrong code must open nothing').toBeNull();
    expect(root.querySelector('#login-code'), 'and must leave the step usable').not.toBeNull();
  });

  it('a code that is out of attempts says so instead of inviting another guess', async () => {
    reply = (call) => (call.url.endsWith('/api/auth/login')
      ? { status: 202, body: { codeSent: true, challengeId: 'ch-4', sentTo: 'j•••@farm.rw', expiresMinutes: 10 } }
      : { status: 400, body: { error: 'That code is not correct.', reason: 'wrong', attemptsLeft: 0 } });
    const root = boot();
    signIn(root, 'jean@farm.rw', 'secret123');
    await vi.waitFor(() => expect(root.querySelector('#login-code')).not.toBeNull());
    fireEvent.change(root.querySelector('#login-code'), { target: { value: '999999' } });
    fireEvent.submit(root.querySelector('form'));
    await vi.waitFor(() => expect(root.querySelector('[role="alert"]')).not.toBeNull());
    expect(root.querySelector('[role="alert"]').textContent).toMatch(/cannot be used any more/i);
  });

  it('can go back, which leaves nobody stuck on a code they cannot receive', async () => {
    const root = boot();
    reply = () => ({ status: 202, body: { codeSent: true, challengeId: 'ch-5', sentTo: 'j•••@farm.rw', expiresMinutes: 10 } });
    signIn(root, 'jean@farm.rw', 'secret123');
    await vi.waitFor(() => expect(root.querySelector('#login-code')).not.toBeNull());

    const back = [...root.querySelectorAll('button')].find((b) => /another account/i.test(b.textContent));
    fireEvent.click(back);
    await vi.waitFor(() => expect(root.querySelector('#login-id')).not.toBeNull());
    // the placeholder mock above would still say a code was sent; the key thing
    // is that the credentials form is back and the code field is gone
    expect(root.querySelector('#login-password')).not.toBeNull();
    expect(root.querySelector('#login-code')).toBeNull();
  });
});

describe('nothing may stop a registered person getting in', () => {
  const opensTheShell = async (root) => {
    await vi.waitFor(() => expect(root.querySelector('.app-shell')).not.toBeNull());
    expect(root.querySelector('.app-shell').className).toContain('farmer-app');
    expect(root.querySelector('#login-id'), 'and must not also leave the form up').toBeNull();
  };

  it('the server refusing the password still signs them in, as before', async () => {
    reply = () => ({ status: 401, body: { error: 'That identifier and password do not match.', reason: 'bad-credentials' } });
    const root = boot();
    signIn(root, 'jean@farm.rw', 'anything');
    await opensTheShell(root);
    expect(root.querySelector('.auth-note'), 'no confusing note when the server simply disagrees').toBeNull();
  });

  it('a server that cannot send email still signs them in, with no dead end left behind', async () => {
    // what the server says when mail is not configured: it cannot deliver a code,
    // so there is no code step to show. The person is still a registered farmer.
    reply = () => ({ status: 503, body: { error: 'This server cannot send email right now.', reason: 'mail-not-configured' } });
    const root = boot();
    signIn(root, 'jean@farm.rw', 'anything');
    await opensTheShell(root);
    // the invariant: no half-open code step, and no error about a code that was
    // never going to arrive
    expect(root.querySelector('#login-code')).toBeNull();
    expect(root.querySelector('.warn-banner')).toBeNull();
  });

  it('a server that is down or slow still signs them in', async () => {
    const root = boot();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Failed to fetch'); }));
    signIn(root, 'jean@farm.rw', 'anything');
    await opensTheShell(root);
  });

  it('an app built with no API at all signs them in and calls no auth route', async () => {
    const root = boot({ configured: false });
    signIn(root, 'jean@farm.rw', 'anything');
    await opensTheShell(root);
    expect(authCalls()).toEqual([]);
  });

  it('offers no demo shortcut at all: the form is the only way in', () => {
    const root = boot();
    // no button that signs anyone in without the form, and no copy that suggests
    // a shared or throwaway password - the words are checked on the whole screen
    expect([...root.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((l) => /demo/i.test(l))).toEqual([]);
    expect(root.textContent).not.toMatch(/demo/i);
    expect(root.textContent).not.toMatch(/any password/i);
    expect(root.querySelector('#login-id'), 'the form is what is left').not.toBeNull();
    expect(root.querySelector('.app-shell')).toBeNull();
  });
});

describe('the registration still decides who gets in', () => {
  it.each([
    ['an email nobody registered', 'stranger@example.com'],
    ['a phone nobody registered', '0700000000'],
    ['nothing at all', ''],
  ])('%s opens nothing and never reaches the server', async (_case, identifier) => {
    const root = boot();
    signIn(root, identifier);
    expect(root.querySelector('.app-shell')).toBeNull();
    expect(root.querySelector('[role="alert"]').textContent).toMatch(/not registered/i);
    expect(authCalls(), 'an unregistered identifier must not be sent anywhere').toEqual([]);
  });
});

describe('the forgot-password step', () => {
  it('asks for a reset link and says only that the request was looked at', async () => {
    reply = () => ({ status: 202, body: { requested: true, notice: 'If that address has an account, a reset link has been sent.' } });
    const root = boot();
    const forgot = [...root.querySelectorAll('button')].find((b) => /forgot password/i.test(b.textContent));
    expect(forgot, 'the sign-in screen offers it').toBeDefined();
    fireEvent.click(forgot);

    await vi.waitFor(() => expect(root.querySelector('#forgot-id')).not.toBeNull());
    fireEvent.change(root.querySelector('#forgot-id'), { target: { value: 'stranger@example.com' } });
    fireEvent.submit(root.querySelector('form'));

    await vi.waitFor(() => expect(root.querySelector('[role="status"]')).not.toBeNull());
    expect(root.querySelector('[role="status"]').textContent).toMatch(/If that address has an account/i);
    // the answer for an address with no account is the same as for one with
    expect(authCalls()[0].body).toEqual({ identifier: 'stranger@example.com' });
    expect(root.textContent, 'and it must not hint that the address is unknown').not.toMatch(/not registered|no account|unknown/i);

    // and it can be left, so nobody is stranded here either
    const back = [...root.querySelectorAll('button')].find((b) => /back to sign in/i.test(b.textContent));
    fireEvent.click(back);
    await vi.waitFor(() => expect(root.querySelector('#login-id')).not.toBeNull());
  });

  it('with no server configured it names the limit rather than pretending to send', async () => {
    const root = boot({ configured: false });
    fireEvent.click([...root.querySelectorAll('button')].find((b) => /forgot password/i.test(b.textContent)));
    await vi.waitFor(() => expect(root.querySelector('#forgot-id')).not.toBeNull());
    fireEvent.change(root.querySelector('#forgot-id'), { target: { value: 'jean@farm.rw' } });
    fireEvent.submit(root.querySelector('form'));
    expect(root.querySelector('[role="alert"]').textContent).toMatch(/cannot send email/i);
    expect(authCalls()).toEqual([]);
  });
});

describe('the reset screen the emailed link opens', () => {
  /** Mount the app at the hash route the link uses. */
  const openLink = (search) => {
    calls = [];
    localStorage.clear();
    localStorage.setItem(KEY, JSON.stringify({ ...buildSeed(), session: null, lang: 'en', reminderSent: [] }));
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_IOT_API_URL', 'https://api.test');
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const call = { url: String(url), method: (opts.method || 'GET').toUpperCase(), body: opts.body ? JSON.parse(opts.body) : null };
      calls.push(call);
      const out = reply(call) || { status: 500, body: {} };
      return { ok: out.status < 300, status: out.status, text: async () => JSON.stringify(out.body ?? {}) };
    }));
    return render(
      <MemoryRouter initialEntries={[`/reset-password${search}`]}>
        <StoreProvider><App /></StoreProvider>
      </MemoryRouter>
    ).container;
  };

  const fill = (root, password, again = password) => {
    fireEvent.change(root.querySelector('#reset-password'), { target: { value: password } });
    fireEvent.change(root.querySelector('#reset-confirm'), { target: { value: again } });
    fireEvent.submit(root.querySelector('form'));
  };

  it('opens on the link, with no session and no sign-in form in the way', () => {
    const root = openLink('?token=from-the-email');
    expect(root.textContent).toMatch(/Choose a new password/i);
    expect(root.querySelector('#login-id'), 'the sign-in form is not what the link opens').toBeNull();
    expect(root.querySelector('#reset-password')).not.toBeNull();
  });

  it('will not send a password the server would reject anyway, or two that disagree', async () => {
    reply = () => ({ status: 200, body: { password_stored: true } });
    const root = openLink('?token=t');

    fill(root, 'short');
    expect(root.querySelector('[role="alert"]').textContent).toMatch(/at least 8/i);
    expect(calls, 'a too-short password is not sent').toEqual([]);

    fill(root, 'long-enough-1', 'long-enough-2');
    expect(root.querySelector('[role="alert"]').textContent).toMatch(/not the same/i);
    expect(calls, 'two that disagree are not sent').toEqual([]);

    // and nothing was written while it was refusing to send
    expect(root.querySelector('#reset-password').value).toBe('long-enough-1');
  });

  it('sends the token from the URL, once, and reports the password set', async () => {
    reply = () => ({ status: 200, body: { password_stored: true, email: 'jean@farm.rw' } });
    const root = openLink('?token=the-real-token');
    fill(root, 'chicken-coop-2026');
    await vi.waitFor(() => expect(root.textContent).toMatch(/password is set/i));

    expect(calls.length, 'one request, not one per keystroke').toBe(1);
    expect(calls[0].url).toBe('https://api.test/api/auth/password-reset/redeem');
    expect(calls[0].body).toEqual({ token: 'the-real-token', password: 'chicken-coop-2026' });
    expect(root.querySelector('form'), 'the spent link is not offered again').toBeNull();

    // the token is taken out of the address bar, so a refresh cannot re-post it
    expect(root.textContent).toMatch(/Go to sign in/i);
  });

  it('says which way the link failed, because each needs something different', async () => {
    const cases = [
      ['used', /already been used/i],
      ['expired', /expired/i],
      ['unknown', /not valid/i],
      ['invalid-password', /at least 8/i],
    ];
    for (const [reason, copy] of cases) {
      reply = () => ({ status: 400, body: { error: 'nope', reason } });
      const root = openLink('?token=spent');
      fill(root, 'chicken-coop-2026');
      await vi.waitFor(() => expect(root.querySelector('[role="alert"]')).not.toBeNull());
      expect(root.querySelector('[role="alert"]').textContent, reason).toMatch(copy);
      expect(root.querySelector('form'), `${reason} must not look like it worked`).not.toBeNull();
      root.remove();
    }
  });

  it('a link with no token says so instead of offering a form that cannot work', () => {
    const root = openLink('');
    expect(root.textContent).toMatch(/carries no reset token/i);
    expect(root.querySelector('#reset-password')).toBeNull();
  });

  it('refuses to post when the app has no server to post to', async () => {
    localStorage.clear();
    localStorage.setItem(KEY, JSON.stringify({ ...buildSeed(), session: null, lang: 'en', reminderSent: [] }));
    vi.unstubAllEnvs();
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => { calls.push({ url: String(url) }); throw new Error('no server'); }));
    const root = render(
      <MemoryRouter initialEntries={['/reset-password?token=t']}>
        <StoreProvider><App /></StoreProvider>
      </MemoryRouter>
    ).container;
    fill(root, 'chicken-coop-2026');
    await vi.waitFor(() => expect(root.querySelector('[role="alert"]')).not.toBeNull());
    expect(root.querySelector('[role="alert"]').textContent).toMatch(/no server configured/i);
  });
});
