import type { ReactNode } from 'react';
import { useCountUp } from '../../lib/useCountUp';

function Animated({ value, format }: { value: number; format?: (n: number) => string }) {
  const n = useCountUp(value);
  return <>{format ? format(n) : Math.round(n).toLocaleString()}</>;
}

export function StatTile({
  label,
  value,
  hint,
  format,
  index = 0,
}: {
  label: string;
  value: ReactNode | number;
  hint?: ReactNode;
  /** Formats animated numeric values. */
  format?: (n: number) => string;
  /** Position in a row, for a staggered entrance. */
  index?: number;
}) {
  return (
    <div
      className="group relative overflow-hidden rounded-xl border border-border bg-surface p-4 animate-page-in lift"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <span aria-hidden className="absolute inset-x-0 top-0 h-1 origin-left scale-x-0 bg-primary transition-transform duration-300 group-hover:scale-x-100" />
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-display text-3xl font-extrabold tabular-nums">{typeof value === 'number' ? <Animated value={value} format={format} /> : value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}
