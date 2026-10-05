import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setActiveOrg } from '../lib/api';
import { supabase } from '../lib/supabase';

export interface OrgMembership {
  id: string;
  name: string;
  time_zone: string;
  role_key: string;
  role_name: string;
  permissions: string[];
}

interface AuthState {
  session: Session | null;
  loading: boolean;
  /** Set when the profile could not be loaded (network or server error). */
  error: unknown;
  organizations: OrgMembership[];
  org: OrgMembership | null;
  switchOrg(id: string): void;
  can(permission: string): boolean;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const ORG_KEY = 'snyder.activeOrg';

function readStoredOrg(): string | null {
  try {
    return localStorage.getItem(ORG_KEY);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [orgId, setOrgId] = useState<string | null>(readStoredOrg);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const me = useQuery({
    queryKey: ['me', session?.user.id],
    enabled: !!session,
    queryFn: () => api.get<{ organizations: OrgMembership[] }>('/api/me'),
    // RequireAuth shows its own error screen with a retry button.
    meta: { silent: true },
  });

  const organizations = me.data?.organizations ?? [];
  const org = organizations.find((o) => o.id === orgId) ?? organizations[0] ?? null;
  setActiveOrg(org?.id ?? null);

  const value = useMemo<AuthState>(
    () => ({
      session,
      loading: sessionLoading || (!!session && me.isLoading),
      error: me.isError ? me.error : null,
      organizations,
      org,
      switchOrg(id) {
        try {
          localStorage.setItem(ORG_KEY, id);
        } catch {
          /* storage unavailable */
        }
        setOrgId(id);
        setActiveOrg(id);
        qc.invalidateQueries();
      },
      can: (p) => !!org?.permissions.includes(p),
      async signOut() {
        await supabase.auth.signOut();
        qc.clear();
      },
      async refresh() {
        await me.refetch();
      },
    }),
    [session, sessionLoading, me, organizations, org, qc],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
