import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { SCENARIOS, type Scenario } from './scenarios';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const BARS = 48;

/** The sample-call player: real recorded voices, a live waveform, and a transcript synced to the audio. */
export function CallDemo() {
  const [scenarioIdx, setScenarioIdx] = useState(0);
  const scenario = SCENARIOS[scenarioIdx]!;
  const audioRef = useRef<HTMLAudioElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(scenario.lines.at(-1)!.at[1] + 0.5);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const levels = useAnalyser(audioRef, playing);

  // Keep the clock in step with the audio (rAF while playing, so the highlight follows the voice closely).
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      if (audioRef.current) setTime(audioRef.current.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const shownCount = scenario.lines.filter((l) => l.at[0] <= time + 0.05).length;
  const current = scenario.lines.findIndex((l) => time >= l.at[0] && time <= l.at[1] + 0.15);
  const speaking = playing && current >= 0 ? scenario.lines[current]!.who : null;
  const events = scenario.lines.slice(0, shownCount).filter((l) => l.event).map((l) => l.event!).reverse();
  const done = ended || time >= scenario.lines.at(-1)!.at[1];

  // Newest line stays in view inside the transcript box only (never scrolls the page).
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [shownCount]);

  const pick = (i: number) => {
    audioRef.current?.pause();
    setScenarioIdx(i);
    setTime(0);
    setEnded(false);
    setPlaying(false);
  };
  const toggle = async () => {
    const a = audioRef.current;
    if (!a) return;
    if (!a.paused) {
      a.pause();
      return;
    }
    if (done) {
      a.currentTime = 0;
      setTime(0);
      setEnded(false);
    }
    try {
      await a.play();
    } catch {
      setPlaying(false);
    }
  };
  const seek = (e: MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = Math.max(0, Math.min(duration, ((e.clientX - r.left) / r.width) * duration));
    setTime(a.currentTime);
    setEnded(false);
  };

  return (
    <div className="lp-console relative overflow-hidden rounded-3xl border border-white/10 bg-[#0d0f10] text-white shadow-[0_40px_120px_-40px_rgb(254_94_1/0.45)]">
      <audio
        ref={audioRef}
        src={scenario.audio}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setEnded(true); }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || duration)}
        onTimeUpdate={(e) => !playing && setTime(e.currentTarget.currentTime)}
      />

      {/* Window chrome */}
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <span className="ml-3 font-mono text-xs text-white/50">snyder/call-scope</span>
        <span className="ml-auto rounded-full border border-white/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white/60">sample call · English</span>
      </div>

      {/* Scenario tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-white/10 px-3 py-2" role="tablist" aria-label="Sample calls">
        {SCENARIOS.map((s, i) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={i === scenarioIdx}
            onClick={() => pick(i)}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors duration-200 ${i === scenarioIdx ? 'bg-[#FE5E01] font-semibold text-[#090D0D]' : 'text-white/65 hover:bg-white/10 hover:text-white'}`}
          >
            {s.tab}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-[1.35fr_1fr]">
        {/* Player + transcript */}
        <div className="border-b border-white/10 p-4 sm:p-6 lg:border-b-0 lg:border-r">
          <Speakers scenario={scenario} speaking={speaking} />
          <Waveform levels={levels} who={speaking} />

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={() => void toggle()}
              className={`lp-play relative grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#FE5E01] text-[#090D0D] transition-transform duration-200 hover:scale-105 active:scale-95 ${!playing && time === 0 ? 'lp-play-hint' : ''}`}
              aria-label={playing ? 'Pause sample call' : 'Play sample call'}
            >
              {playing ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="translate-x-0.5"><path d="M7 5.5v13a1 1 0 001.5.86l11-6.5a1 1 0 000-1.72l-11-6.5A1 1 0 007 5.5z" /></svg>
              )}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex justify-between font-mono text-xs text-white/55">
                <span>{playing ? (speaking === 'agent' ? `${scenario.agent} (AI) speaking` : speaking === 'caller' ? 'Caller speaking' : 'On call') : done ? 'Call complete' : time > 0 ? 'Paused' : 'Ready'}</span>
                <span>{fmt(time)} / {fmt(duration)}</span>
              </div>
              <div className="group mt-1.5 cursor-pointer py-1" onClick={seek} role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)}>
                <div className="relative h-1.5 rounded-full bg-white/10">
                  {/* Who speaks when: agent turns in orange, caller turns in white. */}
                  {scenario.lines.map((l, i) => (
                    <span key={i} className={`absolute inset-y-0 rounded-full ${l.who === 'agent' ? 'bg-[#FE5E01]/35' : 'bg-white/25'}`} style={{ left: `${(l.at[0] / duration) * 100}%`, width: `${((l.at[1] - l.at[0]) / duration) * 100}%` }} />
                  ))}
                  <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#FE5E01] to-[#ffb37a]" style={{ width: `${Math.min(100, (time / duration) * 100)}%` }} />
                  <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow transition-opacity group-hover:opacity-100" style={{ left: `${Math.min(100, (time / duration) * 100)}%` }} />
                </div>
              </div>
            </div>
          </div>

          <div ref={transcriptRef} className="lp-transcript mt-5 h-72 space-y-3 overflow-y-auto px-2 py-1" aria-live="polite">
            {shownCount === 0 && (
              <div className="grid h-full place-items-center text-center text-sm text-white/50">
                <div>
                  <p className="text-base font-semibold text-white/80">{scenario.summary}</p>
                  <p className="mt-2">Press play to hear the AI agent and the caller.</p>
                </div>
              </div>
            )}
            {scenario.lines.slice(0, shownCount).map((l, i) => (
              <div key={`${scenario.id}-${i}`} className={`lp-line flex ${l.who === 'agent' ? 'justify-start' : 'justify-end'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed transition-shadow duration-300 ${l.who === 'agent' ? 'rounded-tl-sm bg-[#FE5E01]/15 text-white ring-1 ring-[#FE5E01]/30' : 'rounded-tr-sm bg-white/[0.07] text-white/90 ring-1 ring-white/10'} ${i === current && playing ? 'lp-speaking' : ''}`}
                >
                  <span className={`mb-0.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${l.who === 'agent' ? 'text-[#ffb37a]' : 'text-white/45'}`}>
                    {l.who === 'agent' ? `${scenario.agent} · AI agent` : `${scenario.caller} · Caller`}
                    <span className="normal-case tracking-normal text-white/30">{fmt(l.at[0])}</span>
                  </span>
                  {l.text}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Behind the scenes */}
        <div className="flex flex-col p-4 sm:p-6">
          <p className="font-mono text-xs uppercase tracking-wider text-white/45">Behind the scenes</p>
          <div className="mt-3 flex-1 space-y-2.5">
            {events.length === 0 && <p className="text-sm text-white/45">Calendar checks, bookings, invites and reminders appear here the moment they happen on the call.</p>}
            {events.map((e, i) => (
              <div key={`${scenario.id}-${e.label}-${events.length - i}`} className={`lp-event flex gap-3 rounded-xl border p-3 ${i === 0 ? 'border-[#FE5E01]/40 bg-[#FE5E01]/[0.08]' : 'border-white/10 bg-white/[0.03]'}`}>
                <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${e.tone === 'success' ? 'bg-[#4ade80]' : e.tone === 'warn' ? 'bg-[#fbbf24]' : 'bg-[#FE5E01]'}`} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{e.label}</p>
                  <p className="text-xs text-white/55">{e.detail}</p>
                </div>
              </div>
            ))}
          </div>
          <div className={`mt-4 rounded-2xl border p-4 transition-all duration-500 ${done ? 'lp-outcome border-[#4ade80]/40 bg-[#4ade80]/10 opacity-100' : 'border-white/10 bg-white/[0.02] opacity-60'}`}>
            <p className="font-mono text-[10px] uppercase tracking-wider text-white/50">Outcome</p>
            <p className="mt-1 font-semibold">{done ? `✓ ${scenario.outcome}` : 'Waiting for the call to finish…'}</p>
            {done && (
              <Link to="/login?mode=signup" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[#ffb37a] hover:text-white">
                Run this on your own leads →
              </Link>
            )}
          </div>
        </div>
      </div>
      <p className="border-t border-white/10 px-4 py-2 text-center text-[11px] text-white/40">Sample call · synthesized voices · fictional people and businesses</p>
    </div>
  );
}

function Speakers({ scenario, speaking }: { scenario: Scenario; speaking: 'agent' | 'caller' | null }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className={`relative grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#FE5E01] to-[#ff9a52] font-display text-lg font-extrabold text-[#090D0D] transition-transform duration-300 ${speaking === 'agent' ? 'lp-ring scale-105' : ''}`}>
          {scenario.agent[0]}
        </div>
        <div className="min-w-0">
          <p className="truncate font-semibold">{scenario.agent} <span className="font-normal text-white/50">· AI agent</span></p>
          <p className="truncate text-xs text-white/50">{scenario.business}</p>
        </div>
      </div>
      <svg width="28" height="12" viewBox="0 0 28 12" className="hidden shrink-0 text-white/25 sm:block" aria-hidden><path d="M0 6h28M22 1l5 5-5 5M6 1L1 6l5 5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      <div className="flex min-w-0 items-center gap-3 text-right">
        <div className="min-w-0">
          <p className="truncate font-semibold">{scenario.caller}</p>
          <p className="text-xs text-white/50">Human caller</p>
        </div>
        <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/10 font-display text-lg font-extrabold text-white ring-1 ring-white/20 transition-transform duration-300 ${speaking === 'caller' ? 'lp-ring-white scale-105' : ''}`}>
          {scenario.caller[0]}
        </div>
      </div>
    </div>
  );
}

function Waveform({ levels, who }: { levels: number[]; who: 'agent' | 'caller' | null }) {
  return (
    <div className="mt-5 flex h-16 items-center gap-[3px]" aria-hidden>
      {levels.map((v, i) => (
        <span
          key={i}
          className={`block flex-1 rounded-full transition-[height,background-color] duration-75 ${who === 'caller' ? 'bg-white/80' : 'bg-[#FE5E01]'}`}
          style={{ height: `${Math.max(6, v * 100)}%`, opacity: who ? 1 : 0.35 }}
        />
      ))}
    </div>
  );
}

const IDLE = Array.from({ length: BARS }, (_, i) => 0.08 + Math.abs(Math.sin(i * 1.7)) * 0.1);

/** Real-time levels from the playing audio (Web Audio analyser); a gentle idle shape otherwise. */
function useAnalyser(audioRef: React.RefObject<HTMLAudioElement | null>, playing: boolean) {
  const [levels, setLevels] = useState<number[]>(IDLE);
  const graph = useRef<{ ctx: AudioContext; analyser: AnalyserNode; data: Uint8Array<ArrayBuffer> } | null>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!playing || !el) {
      setLevels(IDLE);
      return;
    }
    if (!graph.current) {
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        const src = ctx.createMediaElementSource(el);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        analyser.connect(ctx.destination);
        graph.current = { ctx, analyser, data: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)) };
      } catch {
        graph.current = null;
      }
    }
    const g = graph.current;
    if (!g) return;
    void g.ctx.resume();
    let raf = 0;
    const tick = (now: number) => {
      // Loudness (RMS) of the current voice frame drives a moving, symmetric wave shape.
      g.analyser.getByteTimeDomainData(g.data);
      let sum = 0;
      for (let k = 0; k < g.data.length; k++) {
        const v = (g.data[k]! - 128) / 128;
        sum += v * v;
      }
      const level = Math.min(1, Math.pow(Math.sqrt(sum / g.data.length) * 7, 0.7));
      const t = now / 1000;
      const mid = (BARS - 1) / 2;
      setLevels(
        Array.from({ length: BARS }, (_, i) => {
          const d = Math.abs(i - mid) / mid;
          const envelope = 1 - d * 0.75;
          const motion = 0.45 + 0.55 * Math.abs(Math.sin(i * 0.55 + t * 9) * Math.cos(i * 0.21 - t * 5));
          return Math.max(0.06, level * envelope * motion);
        }),
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, audioRef]);

  useEffect(() => () => { void graph.current?.ctx.close(); }, []);
  return levels;
}
