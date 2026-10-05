import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Logo } from '../components/Brand';
import { Button, ErrorText, Field, Input } from '../components/ui';
import { supabase } from '../lib/supabase';

export function LoginPage() {
  const { session } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [error, setError] = useState<unknown>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (session) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (res.error) setError(res.error);
    else if (mode === 'signup' && !res.data.session) setInfo('Check your inbox to confirm your email.');
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="brand-glow relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col">
        <Logo tone="onDark" className="h-12 self-start animate-page-in" />
        <div className="my-auto max-w-md">
          <h1 className="text-4xl font-extrabold leading-tight animate-rise">
            AI calls that book <span className="text-[#ff7a2e]">real appointments.</span>
          </h1>
          <p className="mt-4 text-lg text-white/70 animate-rise" style={{ animationDelay: '80ms' }}>
            Upload leads, launch a campaign, and let your voice agent qualify, transfer and schedule while you watch it live.
          </p>
          <ul className="mt-8 space-y-3 stagger">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-3 text-white/90">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#fe5e01] text-xs font-bold text-[#090d0d]">✓</span>
                {f}
              </li>
            ))}
          </ul>
        </div>
        <img src="/brand/mark-dark.png" alt="" aria-hidden className="pointer-events-none absolute -bottom-10 -right-10 h-64 w-auto opacity-10 animate-float" />
        <p className="text-sm text-white/50">By Snyder Staffing</p>
      </section>
      <section className="grid place-items-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5 animate-page-in">
          <Logo className="h-12 self-start lg:hidden" />
          <div>
            <h2 className="text-2xl font-extrabold">{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h2>
            <p className="mt-1 text-sm text-muted">{mode === 'signin' ? 'Sign in to your Snyder Automation workspace.' : 'Start booking appointments with AI calls.'}</p>
          </div>
          <Field label="Email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@company.com" /></Field>
          <Field label="Password"><Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} placeholder="At least 8 characters" /></Field>
          <ErrorText error={error} />
          {info && <p className="rounded-lg bg-success/10 p-3 text-sm text-success animate-fade-in">{info}</p>}
          <Button variant="primary" className="h-11 w-full" loading={busy}>{mode === 'signin' ? 'Sign in' : 'Create account'}</Button>
          <button type="button" className="w-full text-sm text-muted transition-colors hover:text-fg" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setInfo(null); }}>
            {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}

const FEATURES = [
  'Natural voices with Cartesia and Claude',
  'Live monitor with real-time transcripts',
  'Warm transfers to your team',
  'Appointments booked and confirmed by email',
];
