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
      className="rounded-lg border border-border bg-surface p-4 animate-fade-up transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-sm"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{typeof value === 'number' ? <Animated value={value} format={format} /> : value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}
