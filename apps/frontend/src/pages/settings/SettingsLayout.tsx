import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { cx, PageHeader } from '../../components/ui';

export const SETTINGS_NAV = [
  { to: 'organization', label: 'Organization', permission: 'org.manage' },
  { to: 'users', label: 'Users & roles', permission: 'users.manage' },
  { to: 'connections', label: 'Connections', permission: 'settings.manage' },
  { to: 'email', label: 'Email (SMTP)', permission: 'settings.manage' },
  { to: 'voices', label: 'Voices', permission: 'settings.manage' },
  { to: 'numbers', label: 'Phone numbers', permission: 'settings.manage' },
  { to: 'agents', label: 'Agents', permission: 'settings.manage' },
  { to: 'dispositions', label: 'Dispositions', permission: 'settings.manage' },
  { to: 'appointments', label: 'Appointments', permission: 'appointments.settings' },
];

export function SettingsLayout() {
  const { can } = useAuth();
  const items = SETTINGS_NAV.filter((i) => can(i.permission));
  return (
    <div>
      <PageHeader title="Settings" />
      <div className="grid gap-6 md:grid-cols-[200px_1fr]">
        <nav className="flex md:flex-col gap-1 overflow-x-auto">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} className={({ isActive }) => cx('rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-all duration-200', isActive ? 'bg-primary-soft text-primary font-semibold' : 'text-muted hover:translate-x-0.5 hover:text-fg hover:bg-surface-2')}>
              {i.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0"><Outlet /></div>
      </div>
    </div>
  );
}
