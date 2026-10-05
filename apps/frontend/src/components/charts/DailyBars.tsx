import { DateTime } from 'luxon';
import { useState } from 'react';

/** Single-series daily bar chart with a per-bar hover tooltip. Title names the series (no legend). */
export function DailyBars({ data, label, format = (n) => String(n) }: { data: { day: string; value: number }[]; label: string; format?: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <p className="text-sm text-muted">No data in this range.</p>;
  const max = Math.max(1, ...data.map((d) => d.value));
  const h = 160;
  const barW = 100 / data.length;
  const labelEvery = Math.ceil(data.length / 6);
  return (
    <div className="relative">
      <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" className="h-40 w-full" role="img" aria-label={label}>
        <line x1="0" x2="100" y1={h} y2={h} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {data.map((d, i) => {
          const bh = (d.value / max) * (h - 8);
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* Full-height hit target, larger than the mark. */}
              <rect x={i * barW} y={0} width={barW} height={h} fill="transparent" />
              <rect
                x={i * barW + barW * 0.15}
                y={h - bh}
                width={barW * 0.7}
                height={bh}
                rx={Math.min(1.2, barW * 0.2)}
                fill="var(--primary)"
                opacity={hover === null || hover === i ? 1 : 0.45}
                className="bar-grow"
                style={{ animationDelay: `${Math.min(i, 30) * 12}ms`, transition: 'opacity 150ms' }}
              />
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex text-[10px] text-muted">
        {data.map((d, i) => (
          <span key={d.day} style={{ width: `${barW}%` }} className="text-center truncate">
            {i % labelEvery === 0 ? DateTime.fromISO(d.day).toFormat('LLL d') : ''}
          </span>
        ))}
      </div>
      {hover !== null && data[hover] && (
        <div
          className="pointer-events-none absolute -top-2 rounded-md border border-border bg-surface px-2 py-1 text-xs shadow animate-fade-in"
          style={{ left: `min(calc(${(hover + 0.5) * barW}% - 40px), calc(100% - 90px))` }}
        >
          <div className="text-muted">{DateTime.fromISO(data[hover].day).toFormat('ccc, LLL d')}</div>
          <div className="font-medium">{format(data[hover].value)} {label.toLowerCase()}</div>
        </div>
      )}
    </div>
  );
}
