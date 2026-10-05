import { dismissToast, useToasts } from '../lib/toast';
import { cx } from './ui';

const tones = {
  error: 'border-danger/40 before:bg-danger',
  success: 'border-success/40 before:bg-success',
  info: 'border-primary/40 before:bg-primary',
};

export function Toaster() {
  const items = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className={cx(
            'pointer-events-auto relative flex w-full max-w-sm items-start gap-3 overflow-hidden rounded-lg border bg-surface py-3 pl-4 pr-3 text-sm shadow-lg animate-toast-in',
            "before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-['']",
            tones[t.tone],
          )}
        >
          <p className="flex-1 break-words">{t.message}</p>
          <button className="text-muted hover:text-fg" onClick={() => dismissToast(t.id)} aria-label="Dismiss">✕</button>
        </div>
      ))}
    </div>
  );
}
