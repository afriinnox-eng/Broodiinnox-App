/**
 * FUNCTIONAL: the emailed reset link, opened on the entry point a browser loads.
 *
 * `src/main.jsx` is imported — the file index.html actually loads — so the real
 * HashRouter, StoreProvider, ErrorBoundary, stylesheet and mount all run, and the
 * assertions are on what landed in the DOM. That is the level that catches what
 * unit tests cannot: a route the router never registered, a screen that only
 * renders when a session exists, a hash URL that the app reads with the wrong
 * parser.
 *
 * This one exists because of a specific failure it would have caught: the API
 * used to email `{app}/reset-password?token=...` — a path, not a fragment — and
 * on a static host that serves index.html for every path, the hash router
 * stayed on the home screen and the token was silently ignored. The link was
 * sent, arrived, and did nothing. So: the real URL shape, from the boot up.
 *
 * One boot per file on purpose: main.jsx creates its own React root which keeps
 * its effects alive, so a second boot in the same file renders against state the
 * first root is still writing back to.
 */
import { expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';

const KEY = 'broodiinnox_app_v1';
const TOKEN = 'the-token-from-the-email';

it('the hash-routed reset link opens the reset screen, sets a password, and lands on sign-in', async () => {
  const calls = [];
  localStorage.clear();
  window.location.hash = `#/reset-password?token=${TOKEN}`;
  document.body.innerHTML = '<div id="root"></div>';

  vi.stubEnv('VITE_IOT_API_URL', 'https://api.test');
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    calls.push({ url: String(url), method: (opts.method || 'GET').toUpperCase(), body: opts.body ? JSON.parse(opts.body) : null });
    const out = String(url).endsWith('/api/auth/password-reset/redeem')
      ? { status: 200, body: { password_stored: true, email: 'jean@farm.rw' } }
      : { status: 200, body: { devices: [] } };
    return { ok: out.status < 300, status: out.status, text: async () => JSON.stringify(out.body) };
  }));

  await import('../main.jsx');
  const root = document.getElementById('root');
  await vi.waitFor(() => expect(root.textContent.trim().length).toBeGreaterThan(0));

  // 1. the route exists in the assembled app: the token in the fragment was read,
  //    the reset form is on the screen, and the sign-in form is not
  await vi.waitFor(() => expect(root.textContent).toMatch(/Choose a new password/i));
  expect(root.querySelector('#reset-password'), 'the new-password field mounted').not.toBeNull();
  expect(root.querySelector('#reset-confirm')).not.toBeNull();
  expect(root.querySelector('#login-id'), 'the link does not open the sign-in screen').toBeNull();
  expect(root.textContent).toContain('BROODIINNOX');

  const submit = [...root.querySelectorAll('button')].find((b) => /Save the new password/i.test(b.textContent));
  expect(submit, 'the form offers to save it').toBeDefined();

  // 2. what a person does with it
  fireEvent.change(root.querySelector('#reset-password'), { target: { value: 'chicken-coop-2026' } });
  fireEvent.change(root.querySelector('#reset-confirm'), { target: { value: 'chicken-coop-2026' } });
  fireEvent.submit(root.querySelector('form'));

  await vi.waitFor(() => expect(root.textContent).toMatch(/password is set/i));

  // 3. and what actually left the app: the token from the URL, not from anywhere else
  const post = calls.filter((c) => c.method === 'POST');
  expect(post).toHaveLength(1);
  expect(post[0].url).toBe('https://api.test/api/auth/password-reset/redeem');
  expect(post[0].body).toEqual({ token: TOKEN, password: 'chicken-coop-2026' });

  // 4. the last step of the loop: the way back to signing in really arrives there
  const go = [...root.querySelectorAll('button')].find((b) => /Go to sign in/i.test(b.textContent));
  expect(go).toBeDefined();
  fireEvent.click(go);
  await vi.waitFor(() => expect(root.querySelector('#login-id')).not.toBeNull());
  expect(root.querySelector('#login-password')).not.toBeNull();
  expect(root.textContent).toMatch(/Welcome back/i);

  console.log('[assembled] POST', post[0].url, JSON.stringify(post[0].body));
  console.log('[assembled] the reset screen and the sign-in screen both mounted on the real entry point');
}, 20000);
