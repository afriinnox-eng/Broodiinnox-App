/**
 * The reset link, as a URL.
 *
 * This one is small and it earns its place: the link is the only way a locked
 * out person can set a password, and the app it points at is a single-page app
 * on a static host, so the route has to be in the fragment. The shape the API
 * used to build - `{app}/reset-password?token=...` - was sent, received and
 * clicked, and landed the person on the home screen with the token ignored.
 * Nothing threw. That is the kind of failure a test has to name out loud.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_PASSWORD_LENGTH, resetUrlFor, validateNewPassword } from '../lib/passwordReset.js';

test('the reset link points at the route the SPA actually serves', () => {
  const url = resetUrlFor('https://broodiinnox-app.onrender.com', 'abc123');
  assert.match(url, /#\/reset-password\?token=abc123$/, 'the token lives in the fragment');
  assert.equal(url, 'https://broodiinnox-app.onrender.com/#/reset-password?token=abc123');
});

test('every spelling of the app URL yields one link shape', () => {
  for (const base of ['https://app.example', 'https://app.example/', 'https://app.example///']) {
    assert.equal(resetUrlFor(base, 't'), 'https://app.example/#/reset-password?token=t', base);
  }
});

test('a token that would break the fragment is encoded, never pasted in', () => {
  for (const token of ['a b', 'a&b', 'a#b', 'a?b=c', 'a/b', 'ü', "q'\"<x>"]) {
    const url = resetUrlFor('https://app.example', token);
    const fragment = url.slice(url.indexOf('#') + 1);

    // one route, then exactly one parameter - and its name is `token`
    assert.equal(fragment.split('?').length, 2, `${token}: one query`);
    const params = new URLSearchParams(fragment.split('?')[1]);
    assert.deepEqual([...params.keys()], ['token'], `${token}: no parameter is invented`);
    assert.equal(params.getAll('token').length, 1, `${token}: token appears once`);
    assert.equal(params.get('token'), token, `${token} round-trips`);
  }
});

test('there is always a token parameter, even for nothing', () => {
  assert.equal(resetUrlFor('https://app.example', ''), 'https://app.example/#/reset-password?token=');
  assert.ok(resetUrlFor('', 't').startsWith('/#/reset-password'), 'no base URL still yields a usable path');
});

test('the password rule the link enforces is the one the server enforces', () => {
  assert.equal(validateNewPassword('x'.repeat(MIN_PASSWORD_LENGTH - 1)).ok, false);
  assert.equal(validateNewPassword('x'.repeat(MIN_PASSWORD_LENGTH)).ok, true);
  assert.equal(validateNewPassword('x'.repeat(201)).ok, false);
  // every non-string, including the shapes a JSON body can carry
  for (const bad of [undefined, null, 0, {}, [], true]) {
    assert.equal(validateNewPassword(bad).ok, false);
  }
  assert.equal(validateNewPassword(null).error.length > 0, true, 'a refusal says why');
});
