/**
 * The phone shortcut to the sign-in form.
 *
 * This screen IS the sign-in screen, and on a phone it stacks: the mark, the
 * product name, the plate with its promises and languages, and only then the
 * form. So the one thing a returning farmer came here to press was the one thing
 * below the fold. There is now a "Sign in" button in the top right corner, beside
 * the mark, that takes them to that form.
 *
 * The properties that have to hold, for every case rather than the one screenshot:
 *
 *   1. IT IS ONLY WHERE IT IS NEEDED - hidden unless the stylesheet has collapsed
 *      the screen to one column, which is the same condition that puts the form
 *      below the fold. It may never be visible while the form is beside the brand.
 *   2. IT IS NOT A SECOND WAY IN - it sits outside the form, it submits nothing, it
 *      posts nothing. It is a way to the form, and only the form signs anyone in.
 *   3. IT LANDS ON THE FIRST FIELD OF WHATEVER STEP IS SHOWING - the credentials,
 *      the emailed code, or the forgot-password step - and it scrolls the pane
 *      that holds it, so the person arrives where the cursor already is.
 *   4. IT STAYS WITH THE MARK, ABOVE THE PLATE - so it can never be positioned
 *      over the words the frame is drawn around.
 *   5. ITS NAME CONTAINS ITS LABEL - the accessible name says what the button does,
 *      and still contains the words the person can see (WCAG 2.5.3).
 */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import App from '../App.jsx';
import { StoreProvider } from '../lib/store.jsx';
import { buildDemoSeed } from './fixtures/demoFleet.js';
import { t } from '../i18n/strings.js';

const KEY = 'broodiinnox_app_v1';

/** The assembled screen, signed out - the home screen a phone lands on. */
function renderHome() {
  localStorage.clear();
  localStorage.setItem(KEY, JSON.stringify({ ...buildDemoSeed(), session: null, lang: 'en', reminderSent: [] }));
  window.location.hash = '#/';
  return render(<HashRouter><StoreProvider><App /></StoreProvider></HashRouter>);
}

const css = () => fs.readFileSync(path.resolve(process.cwd(), 'src', 'styles', 'global.css'), 'utf8');

