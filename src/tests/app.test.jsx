/**
 * Functional / behavioural tests: the assembled app renders and the key
 * business flows work end-to-end through the store (not just the units).
 */
import React from 'react';
import { describe, expect, it, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import App from '../App.jsx';
import { StoreProvider, useStore } from '../lib/store.jsx';
import { buildSeed } from '../lib/seed.js';
import { subscriptionState } from '../lib/services.js';

const KEY = 'broodiinnox_app_v1';

const harness = () =>
  renderHook(() => useStore(), { wrapper: ({ children }) => <StoreProvider>{children}</StoreProvider> });

function seedWithSession(session) {
  return { ...buildSeed(), session, lang: 'en', theme: 'light', reminderSent: [] };
}

function renderApp(initialEntries = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <StoreProvider>
        <App />
      </StoreProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('login & roles', () => {
  it('renders the AFRIINNOX brand and login', () => {
    renderApp();
    expect(screen.getByText('AFRIINNOX')).toBeInTheDocument();
    expect(screen.getByText(/Welcome back/i)).toBeInTheDocument();
  });

  it('logs in as demo farmer and shows the dashboard with system cards', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /demo farmer/i }));
    await waitFor(() => expect(screen.getByText(/Dashboard, Jean/i)).toBeInTheDocument());
    expect(screen.getByText(/Main Farm/i)).toBeInTheDocument();
    expect(screen.getByText(/Kigali Farm 2/i)).toBeInTheDocument();
  });

  it('logs in as admin and shows network KPIs', async () => {
    renderApp();
    fireEvent.click(screen.getByText(/Afriinnox Admin/));
    fireEvent.click(screen.getByRole('button', { name: /demo admin/i }));
    await waitFor(() => expect(screen.getByText(/Revenue today/i)).toBeInTheDocument());
    expect(screen.getByText(/Complete overview of the Broodiinnox network/i)).toBeInTheDocument();
  });
});

describe('subscription lock (behavioural)', () => {
  it('a device with an expired subscription shows the lock banner and disables controls', () => {
    localStorage.setItem(KEY, JSON.stringify(seedWithSession({ id: 'f5', name: 'Patrick Habimana', role: 'farmer', phone: '0788555666' })));
    renderApp(['/farmer/systems/BRD006']);
    expect(screen.getAllByText(/device locked/i).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /Renew now/i }).length).toBeGreaterThan(0);
    // Remote control Save must be disabled while locked
    expect(screen.getByRole('button', { name: /Save targets/i })).toBeDisabled();
  });

  it('an active device does not show the lock banner and controls work', () => {
    localStorage.setItem(KEY, JSON.stringify(seedWithSession({ id: 'f1', name: 'Jean Damascene', role: 'farmer', phone: '0788123456' })));
    renderApp(['/farmer/systems/BRD001']);
    expect(screen.queryByText(/Device locked/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save targets/i })).toBeEnabled();
  });
});

describe('MoMo payment flow (behavioural, through the store)', () => {
  it('a confirmed payment activates the subscription and unlocks the device', () => {
    const { result } = harness();
    const { state, dispatch } = result.current;
    const before = state.devices.find((d) => d.id === 'BRD008');
    expect(subscriptionState(before.subscription.endDate, new Date().toISOString())).toBe('expired');

    act(() => {
      dispatch({ type: 'REQUEST_PAYMENT', farmerId: 'f2', deviceId: 'BRD008', planId: 'p15', phone: '0788222333' });
    });
    const pending = result.current.state.payments.find((p) => p.deviceId === 'BRD008' && p.status === 'pending');
    expect(pending).toBeTruthy();

    act(() => {
      dispatch({ type: 'CONFIRM_PAYMENT', paymentId: pending.id, ok: true });
    });
    const after = result.current.state;
    expect(after.payments.find((p) => p.id === pending.id).status).toBe('successful');
    const device = after.devices.find((d) => d.id === 'BRD008');
    expect(subscriptionState(device.subscription.endDate, new Date().toISOString())).toBe('active');
    // audit trail recorded
    expect(after.audit.some((a) => a.action === 'payment.success' && a.details.includes('BRD008'))).toBe(true);
  });

  it('a failed payment does NOT unlock the device (backend decides, not the frontend)', () => {
    const { result } = harness();
    act(() => {
      result.current.dispatch({ type: 'REQUEST_PAYMENT', farmerId: 'f2', deviceId: 'BRD008', planId: 'p15', phone: '0788222333' });
    });
    const pending = result.current.state.payments.find((p) => p.deviceId === 'BRD008' && p.status === 'pending');
    act(() => {
      result.current.dispatch({ type: 'CONFIRM_PAYMENT', paymentId: pending.id, ok: false });
    });
    const after = result.current.state;
    expect(after.payments.find((p) => p.id === pending.id).status).toBe('failed');
    const device = after.devices.find((d) => d.id === 'BRD008');
    expect(subscriptionState(device.subscription.endDate, new Date().toISOString())).toBe('expired');
    expect(after.audit.some((a) => a.action === 'payment.failed' && a.details.includes('BRD008'))).toBe(true);
  });
});

describe('temperature control (behavioural, through the store)', () => {
  it('SET_TARGETS updates the device and writes an audit entry with prev/next', () => {
    const { result } = harness();
    act(() => {
      result.current.dispatch({ type: 'LOGIN', user: { id: 'f1', name: 'Jean', role: 'farmer' } });
      result.current.dispatch({ type: 'SET_TARGETS', deviceId: 'BRD001', min: 34, max: 36 });
    });
    const d = result.current.state.devices.find((x) => x.id === 'BRD001');
    expect(d.baseMin).toBe(34);
    expect(d.baseMax).toBe(36);
    const entry = result.current.state.audit.find((a) => a.action === 'temperature.change');
    expect(entry.prev).toEqual({ min: 35, max: 37 });
    expect(entry.next).toEqual({ min: 34, max: 36 });
    expect(entry.user).toBe('Jean');
  });

  it('START_BATCH sets presets and the batch starts on day 1', () => {
    const { result } = harness();
    act(() => {
      result.current.dispatch({ type: 'START_BATCH', deviceId: 'BRD003', animal: 'duck', durationDays: 28, count: 400, startDate: new Date().toISOString() });
    });
    const d = result.current.state.devices.find((x) => x.id === 'BRD003');
    expect(d.batch.animal).toBe('duck');
    expect(d.batch.durationDays).toBe(28);
    expect(d.baseMin).toBe(33); // duck preset
    expect(d.baseMax).toBe(35);
  });
});
