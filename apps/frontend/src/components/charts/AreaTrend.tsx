import { DateTime } from 'luxon';
import { useId, useMemo, useRef, useState } from 'react';

/** Smooth path through points (monotone-ish cubic) in a 0..W x 0..H box. */
function smoothPath(pts: [number, number][]): string {
  if (!pts.length) return '';
  if (pts.length === 1) return `M${pts[0]![0]},${pts[0]![1]}`;
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!;
    const [x1, y1] = pts[i]!;
    const cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return d;
}

/** Axis top as 4 × a round step (1, 2, 2.5, 5 × 10^k), so every gridline label is a clean number. */
const niceMax = (v: number) => {
  if (v <= 4) return 4;
  const raw = v / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= raw && (x >= 1 ? Number.isInteger(x) : true)) ?? 10 * p;
  return Math.ceil(step) * 4;
};

/**
 * Single-series area chart (title names the series, so no legend). Draws in on mount; hovering
 * shows a crosshair, a marker and a tooltip for the nearest day.
 */
export function AreaTrend({ data, label, height = 220 }: { data: { day: string; value: number }[]; label: string; height?: number }) {
  const id = useId().replace(/:/g, '');
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000;
  const H = height;
  const padTop = 12;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const pts = useMemo<[number, number][]>(
    () => data.map((d, i) => [data.length === 1 ? W / 2 : (i / (data.length - 1)) * W, padTop + (1 - d.value / max) * (H - padTop)]),
    [data, max, H],
  );
  if (!data.length) return <p className="py-10 text-center text-sm text-muted">No calls in this range yet.</p>;
  const line = smoothPath(pts);
  const area = `${line} L${pts[pts.length - 1]![0]},${H} L${pts[0]![0]},${H} Z`;
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));
  const grid = [0.25, 0.5, 0.75, 1];

  function onMove(e: React.PointerEvent) {
    const rect = box.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i]![0] - x) < Math.abs(pts[best]![0] - x)) best = i;
    setHover(best);
  }
  const hp = hover !== null ? pts[hover] : null;

  return (
    <div className="relative select-none">
      <div className="flex">
        <div className="flex w-8 shrink-0 flex-col justify-between pb-6 pr-2 text-right text-[10px] tabular-nums text-muted" style={{ height }}>
          {[...grid].reverse().map((g) => <span key={g}>{Math.round(max * g)}</span>)}
          <span>0</span>
        </div>
        <div className="min-w-0 flex-1">
          <div ref={box} className="relative" style={{ height }} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" role="img" aria-label={`${label} per day`}>
              <defs>
                <linearGradient id={`fill-${id}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {grid.map((g) => (
                <line key={g} x1="0" x2={W} y1={padTop + (1 - g) * (H - padTop)} y2={padTop + (1 - g) * (H - padTop)} stroke="var(--border)" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
              ))}
              <line x1="0" x2={W} y1={H} y2={H} stroke="var(--border)" vectorEffect="non-scaling-stroke" />
              <path d={area} fill={`url(#fill-${id})`} className="animate-fade-in" style={{ animationDuration: '700ms' }} />
              <path d={line} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" pathLength={1} className="draw-line" />
              {hp && <line x1={hp[0]} x2={hp[0]} y1={0} y2={H} stroke="var(--muted)" strokeOpacity="0.5" vectorEffect="non-scaling-stroke" />}
            </svg>
            {hp && (
              <>
                <span
                  className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--surface)] bg-primary shadow"
                  style={{ left: `${(hp[0] / W) * 100}%`, top: `${(hp[1] / H) * 100}%` }}
                />
                <div
                  className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg animate-fade-in"
                  style={{ left: `clamp(60px, ${(hp[0] / W) * 100}%, calc(100% - 60px))`, top: Math.max(0, (hp[1] / H) * height - 64) }}
                >
                  <div className="text-muted">{DateTime.fromISO(data[hover!]!.day).toFormat('ccc, LLL d')}</div>
                  <div className="font-display text-base font-bold tabular-nums">{data[hover!]!.value.toLocaleString()} <span className="text-xs font-medium text-muted">{label.toLowerCase()}</span></div>
                </div>
              </>
            )}
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-muted">
            {data.map((d, i) => (i % labelEvery === 0 || i === data.length - 1 ? <span key={d.day}>{DateTime.fromISO(d.day).toFormat('LLL d')}</span> : null))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Tiny trend line for KPI tiles (decorative; the tile carries the number). */
export function Sparkline({ values }: { values: number[] }) {
  const id = useId().replace(/:/g, '');
  if (values.length < 2) return null;
  const W = 100;
  const H = 28;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i): [number, number] => [(i / (values.length - 1)) * W, 2 + (1 - v / max) * (H - 4)]);
  const line = smoothPath(pts);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-8 w-full" aria-hidden>
      <defs>
        <linearGradient id={`sp-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#sp-${id})`} />
      <path d={line} fill="none" stroke="var(--primary)" strokeWidth="1.75" vectorEffect="non-scaling-stroke" pathLength={1} className="draw-line" />
    </svg>
  );
}
