import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { AppShell } from './components/AppShell';
import { BrandSplash, Logo } from './components/Brand';
import { Button, EmptyState } from './components/ui';
import { Toaster } from './components/Toaster';
import { ApiError } from './lib/api';
import { applyTheme } from './lib/theme';
import { errorMessage, toast } from './lib/toast';
import { AppointmentsPage } from './pages/Appointments';
import { CallsPage } from './pages/Calls';
import { AppointmentSettingsPage } from './pages/settings/AppointmentSettings';
import { DashboardPage } from './pages/Dashboard';
import { CampaignEditorPage } from './pages/CampaignEditor';
import { LiveMonitorPage } from './pages/LiveMonitor';
import { DispositionsSettings } from './pages/settings/Dispositions';
import { ConnectionsSettings } from './pages/settings/Connections';
import { EmailSettings } from './pages/settings/EmailSettings';
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

// Every failed request surfaces to the user. Pass `meta: { silent: true }` only where the page
// already shows the error inline.
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err, query) => {
      if (query.meta?.silent) return;
      if (err instanceof ApiError && err.status === 401) return toast.error('Your session expired. Please sign in again.');
      toast.error(errorMessage(err));
    },
  }),
  mutationCache: new MutationCache({
    onError: (err, _vars, _ctx, mutation) => {
      if (mutation.meta?.silent) return;
      toast.error(errorMessage(err));
    },
  }),
  defaultOptions: {
    queries: { staleTime: 15_000, retry: (n, err) => n < 1 && !(err instanceof ApiError && err.status >= 400 && err.status < 500), refetchOnWindowFocus: false },
  },
});

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, organizations, error, refresh, signOut } = useAuth();
  if (loading) return <BrandSplash />;
  if (!session) return <Navigate to="/login" replace />;
  if (error) return <LoadError error={error} onRetry={() => void refresh()} onSignOut={() => void signOut()} />;
  if (organizations.length === 0) return <OnboardingPage />;
  return <>{children}</>;
}

function LoadError({ error, onRetry, onSignOut }: { error: unknown; onRetry(): void; onSignOut(): void }) {
  return (
    <div className="grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-surface p-7 text-center shadow-xl animate-page-in">
        <Logo className="mx-auto h-10" />
        <h1 className="text-xl font-extrabold">We couldn’t load your workspace</h1>
        <p className="text-sm text-muted">{errorMessage(error)}</p>
        <div className="flex justify-center gap-2">
          <Button variant="primary" onClick={onRetry}>Try again</Button>
          <Button onClick={onSignOut}>Sign out</Button>
        </div>
      </div>
    </div>
  );
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
                <Route path="connections" element={<RequirePermission permission="settings.manage"><ConnectionsSettings /></RequirePermission>} />
                <Route path="email" element={<RequirePermission permission="settings.manage"><EmailSettings /></RequirePermission>} />
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
      <Toaster />
    </QueryClientProvider>
  );
}