/** The declarations of one rule by its exact selector, media overrides stripped. */
function rule(selector) {
  const base = css().replace(/@media[^{]*\{[\s\S]*?\n\}/g, '');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(base);
  return m ? m[1] : '';
}

/** Every max-width media block, with the width it fires at. */
function breakpoints() {
  return [...css().matchAll(/@media\s*\(max-width:\s*(\d+)px\)\s*\{([\s\S]*?)\n\}/g)]
    .map((m) => ({ width: Number(m[1]), body: m[2] }));
}

/** jsdom has no scrollIntoView, so it is injected as a spy and removed again. */
function spyOnScroll() {
  const scrolled = [];
  Element.prototype.scrollIntoView = vi.fn(function scrollIntoView() { scrolled.push(this); });
  return scrolled;
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  delete Element.prototype.scrollIntoView;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* 1. where it is allowed to be visible                                */
/* ------------------------------------------------------------------ */

describe('INVARIANT: the shortcut appears exactly where the form stops being beside it', () => {
  it('is hidden by default, so it can never sit next to a visible form', () => {
    expect(rule('.login-quick'), 'the rule exists').not.toBe('');
    expect(rule('.login-quick')).toMatch(/display:\s*none/);
  });

  it('is revealed by one breakpoint, and that breakpoint also stacks the screen', () => {
    const revealing = breakpoints().filter((b) => /\.login-quick\s*\{[^}]*display:/.test(b.body));
    expect(revealing.length, 'exactly one breakpoint reveals it').toBe(1);
    expect(revealing[0].body, 'and it is the one that collapses the layout to a single column')
      .toMatch(/\.login-shell\s*\{[^}]*grid-template-columns:\s*1fr/);
    expect(revealing[0].body).toMatch(/\.login-quick\s*\{[^}]*display:\s*inline-flex/);
    expect(revealing[0].width, 'at a phone-shaped width').toBeLessThanOrEqual(900);
  });

  it('is the same width or wider than the phone width, never a narrower one the layout never reaches', () => {
    // the reveal has to fire no later than the layout change, or a tablet-shaped
    // screen would stack with no shortcut on it
    const stacking = breakpoints().filter((b) => /\.login-shell\s*\{[^}]*grid-template-columns:\s*1fr/.test(b.body));
    expect(stacking.length, 'the one-column layout is declared once').toBe(1);
    const revealing = breakpoints().filter((b) => /\.login-quick\s*\{[^}]*display:/.test(b.body));
    expect(revealing[0].width).toBe(stacking[0].width);
  });
});

/* ------------------------------------------------------------------ */
/* 2. where it sits on the screen                                      */
/* ------------------------------------------------------------------ */

describe('INVARIANT: it belongs to the mark, above the framed words', () => {
  it('sits in the brand row, before the plate, and outside the form', () => {
    const { container } = renderHome();
    const row = container.querySelector('.login-brand-row');
    const quick = container.querySelector('.login-quick');
    expect(row, 'the brand row carries its layout class').not.toBeNull();
    expect(quick, 'the shortcut mounted').not.toBeNull();
    expect(quick.parentElement, 'it is in the brand row, beside the mark').toBe(row);

    const plate = container.querySelector('.login-plate');
    expect(plate.contains(quick), 'never inside the frame that circles the words').toBe(false);
    expect(quick.compareDocumentPosition(plate) & Node.DOCUMENT_POSITION_FOLLOWING, 'and above it').toBeTruthy();
    expect(quick.closest('form'), 'and never inside the form it points at').toBeNull();
  });

  it('names the action in words a screen reader hears, over the words a person sees', () => {
    const { container } = renderHome();
    const quick = container.querySelector('.login-quick');
    expect(quick.textContent.trim()).toBe(t('login.signIn', 'en'));
    expect(quick.getAttribute('aria-label')).toBe(t('login.quickSignIn', 'en'));
    for (const lang of ['en', 'fr', 'rw']) {
      expect(t('login.quickSignIn', lang), lang).toContain(t('login.signIn', lang));
    }
    // nothing decorative was lost: the mark inside it is hidden from assistive tech
    expect(quick.querySelector('svg[aria-hidden="true"]'), 'it carries its icon').not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 3. what clicking it does                                            */
/* ------------------------------------------------------------------ */

describe('BEHAVIOURAL: it takes the person to the form', () => {
  it('scrolls the pane holding the form into view and leaves the cursor in its first field', () => {
    const scrolled = spyOnScroll();
    const { container } = renderHome();
    fireEvent.click(container.querySelector('.login-quick'));

    const pane = container.querySelector('.login-form-pane');
    expect(scrolled, 'the pane that holds the form is the one scrolled to').toContain(pane);
    expect(document.activeElement?.id, 'and the cursor is in the identifier field').toBe('login-id');
  });

  it('does the same on every step of the flow, not only the first', async () => {
    vi.stubEnv('VITE_IOT_API_URL', 'https://api.test');
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const body = String(url).endsWith('/api/auth/login')
        ? { codeSent: true, challengeId: 'ch-1', sentTo: 'j•••@farm.rw', expiresMinutes: 10 }
        : { devices: [] };
      return { ok: true, status: String(url).endsWith('/api/auth/login') ? 202 : 200, text: async () => JSON.stringify(body) };
    }));
    const { container } = renderHome();

    // step two: the emailed code
    fireEvent.change(container.querySelector('#login-id'), { target: { value: 'jean@farm.rw' } });
    fireEvent.change(container.querySelector('#login-password'), { target: { value: 'a-password' } });
    fireEvent.submit(container.querySelector('form'));
    await vi.waitFor(() => expect(container.querySelector('#login-code')).not.toBeNull());
    fireEvent.click(container.querySelector('.login-quick'));
    expect(document.activeElement?.id, 'the code step is where it lands').toBe('login-code');

    // and the forgot-password step
    fireEvent.click([...container.querySelectorAll('button')].find((b) => /another account/i.test(b.textContent)));
    await vi.waitFor(() => expect(container.querySelector('#login-id')).not.toBeNull());
    fireEvent.click([...container.querySelectorAll('button')].find((b) => /forgot password/i.test(b.textContent)));
    await vi.waitFor(() => expect(container.querySelector('#forgot-id')).not.toBeNull());
    fireEvent.click(container.querySelector('.login-quick'));
    expect(document.activeElement?.id, 'and so is the forgot step').toBe('forgot-id');
  });

  it('signs nobody in and posts nothing: it is a way there, not a second way in', () => {
    vi.stubEnv('VITE_IOT_API_URL', 'https://api.test');
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ devices: [] }) }));
    vi.stubGlobal('fetch', fetchSpy);
    const { container } = renderHome();

    fireEvent.click(container.querySelector('.login-quick'));

    expect(container.querySelector('.app-shell'), 'no shell may open').toBeNull();
    expect(container.querySelector('[role="alert"]'), 'and no error may appear').toBeNull();
    expect(container.querySelector('#login-id'), 'the form is still what is on offer').not.toBeNull();
    const auth = fetchSpy.mock.calls.filter(([url]) => String(url).includes('/api/auth/'));
    expect(auth, 'nothing was sent to any auth route').toEqual([]);
    expect(container.querySelector('#login-password').value, 'and nothing was filled in for them').toBe('');
  });
});

/* ------------------------------------------------------------------ */
/* 4. the assembled screen, end to end                                 */
/* ------------------------------------------------------------------ */

describe('FUNCTIONAL: the assembled home screen a phone loads', () => {
  it('offers the shortcut, and following it signs a registered farmer in', async () => {
    const { container } = renderHome();
    const quick = container.querySelector('.login-quick');
    expect(quick, 'the shortcut is on the assembled screen').not.toBeNull();

    // a farmer taps the shortcut, then types where it took them
    fireEvent.click(quick);
    fireEvent.change(container.querySelector('#login-id'), { target: { value: '0788 123 456' } });
    fireEvent.change(container.querySelector('#login-password'), { target: { value: 'anything' } });
    fireEvent.submit(container.querySelector('form'));

    await vi.waitFor(() => expect(container.querySelector('.app-shell')).not.toBeNull());
    expect(container.querySelector('.app-shell').className).toContain('farmer-app');
    expect(container.querySelector('.login-quick'), 'and the home screen is gone').toBeNull();

    console.log('[shortcut] picked from the brand row, and the sign-in it led to opened the farmer shell');
  });
});
