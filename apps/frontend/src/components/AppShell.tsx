import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { getTheme, setTheme, type Theme } from '../lib/theme';
import { cx, Select } from './ui';
import { NotificationBell } from './NotificationBell';

export interface NavItem {
  to: string;
  label: string;
  permission: string | string[];
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', permission: 'dashboard.view' },
  { to: '/monitor', label: 'Live monitor', permission: 'monitor.view' },
  { to: '/campaigns', label: 'Campaigns', permission: 'campaigns.view' },
  { to: '/leads', label: 'Leads', permission: 'leads.view' },
  { to: '/calls', label: 'Call records', permission: 'calls.view' },
  { to: '/appointments', label: 'Appointments', permission: 'appointments.view' },
  { to: '/settings', label: 'Settings', permission: ['settings.manage', 'users.manage', 'appointments.settings', 'org.manage'] },
];

export function AppShell() {
  const { org, organizations, switchOrg, can, signOut, session } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const items = NAV.filter((n) => (Array.isArray(n.permission) ? n.permission.some(can) : can(n.permission)));

  const nav = (
    <nav className="flex flex-col gap-1">
      {items.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.to === '/'}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            cx('rounded-md px-3 py-2 text-sm transition-colors duration-150', isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted hover:text-fg hover:bg-surface-2')
          }
        >
          {n.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className={cx('fixed inset-y-0 left-0 z-40 w-64 border-r border-border bg-surface p-4 transition-transform md:static md:w-auto md:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="mb-6 flex items-center justify-between">
          <span className="text-lg font-semibold">Snyder</span>
          <button className="md:hidden text-muted" onClick={() => setOpen(false)} aria-label="Close menu">✕</button>
        </div>
        {organizations.length > 1 && (
          <Select className="mb-4" value={org?.id} onChange={(e) => switchOrg(e.target.value)}>
            {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
        )}
        {nav}
        <div className="mt-8 space-y-2 border-t border-border pt-4 text-sm">
          <Select
            value={theme}
            aria-label="Theme"
            onChange={(e) => {
              const t = e.target.value as Theme;
              setThemeState(t);
              setTheme(t);
            }}
          >
            <option value="system">System theme</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </Select>
          <p className="truncate text-muted" title={session?.user.email ?? ''}>{session?.user.email}</p>
          <button className="text-muted hover:text-fg" onClick={() => void signOut()}>Sign out</button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/40 md:hidden animate-fade-in" onClick={() => setOpen(false)} />}
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur">
          <button className="md:hidden" onClick={() => setOpen(true)} aria-label="Open menu">☰</button>
          <span className="font-medium truncate">{org?.name}</span>
          <NotificationBell />
        </header>
        <main key={location.pathname} className="mx-auto max-w-7xl p-4 md:p-6 animate-fade-up">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
