import { cx } from './ui';

// Default height only when the caller did not pass one; keep the aspect ratio inside flex columns.
const logoClass = (className?: string) => cx('w-auto max-w-full shrink-0 object-contain select-none', /(^|\s)h-/.test(className ?? '') ? '' : 'h-9', className);

/** Full Snyder Automation logo. `tone="auto"` follows the theme; `onDark` forces the light-text version. */
export function Logo({ className, tone = 'auto' }: { className?: string; tone?: 'auto' | 'onDark' | 'onLight' }) {
  if (tone === 'onDark') return <img src="/brand/logo-dark.png" alt="Snyder Automation" className={cx(logoClass(className), 'block')} draggable={false} />;
  if (tone === 'onLight') return <img src="/brand/logo-light.png" alt="Snyder Automation" className={cx(logoClass(className), 'block')} draggable={false} />;
  return (
    <>
      <img src="/brand/logo-light.png" alt="Snyder Automation" className={cx(logoClass(className), 'block dark:hidden')} draggable={false} />
      <img src="/brand/logo-dark.png" alt="Snyder Automation" className={cx(logoClass(className), 'hidden dark:block')} draggable={false} />
    </>
  );
}

/** Calendar/gear mark only. */
export function Mark({ className }: { className?: string }) {
  return <img src="/brand/mark.png" alt="" aria-hidden className={cx('h-6 w-auto select-none', className)} draggable={false} />;
}

/** Full-screen branded loader shown while the session loads. */
export function BrandSplash({ label = 'Loading your workspace' }: { label?: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-bg" role="status" aria-label={label}>
      <div className="flex flex-col items-center gap-6 animate-fade-in">
        <Logo className="h-14 animate-float" />
        <div className="h-1 w-48 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full w-1/3 rounded-full bg-primary animate-progress" />
        </div>
        <p className="text-sm text-muted">{label}…</p>
      </div>
    </div>
  );
}
