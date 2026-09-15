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
 * BROODIINNOX / by AFRIINNOX Ltd — and none of the wording it replaced.
 *
 * One boot per file on purpose: main.jsx creates its own React root and keeps
 * its effects alive, so a second boot in the same file would render against a
 * state the previous root is still writing back to localStorage.
 */
import { describe, expect, it, vi } from 'vitest';

describe('the entry point a browser loads', () => {
  it('mounts and renders the home screen with the new wording beside the icon', async () => {
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
  }, 20000);
});
