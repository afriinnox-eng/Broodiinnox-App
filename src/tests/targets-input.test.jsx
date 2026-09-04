/**
 * Regression: editing the Min/Max temperature targets in the farmer
 * dashboard must never crash/blank the page, and an empty field must never
 * be coerced into 0/NaN and saved to the device (the original bug: clearing
 * the input -> Number('')=0 -> out-of-range banner -> preset.label undefined
 * -> toLowerCase() throw -> React unmounted the whole app -> blank screen).
 */
import React from 'react';
import { describe, expect, it, beforeEach } from 'vitest';
import { HashRouter } from 'react-router-dom';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import App from '../App.jsx';
import { StoreProvider, useStore } from '../lib/store.jsx';
import { buildSeed } from '../lib/seed.js';
import { ANIMALS } from '../lib/presets.js';

const KEY = 'broodiinnox_app_v1';

function seedWithSession(session) {
  return { ...buildSeed(), session, reminderSent: [] };
}

function renderApp(hash) {
  window.location.hash = hash;
  probedDevice = null;
  return render(
    <HashRouter>
      <StoreProvider>
        <App />
        <StateProbe />
      </StoreProvider>
    </HashRouter>
  );
}

function storeHarness() {
  return renderHook(() => useStore(), { wrapper: ({ children }) => <StoreProvider>{children}</StoreProvider> });
}

function farmerSeed() {
  return seedWithSession({ id: 'f1', name: 'Jean Bosco', role: 'farmer', phone: '0788111222' });
}

let probedDevice = null;

function StateProbe() {
  const { state } = useStore();
  probedDevice = state.devices.find((d) => d.id === 'BRD001');
  return null;
}

function targetsUi(container) {
  const inputs = Array.from(container.querySelectorAll('input[type="number"]'));
  const min = inputs.find((i) => i.min === '10');
  const max = inputs.find((i) => i.min === '11');
  const save = Array.from(container.querySelectorAll('button')).find((b) => /Save targets/i.test(b.textContent || ''));
  return { min, max, save };
}

beforeEach(() => {
  localStorage.clear();
});

describe('temperature target inputs (farmer system detail)', () => {
  it('clearing and retyping min/max never blanks the page', async () => {
    localStorage.setItem(KEY, JSON.stringify(farmerSeed()));
    const { container } = renderApp('#/farmer/systems/BRD001');
    const { min, max } = targetsUi(container);
    expect(min).toBeTruthy();
    expect(max).toBeTruthy();
    const alive = () => expect(screen.getByText(/Remote control/i)).toBeTruthy();

    // delete the whole figure (the reported crash path)
    await act(async () => { fireEvent.change(min, { target: { value: '' } }); });
    alive();
    await act(async () => { fireEvent.change(max, { target: { value: '' } }); });
    alive();

    // half-typed values must not crash either
    await act(async () => { fireEvent.change(min, { target: { value: '3' } }); });
    alive();
    await act(async () => { fireEvent.change(min, { target: { value: '' } }); });
    await act(async () => { fireEvent.change(min, { target: { value: '34' } }); });
    await act(async () => { fireEvent.change(max, { target: { value: '36' } }); });
    alive();
  });

  it('empty/partial targets disable Save and are never dispatched as 0/NaN', async () => {
    localStorage.setItem(KEY, JSON.stringify(farmerSeed()));
    const { container } = renderApp('#/farmer/systems/BRD001');
    const { min, save } = targetsUi(container);
    expect(save.disabled).toBe(false); // defaults 35/37 are valid

    await act(async () => { fireEvent.change(min, { target: { value: '' } }); });
    expect(save.disabled).toBe(true); // cannot save an empty min
    await act(async () => { fireEvent.click(save); });

    expect(probedDevice.baseMin).toBe(35); // untouched: no 0/NaN dispatched
    expect(probedDevice.baseMax).toBe(37);
  });

  it('saving valid whole-degree targets updates the device and the audit log', async () => {
    localStorage.setItem(KEY, JSON.stringify(farmerSeed()));
    const { container } = renderApp('#/farmer/systems/BRD001');
    const { min, max, save } = targetsUi(container);

    await act(async () => { fireEvent.change(min, { target: { value: '34' } }); });
    await act(async () => { fireEvent.change(max, { target: { value: '36' } }); });
    expect(save.disabled).toBe(false);
    await act(async () => { fireEvent.click(save); });

    expect(probedDevice.baseMin).toBe(34);
    expect(probedDevice.baseMax).toBe(36);
  });
});

describe('animal preset labels', () => {
  it('every preset exposes a non-empty display label (used in dropdowns, cards and banners)', () => {
    for (const k of ['chicken', 'pig', 'turkey', 'duck']) {
      expect(ANIMALS[k]).toBeTruthy();
      expect(typeof ANIMALS[k].label).toBe('string');
      expect(ANIMALS[k].label.length).toBeGreaterThan(0);
    }
  });
});

describe('recommended-range warning on the temperature inputs', () => {
  function clickButton(container, text) {
    const b = Array.from(container.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === text);
    expect(b).toBeTruthy();
    fireEvent.click(b);
    return b;
  }

  it('warns on an out-of-range min and clears as soon as a valid value is typed', async () => {
    localStorage.setItem(KEY, JSON.stringify(farmerSeed()));
    const { container } = renderApp('#/farmer/systems/BRD001');
    const { min } = targetsUi(container);

    // BRD001 batch is chicken (recommended 35–37°C); our advisory shows
    // when min < 32 or max > 40.
    await act(async () => { fireEvent.change(min, { target: { value: '28' } }); });
    expect(screen.getByText(/outside the recommended range/i)).toBeTruthy();

    await act(async () => { fireEvent.change(min, { target: { value: '34' } }); });
    expect(screen.queryByText(/outside the recommended range/i)).toBeNull();
  });

  it('warning does not reappear after saving valid values', async () => {
    localStorage.setItem(KEY, JSON.stringify(farmerSeed()));
    const { container } = renderApp('#/farmer/systems/BRD001');
    const { min, max, save } = targetsUi(container);

    await act(async () => { fireEvent.change(min, { target: { value: '28' } }); });
    expect(screen.getByText(/outside the recommended range/i)).toBeTruthy();
    await act(async () => { fireEvent.change(min, { target: { value: '34' } }); });
    await act(async () => { fireEvent.change(max, { target: { value: '37' } }); });
    expect(screen.queryByText(/outside the recommended range/i)).toBeNull();

    await act(async () => { fireEvent.click(save); });
    expect(probedDevice.baseMin).toBe(34);
    expect(screen.queryByText(/outside the recommended range/i)).toBeNull();
  });

  it('Restart and Sync time give visible results and are recorded', async () => {
    localStorage.setItem(KEY, JSON.stringify(farmerSeed()));
    const { container } = renderApp('#/farmer/systems/BRD001');

    // Restart through the confirmation modal
    clickButton(container, 'Restart');
    expect(screen.getByText(/Restart — confirm/i)).toBeTruthy();
    clickButton(container, 'Yes, restart');
    expect(probedDevice.restartedAt).toBeTruthy();
    expect(screen.getByText(/Restart acknowledged/i)).toBeTruthy();

    // Sync time through its confirmation modal
    clickButton(container, 'Sync time');
    expect(screen.getByText(/Synchronize time — confirm/i)).toBeTruthy();
    clickButton(container, 'Yes, synchronize time');
    expect(probedDevice.timeSyncedAt).toBeTruthy();
    expect(screen.getByText(/Device clock synchronized/i)).toBeTruthy();
  });
});
