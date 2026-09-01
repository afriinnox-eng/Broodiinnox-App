import React, { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useStore } from './lib/store.jsx';
import AppShell from './components/layout.jsx';
import Login from './pages/Login.jsx';

import FarmerDashboard from './pages/farmer/Dashboard.jsx';
import FarmerSystems from './pages/farmer/Systems.jsx';
import FarmerSystemDetail from './pages/farmer/SystemDetail.jsx';
import FarmerBatches from './pages/farmer/Batches.jsx';
import FarmerAlerts from './pages/farmer/Alerts.jsx';
import FarmerSubscriptions from './pages/farmer/Subscriptions.jsx';
import FarmerPayments from './pages/farmer/Payments.jsx';
import FarmerSupport from './pages/farmer/Support.jsx';
import FarmerNotifications from './pages/farmer/Notifications.jsx';
import FarmerSettings from './pages/farmer/Settings.jsx';
import FarmerTips from './pages/farmer/Tips.jsx';

import AdminDashboard from './pages/admin/Dashboard.jsx';
import AdminFarmers from './pages/admin/Farmers.jsx';
import AdminDevices from './pages/admin/Devices.jsx';
import AdminLive from './pages/admin/Live.jsx';
import AdminMap from './pages/admin/Map.jsx';
import AdminBatches from './pages/admin/Batches.jsx';
import AdminSubscriptions from './pages/admin/Subscriptions.jsx';
import AdminPayments from './pages/admin/Payments.jsx';
import AdminReports from './pages/admin/Reports.jsx';
import AdminAlerts from './pages/admin/Alerts.jsx';
import AdminTickets from './pages/admin/Tickets.jsx';
import AdminMessages from './pages/admin/Messages.jsx';
import AdminUsers from './pages/admin/AdminUsers.jsx';
import AdminAudit from './pages/admin/Audit.jsx';
import AdminMaintenance from './pages/admin/Maintenance.jsx';
import AdminInventory from './pages/admin/Inventory.jsx';
import AdminSettings from './pages/admin/Settings.jsx';

export default function App() {
  const { state } = useStore();
  const theme = state.theme || 'light';
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  if (!state.session) return <Login />;
  const role = state.session.role;
  const home = role === 'admin' ? '/admin/dashboard' : '/farmer/dashboard';

  return (
    <AppShell>
      <Routes>
        {role === 'admin' ? (
          <>
            <Route path="/admin/dashboard" element={<AdminDashboard />} />
            <Route path="/admin/farmers" element={<AdminFarmers />} />
            <Route path="/admin/farmers/:id" element={<AdminFarmers />} />
            <Route path="/admin/devices" element={<AdminDevices />} />
            <Route path="/admin/systems/:id" element={<AdminDevices />} />
            <Route path="/admin/live" element={<AdminLive />} />
            <Route path="/admin/map" element={<AdminMap />} />
            <Route path="/admin/batches" element={<AdminBatches />} />
            <Route path="/admin/subscriptions" element={<AdminSubscriptions />} />
            <Route path="/admin/payments" element={<AdminPayments />} />
            <Route path="/admin/reports" element={<AdminReports />} />
            <Route path="/admin/alerts" element={<AdminAlerts />} />
            <Route path="/admin/tickets" element={<AdminTickets />} />
            <Route path="/admin/messages" element={<AdminMessages />} />
            <Route path="/admin/admins" element={<AdminUsers />} />
            <Route path="/admin/audit" element={<AdminAudit />} />
            <Route path="/admin/maintenance" element={<AdminMaintenance />} />
            <Route path="/admin/inventory" element={<AdminInventory />} />
            <Route path="/admin/settings" element={<AdminSettings />} />
          </>
        ) : (
          <>
            <Route path="/farmer/dashboard" element={<FarmerDashboard />} />
            <Route path="/farmer/systems" element={<FarmerSystems />} />
            <Route path="/farmer/systems/:id" element={<FarmerSystemDetail />} />
            <Route path="/farmer/batches" element={<FarmerBatches />} />
            <Route path="/farmer/alerts" element={<FarmerAlerts />} />
            <Route path="/farmer/subscriptions" element={<FarmerSubscriptions />} />
            <Route path="/farmer/payments" element={<FarmerPayments />} />
            <Route path="/farmer/support" element={<FarmerSupport />} />
            <Route path="/farmer/notifications" element={<FarmerNotifications />} />
            <Route path="/farmer/settings" element={<FarmerSettings />} />
            <Route path="/farmer/tips" element={<FarmerTips />} />
          </>
        )}
        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
    </AppShell>
  );
}
