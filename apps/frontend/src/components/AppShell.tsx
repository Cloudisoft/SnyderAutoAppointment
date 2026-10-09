import { useState, type CSSProperties } from 'react';
import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { getTheme, setTheme, type Theme } from '../lib/theme';
import { cx, Select } from './ui';
import { Logo } from './Brand';
import { NotificationBell } from './NotificationBell';

type NavIcon = 'dashboard' | 'monitor' | 'campaigns' | 'leads' | 'calls' | 'appointments' | 'settings';

export interface NavItem {
  to: string;
  label: string;
  icon: NavIcon;
  permission: string | string[];
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', permission: 'dashboard.view' },
  { to: '/monitor', label: 'Live monitor', icon: 'monitor', permission: 'monitor.view' },
  { to: '/campaigns', label: 'Campaigns', icon: 'campaigns', permission: 'campaigns.view' },
  { to: '/leads', label: 'Leads', icon: 'leads', permission: 'leads.view' },
  { to: '/calls', label: 'Call records', icon: 'calls', permission: 'calls.view' },
  { to: '/appointments', label: 'Appointments', icon: 'appointments', permission: 'appointments.view' },
  { to: '/settings', label: 'Settings', icon: 'settings', permission: ['settings.manage', 'users.manage', 'appointments.settings', 'org.manage'] },
];

export function AppShell() {
  const { org, organizations, switchOrg, can, signOut, session } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const [theme, setThemeState] = useState<Theme>(getTheme());
  // First loads and saves only; background polling stays quiet.
  const busy = useIsFetching({ predicate: (q) => q.state.data === undefined }) + useIsMutating() > 0;
  const items = NAV.filter((n) => (Array.isArray(n.permission) ? n.permission.some(can) : can(n.permission)));

  const nav = (
    <nav className="flex flex-col gap-1 stagger">
      {items.map((n, i) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.to === '/'}
          style={{ '--i': i } as CSSProperties}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            cx(
              'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200',
              isActive ? 'bg-primary-soft text-primary font-semibold' : 'text-muted hover:translate-x-0.5 hover:bg-surface-2 hover:text-fg',
            )
          }
        >
          {({ isActive }) => (
            <>
              <span
                aria-hidden
                className={cx(
                  'absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary transition-all duration-300',
                  isActive ? 'opacity-100 scale-y-100' : 'opacity-0 scale-y-0',
                )}
              />
              <NavIcon name={n.icon} />
              {n.label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );

  const userInitial = (session?.user.email ?? '?').slice(0, 1).toUpperCase();

  return (
    <div className="min-h-screen">
      {/* Top bar with the brand logo, visible on every page. */}
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-surface/85 px-4 backdrop-blur-md md:px-6">
        <button className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-fg md:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        <Link to="/" className="flex shrink-0 items-center transition-transform duration-200 hover:scale-[1.02]" aria-label="Snyder Automation home">
          <Logo className="h-8 md:h-9" />
        </Link>
        <span className="ml-2 hidden h-6 w-px bg-border sm:block" />
        <span className="hidden truncate text-sm font-medium text-muted sm:block">{org?.name}</span>
        <div className="ml-auto flex items-center gap-2">
          <NotificationBell />
          <span
            className="grid h-9 w-9 place-items-center rounded-full bg-primary font-display text-sm font-bold text-primary-fg shadow-sm ring-0 ring-primary/25 transition-shadow duration-300 hover:ring-4"
            title={session?.user.email ?? ''}
          >
            {userInitial}
          </span>
        </div>
        <div aria-hidden className="top-progress" data-active={busy}><span /></div>
      </header>
      <div className="md:grid md:grid-cols-[248px_1fr]">
        <aside
          className={cx(
            'fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-border bg-surface p-4 transition-transform duration-300 ease-out md:sticky md:top-16 md:z-10 md:h-[calc(100vh-4rem)] md:w-auto md:translate-x-0',
            open ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
          )}
        >
          <div className="mb-5 flex items-center justify-between md:hidden">
            <Logo className="h-8" />
            <button className="rounded-md p-2 text-muted hover:bg-surface-2" onClick={() => setOpen(false)} aria-label="Close menu">✕</button>
          </div>
          {organizations.length > 1 && (
            <Select className="mb-4" value={org?.id} onChange={(e) => switchOrg(e.target.value)} aria-label="Organization">
              {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          )}
          {nav}
          <div className="mt-auto space-y-3 border-t border-border pt-4 text-sm">
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
            <button className="font-medium text-muted transition-colors hover:text-danger" onClick={() => void signOut()}>Sign out</button>
          </div>
        </aside>
        {open && <div className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[2px] md:hidden animate-fade-in" onClick={() => setOpen(false)} />}
        <main key={location.pathname} className="mx-auto w-full min-w-0 max-w-7xl p-4 md:p-8 animate-page-in">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

const ICONS: Record<NavIcon, string> = {
  dashboard: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  monitor: 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 5v4l3 2',
  campaigns: 'M3 11l18-8-8 18-2-8-8-2z',
  leads: 'M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21a8 8 0 0116 0',
  calls: 'M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8 9.8a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z',
  appointments: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2zm4 10l2 2 4-4',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 00-2-1.2L14.5 3h-5l-.4 2.6a7.5 7.5 0 00-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 000 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 002 1.2l.4 2.6h5l.4-2.6a7.5 7.5 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
};

function NavIcon({ name }: { name: NavIcon }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 transition-transform duration-200 group-hover:scale-110">
      <path d={ICONS[name]} />
    </svg>
  );
}
