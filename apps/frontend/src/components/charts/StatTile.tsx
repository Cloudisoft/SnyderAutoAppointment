import type { ReactNode } from 'react';
import { useCountUp } from '../../lib/useCountUp';
import { Sparkline } from './AreaTrend';

function Animated({ value, format }: { value: number; format?: (n: number) => string }) {
  const n = useCountUp(value, 900);
  return <>{format ? format(n) : Math.round(n).toLocaleString()}</>;
}

/** Change vs the previous period, with an arrow so it never relies on color alone. */
function Delta({ current, previous, invert }: { current: number; previous: number; invert?: boolean }) {
  if (!Number.isFinite(previous) || previous <= 0) return current > 0 ? <span className="text-xs font-semibold text-muted">New</span> : null;
  const change = (current - previous) / previous;
  if (Math.abs(change) < 0.005) return <span className="text-xs font-semibold text-muted">→ 0%</span>;
  const up = change > 0;
  const good = invert ? !up : up;
  return (
    <span className={`inline-flex items-center gap-0.5 whitespace-nowrap rounded-full px-1.5 py-0.5 text-xs font-semibold ${good ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`} title="Compared with the previous period">
      {up ? '▲' : '▼'} {Math.abs(change * 100).toFixed(Math.abs(change) < 0.1 ? 1 : 0)}%
    </span>
  );
}

export function StatTile({
  label,
  value,
  hint,
  format,
  index = 0,
  previous,
  trend,
  icon,
}: {
  label: string;
  value: ReactNode | number;
  hint?: ReactNode;
  /** Formats animated numeric values. */
  format?: (n: number) => string;
  /** Position in a row, for a staggered entrance. */
  index?: number;
  /** Same metric for the previous period (shows a trend badge). */
  previous?: number;
  /** Daily values for a sparkline. */
  trend?: number[];
  icon?: ReactNode;
}) {
  return (
    <div
      className="group relative overflow-hidden rounded-2xl border border-border bg-surface p-4 animate-page-in lift"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <span aria-hidden className="absolute inset-x-0 top-0 h-1 origin-left scale-x-0 bg-primary transition-transform duration-300 group-hover:scale-x-100" />
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
        {icon && <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary-soft text-primary transition-transform duration-300 group-hover:rotate-6 group-hover:scale-110">{icon}</span>}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="font-display text-2xl font-extrabold tabular-nums sm:text-3xl">{typeof value === 'number' ? <Animated value={value} format={format} /> : value}</p>
        {typeof value === 'number' && previous !== undefined && <Delta current={value} previous={previous} />}
      </div>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      {trend && trend.length > 1 && <div className="mt-2 -mx-1 opacity-90">{<Sparkline values={trend} />}</div>}
    </div>
  );
}
