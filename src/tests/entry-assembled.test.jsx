/**
 * FUNCTIONAL: the assembled program, booted from the real entry point.
 *
 * Every other test in this repo renders <App /> itself. This one imports
 * src/main.jsx — the file index.html actually loads — so the real HashRouter,
 * StoreProvider, ErrorBoundary, stylesheet and mount all run, and the
 * assertions are made on what landed in the DOM. That is the level that catches
 * "the component was never mounted" or "the route never registered", which unit
 * tests cannot.
 *
 * The home screen (no session) must show the product wording beside the icon —
 * BROODIINNOX / by AFRIINNOX Ltd — none of the wording it replaced, and the plate
 * that sits below them: four rails of the brand mark around everything after it.
 *
 * It then does what a user does next — signs in — and asserts the sidebar they land
 * in carries the same brand wording, which no signed-out boot can show.
 *
 * One boot per file on purpose: main.jsx creates its own React root and keeps
 * its effects alive, so a second boot in the same file would render against a
 * state the previous root is still writing back to localStorage.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';

describe('the entry point a browser loads', () => {
  it('mounts the home screen, then signs in and shows the sidebar brand', async () => {
    localStorage.clear();
    document.body.innerHTML = '<div id="root"></div>';
    await import('../main.jsx');

    const root = document.getElementById('root');
    await vi.waitFor(() => expect(root.textContent.trim().length).toBeGreaterThan(0));

    const text = root.textContent;
    expect(text).toContain('BROODIINNOX');
    expect(text).toContain('by AFRIINNOX Ltd');
    expect(text).not.toContain('Broodiinnox Smart Brooding');
    expect(text).toContain('Welcome back');                          // the login form mounted
    expect(root.querySelector('.login-brand img')).not.toBeNull();   // the icon mounted

    // the plate that frames the home screen mounted with it: four rails of the mark
    // around the words, at the counts the component draws (9 + 9 across, 5 + 5 down)
    const plate = root.querySelector('.login-plate');
    expect(plate).not.toBeNull();
    expect(plate.querySelectorAll('.login-plate-rail')).toHaveLength(4);
    expect(plate.querySelectorAll('.login-plate-mark img')).toHaveLength(28);
    expect(plate.querySelector('.login-brand')).toBeNull();          // the mark sits above the frame
    expect(plate.textContent).not.toContain('BROODIINNOX');          // and so does the product name
    expect(plate.querySelector('h1')).not.toBeNull();                 // the headline is inside it

    // and the plate really starts below them: the brand block comes first in the document
    const brandRow = root.querySelector('.login-brand').parentElement;
    expect(plate.contains(brandRow)).toBe(false);
    expect(brandRow.compareDocumentPosition(plate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // the composition inside it mounted too: three promise tiles on one grid, then the
    // language strip. The frame can be right while the inside of it never rendered.
    expect(plate.querySelectorAll('.login-promise')).toHaveLength(3);
    expect([...plate.querySelectorAll('.login-promise-label')].map((el) => el.textContent))
      .toEqual(['Monitor & control anywhere, anytime!', 'Every batch on record, for years', 'Professional brooding tips']);
    expect(plate.querySelectorAll('.login-lang')).toHaveLength(3);
    expect(plate.querySelector('.login-lang.on').textContent).toBe('English');

    // and the ribbon stayed decoration: hidden from assistive tech, carrying no words
    plate.querySelectorAll('.login-plate-rail').forEach((rail) => {
      expect(rail.getAttribute('aria-hidden')).toBe('true');
      expect(rail.textContent).toBe('');
    });

    // the phone shortcut to the form is on the screen index.html loads, it is not
    // part of the form it points at, and it really puts the cursor where a person
    // signs in - the form itself is below the fold on a stacked screen
    const quick = root.querySelector('.login-quick');
    expect(quick, 'the shortcut to the sign-in form mounted').not.toBeNull();
    expect(quick.closest('form'), 'it is not a second submit button').toBeNull();
    fireEvent.click(quick);
    expect(document.activeElement?.id, 'and it lands in the identifier field').toBe('login-id');

    // then the next thing a user does: sign in. The sidebar only exists once they
    // have, so this is the only level that can prove what it says.
    // there is no demo shortcut left to press: the way in is the form, with the
    // identifier this account was registered with
    fireEvent.change(root.querySelector('#login-id'), { target: { value: '0788123456' } });
    fireEvent.change(root.querySelector('#login-password'), { target: { value: 'a-password' } });
    fireEvent.submit(root.querySelector('form'));

    await vi.waitFor(() => expect(root.querySelector('.sidebar .brand-name')).not.toBeNull());
    expect(root.querySelector('.sidebar .brand-name').textContent.trim()).toBe('BROODIINNOX');
    expect(root.querySelector('.sidebar .brand-sub').textContent.trim()).toBe('by AFRIINNOX Ltd');
    // and the role is still named in the sidebar, on the section label
    expect(root.querySelector('.sidebar .nav-section').textContent.trim()).toBe('Farmer App');

    // sign out, then meet the other half of this screen on the real entry point: the
    // identifier decides who gets in, so one nobody registered must not.
    const logout = [...root.querySelectorAll('.sidebar .nav-item')].find((el) => /log\s?out/i.test(el.textContent));
    expect(logout, 'the sidebar offers a way out').toBeDefined();
    fireEvent.click(logout);
    await vi.waitFor(() => expect(root.querySelector('#login-id')).not.toBeNull());

    const type = (value) => fireEvent.change(root.querySelector('#login-id'), { target: { value } });
    type('nobody@nowhere.rw');
    fireEvent.submit(root.querySelector('form'));
    expect(root.querySelector('.app-shell'), 'an unregistered identifier must open no shell').toBeNull();
    expect(root.querySelector('[role="alert"]').textContent, 'and must say why').toContain('not registered');

    // then a phone the seed has registered
    type('0788123456');
    fireEvent.submit(root.querySelector('form'));
    await vi.waitFor(() => expect(root.querySelector('.app-shell')).not.toBeNull());
    expect(root.querySelector('.app-shell').className).toContain('farmer-app');
  }, 20000);
});
