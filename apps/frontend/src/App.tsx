import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { AppShell } from './components/AppShell';
import { EmptyState, Spinner } from './components/ui';
import { applyTheme } from './lib/theme';
import { AppointmentsPage } from './pages/Appointments';
import { CallsPage } from './pages/Calls';
import { AppointmentSettingsPage } from './pages/settings/AppointmentSettings';
import { DashboardPage } from './pages/Dashboard';
import { CampaignEditorPage } from './pages/CampaignEditor';
import { LiveMonitorPage } from './pages/LiveMonitor';
import { DispositionsSettings } from './pages/settings/Dispositions';
import { CampaignsPage } from './pages/Campaigns';
import { LeadsPage } from './pages/Leads';
import { AgentsSettings } from './pages/settings/Agents';
import { LoginPage } from './pages/Login';
import { PublicAppointmentPage } from './pages/public/AppointmentPage';
import { OnboardingPage } from './pages/Onboarding';
import { OrganizationSettings } from './pages/settings/OrganizationSettings';
import { SETTINGS_NAV, SettingsLayout } from './pages/settings/SettingsLayout';
import { UsersRoles } from './pages/settings/UsersRoles';
import { VoicesSettings } from './pages/settings/Voices';
import { PhoneNumbersSettings } from './pages/settings/PhoneNumbers';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } },
});

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, organizations } = useAuth();
  if (loading) return <div className="min-h-screen grid place-items-center"><Spinner /></div>;
  if (!session) return <Navigate to="/login" replace />;
  if (organizations.length === 0) return <OnboardingPage />;
  return <>{children}</>;
}

export function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) return <EmptyState title="You don't have access to this page." />;
  return <>{children}</>;
}

function SettingsIndex() {
  const { can } = useAuth();
  const first = SETTINGS_NAV.find((i) => can(i.permission));
  return first ? <Navigate to={first.to} replace /> : <EmptyState title="No settings available." />;
}

export function App() {
  useEffect(() => {
    applyTheme();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const h = () => applyTheme();
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            {/* Public, no login: the prospect's personal appointment link. */}
            <Route path="/a/:token" element={<PublicAppointmentPage />} />
            <Route element={<RequireAuth><AppShell /></RequireAuth>}>
              <Route index element={<RequirePermission permission="dashboard.view"><DashboardPage /></RequirePermission>} />
              <Route path="campaigns" element={<RequirePermission permission="campaigns.view"><CampaignsPage /></RequirePermission>} />
              <Route path="campaigns/:id" element={<RequirePermission permission="campaigns.view"><CampaignEditorPage /></RequirePermission>} />
              <Route path="calls" element={<RequirePermission permission="calls.view"><CallsPage /></RequirePermission>} />
              <Route path="monitor" element={<RequirePermission permission="monitor.view"><LiveMonitorPage /></RequirePermission>} />
              <Route path="appointments" element={<RequirePermission permission="appointments.view"><AppointmentsPage /></RequirePermission>} />
              <Route path="leads" element={<RequirePermission permission="leads.view"><LeadsPage /></RequirePermission>} />
              <Route path="settings" element={<SettingsLayout />}>
                <Route index element={<SettingsIndex />} />
                <Route path="organization" element={<RequirePermission permission="org.manage"><OrganizationSettings /></RequirePermission>} />
                <Route path="users" element={<RequirePermission permission="users.manage"><UsersRoles /></RequirePermission>} />
                <Route path="voices" element={<RequirePermission permission="settings.manage"><VoicesSettings /></RequirePermission>} />
                <Route path="numbers" element={<RequirePermission permission="settings.manage"><PhoneNumbersSettings /></RequirePermission>} />
                <Route path="agents" element={<RequirePermission permission="settings.manage"><AgentsSettings /></RequirePermission>} />
                <Route path="dispositions" element={<RequirePermission permission="settings.manage"><DispositionsSettings /></RequirePermission>} />
                <Route path="appointments" element={<RequirePermission permission="appointments.settings"><AppointmentSettingsPage /></RequirePermission>} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
