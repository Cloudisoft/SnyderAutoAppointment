import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg font-semibold shadow-sm shadow-primary/30 hover:bg-primary-hover hover:-translate-y-px hover:shadow-md hover:shadow-primary/30',
  secondary: 'bg-surface border border-border hover:bg-surface-2 hover:border-primary/40',
  ghost: 'hover:bg-surface-2',
  danger: 'bg-danger text-white hover:opacity-90',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  loading,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-200 active:translate-y-0 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm',
        variants[variant],
        className,
      )}
    >
      {loading && <Spinner small />}
      {children}
    </button>
  );
}

const fieldBase =
  'w-full rounded-lg border border-border bg-surface px-3 text-sm text-fg placeholder:text-muted transition-all duration-200 hover:border-primary/40 focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(fieldBase, 'h-10', props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(fieldBase, 'py-2 min-h-24', props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(fieldBase, 'h-10', props.className)} />;
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-muted">{hint}</span>}
      {error && <span className="block text-xs text-danger">{error}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label?: string }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative h-6 w-11 rounded-full transition-colors duration-200', checked ? 'bg-primary' : 'bg-border')}
      >
        <span className={cx('absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ease-out', checked ? 'translate-x-5' : 'translate-x-0')} />
      </button>
      {label && <span className="text-sm">{label}</span>}
    </label>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgb(9_13_13/0.04)] animate-page-in lift', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="font-display font-bold">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const badgeTones = {
  gray: 'bg-surface-2 text-muted',
  blue: 'bg-blue-500/15 text-blue-600 dark:text-blue-300',
  green: 'bg-green-500/15 text-green-700 dark:text-green-300',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  red: 'bg-red-500/15 text-red-700 dark:text-red-300',
  purple: 'bg-purple-500/15 text-purple-700 dark:text-purple-300',
};
export type BadgeTone = keyof typeof badgeTones;
export function Badge({ tone = 'gray', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', badgeTones[tone])}>{children}</span>;
}

export function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      aria-label="Loading"
      className={cx('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', small ? 'h-3.5 w-3.5' : 'h-5 w-5')}
    />
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 animate-page-in">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted mt-1">{description}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface/60 p-10 text-center animate-page-in">
      <img src="/brand/mark.png" alt="" aria-hidden className="mx-auto mb-3 h-10 w-auto opacity-80 animate-float" />
      <p className="font-display font-bold">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="text-sm text-danger">{error instanceof Error ? error.message : String(error)}</p>;
}

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose(): void; title: string; children: ReactNode; footer?: ReactNode }) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4 animate-fade-in" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="w-full sm:max-w-lg max-h-[90vh] overflow-auto rounded-t-xl sm:rounded-xl bg-surface border border-border shadow-xl animate-sheet-up sm:animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-display font-bold">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="text-muted hover:text-fg">✕</button>
        </header>
        <div className="p-4 space-y-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-border px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose(): void; title: ReactNode; children: ReactNode }) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 animate-fade-in" onClick={onClose}>
      <aside className="absolute right-0 top-0 h-full w-full max-w-xl overflow-auto bg-surface border-l border-border shadow-xl animate-slide-in-right" onClick={(e) => e.stopPropagation()}>
        <header className="sticky top-0 flex items-center justify-between border-b border-border bg-surface px-4 py-3">
          <h2 className="font-display font-bold">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="text-muted hover:text-fg">✕</button>
        </header>
        <div className="p-4 space-y-4">{children}</div>
      </aside>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: NoInfer<T>) => void; tabs: { value: NoInfer<T>; label: string }[] }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border mb-4">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={cx('px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-all duration-200', value === t.value ? 'border-primary text-fg font-semibold' : 'border-transparent text-muted hover:text-fg hover:border-border')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface animate-page-in">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
          <tr>{head.map((h, i) => <th key={i} className="px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border row-hover">{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => <td className={cx('px-3 py-2 align-top', className)}>{children}</td>;

/** Shimmering placeholder while data loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('skeleton h-4', className)} />;
}

/** Placeholder rows for tables and lists. */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-4">
          <Skeleton className="w-1/4" />
          <Skeleton className="w-1/3" />
          <Skeleton className="w-1/5" />
        </div>
      ))}
    </div>
  );
}

/** Confirmation dialog for destructive actions. */
export function ConfirmModal({
  open,
  title,
  children,
  confirmLabel = 'Delete',
  danger = true,
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm(): void;
  onClose(): void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="text-sm text-muted">{children}</div>
    </Modal>
  );
}
