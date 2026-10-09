import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { api } from '../lib/api';
import { cx } from './ui';

type SetupKey = 'voice' | 'phone_number' | 'agent' | 'leads' | 'email' | 'appointment_type' | 'campaign' | 'first_call';

const STEPS: { key: SetupKey; title: string; detail: string; to: string }[] = [
  { key: 'voice', title: 'Add a voice', detail: 'Pick how your AI sounds.', to: '/settings/voices' },
  { key: 'phone_number', title: 'Connect a phone number', detail: 'Import a Twilio number to call from.', to: '/settings/numbers' },
  { key: 'agent', title: 'Create an agent', detail: 'Prompt, voice and Claude Haiku 4.5.', to: '/settings/agents' },
  { key: 'email', title: 'Set up email', detail: 'Confirmations and reminders go out automatically.', to: '/settings/email' },
  { key: 'appointment_type', title: 'Add an appointment type', detail: 'What prospects can book, and with whom.', to: '/settings/appointments' },
  { key: 'leads', title: 'Upload leads', detail: 'A CSV with at least a phone column.', to: '/leads' },
  { key: 'campaign', title: 'Launch a campaign', detail: 'Publish and start dialing.', to: '/campaigns' },
];

const DISMISS_KEY = 'snyder.gettingStarted.dismissed';
const readDismissed = () => {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
};

export function GettingStarted() {
  const { org } = useAuth();
  const [dismissed, setDismissed] = useState(readDismissed);
  const q = useQuery({ queryKey: ['setup-status', org?.id], queryFn: () => api.get<Record<SetupKey, boolean>>('/api/setup-status') });
  if (dismissed || !q.data) return null;
  const done = STEPS.filter((s) => q.data[s.key]).length;
  if (done === STEPS.length) return null;
  const pct = Math.round((done / STEPS.length) * 100);
  const next = STEPS.find((s) => !q.data[s.key]);

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 animate-soft-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold">Get set up</h2>
          <p className="text-sm text-muted">{done} of {STEPS.length} done · about 10 minutes to your first booked appointment.</p>
        </div>
        <button
          className="text-sm text-muted hover:text-fg"
          onClick={() => {
            setDismissed(true);
            try {
              localStorage.setItem(DISMISS_KEY, '1');
            } catch {
              /* storage unavailable: hide for this visit only */
            }
          }}
        >
          Hide
        </button>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 stagger">
        {STEPS.map((s) => {
          const ok = q.data[s.key];
          return (
            <li key={s.key}>
              <Link
                to={s.to}
                className={cx(
                  'group flex h-full items-start gap-3 rounded-xl border p-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
                  ok ? 'border-success/30 bg-success/5' : s === next ? 'border-primary/50 bg-primary-soft' : 'border-border hover:border-primary/40',
                )}
              >
                <span className={cx('mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold', ok ? 'bg-success text-white animate-pop' : 'border-2 border-border text-muted group-hover:border-primary')}>
                  {ok ? '✓' : STEPS.indexOf(s) + 1}
                </span>
                <span>
                  <span className={cx('block text-sm font-semibold', ok && 'text-muted line-through decoration-1')}>{s.title}</span>
                  <span className="block text-xs text-muted">{s.detail}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
