import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../../components/Brand';
import { CallDemo } from './CallDemo';
import './landing.css';

const SIGNUP = '/login?mode=signup';

/** Product reels (vertical 9:16), served from apps/frontend/public/videos/. */
const VIDEOS = [
  { src: '/videos/snyder-reel-01-books-the-meeting.mp4', poster: '/videos/snyder-reel-01-books-the-meeting.jpg', title: 'It books the meeting', caption: 'Most AI callers stop at hello. This one finishes the job.' },
  { src: '/videos/snyder-reel-02-instant-confirmations.mp4', poster: '/videos/snyder-reel-02-instant-confirmations.jpg', title: 'Instant confirmations', caption: 'Calendar invite, meeting link and reminders — the second they say yes.' },
  { src: '/videos/snyder-reel-03-live-monitor.mp4', poster: '/videos/snyder-reel-03-live-monitor.jpg', title: 'Live monitor', caption: 'Listen in to any call, take over, or hand off to your team.' },
];

/** Reveals elements with the `lp-reveal` class as they scroll into view. */
function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.lp .lp-reveal'));
    const showAll = () => els.forEach((el) => el.classList.add('lp-in'));

    // Avoid delaying content for visitors who prefer reduced motion or browsers
    // that do not support IntersectionObserver.
    if (
      !('IntersectionObserver' in window) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      showAll();
      return;
    }

    const io = new IntersectionObserver(
      (entries) => entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('lp-in');
          io.unobserve(entry.target);
        }
      }),
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

export function LandingPage() {
  useReveal();
  useEffect(() => {
    const prev = document.title;
    document.title = 'Snyder Auto Appointment — AI calls that book real meetings';
    return () => { document.title = prev; };
  }, []);

  return (
    <div className="lp min-h-screen overflow-x-clip bg-[#090D0D] text-white">
      <Nav />
      <Hero />
      <Marquee />
      <section id="demo" className="relative mx-auto max-w-6xl px-4 py-20 sm:py-28">
        <SectionHead kicker="01 · Hear it" title={<>Hear an appointment <Grad>get booked</Grad>.</>}>
          Press play and listen to the AI agent talk with a real-sounding caller. Watch the transcript, the calendar check, the booking and the invite happen live in one call.
        </SectionHead>
        <div className="lp-reveal mt-12"><CallDemo /></div>
      </section>
      <HowItWorks />
      <Features />
      <Videos />
      <ControlBand />
      <Faq />
      <FinalCta />
      <Footer />
      <MobileCta />
    </div>
  );
}

function Grad({ children }: { children: ReactNode }) {
  return <span className="lp-grad">{children}</span>;
}

function SectionHead({ kicker, title, children, light }: { kicker: string; title: ReactNode; children?: ReactNode; light?: boolean }) {
  return (
    <div className="lp-reveal mx-auto max-w-3xl text-center">
      <p className={`font-mono text-xs uppercase tracking-[0.2em] ${light ? 'text-[#c2410c]' : 'text-[#ff9a52]'}`}>{kicker}</p>
      <h2 className={`mt-3 font-display text-3xl font-extrabold leading-tight sm:text-5xl ${light ? 'text-[#090D0D]' : ''}`}>{title}</h2>
      {children && <p className={`mt-4 text-base sm:text-lg ${light ? 'text-[#4b4540]' : 'text-white/65'}`}>{children}</p>}
    </div>
  );
}

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${scrolled ? 'border-b border-white/10 bg-[#090D0D]/80 backdrop-blur-xl' : 'bg-transparent'}`}>
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
        <Link to="/" aria-label="Snyder Automation home"><Logo tone="onDark" className="h-8 sm:h-9" /></Link>
        <nav className="ml-4 hidden gap-6 text-sm text-white/70 md:flex">
          <a href="#demo" className="transition-colors hover:text-white">Demo</a>
          <a href="#how" className="transition-colors hover:text-white">How it works</a>
          <a href="#features" className="transition-colors hover:text-white">Features</a>
          <a href="#videos" className="transition-colors hover:text-white">Videos</a>
          <a href="#faq" className="transition-colors hover:text-white">FAQ</a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link to="/login" className="rounded-full px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:text-white">Sign in</Link>
          <Link to={SIGNUP} className="lp-btn rounded-full px-4 py-2 text-sm">Start free</Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative isolate overflow-hidden pt-28 sm:pt-36">
      <div aria-hidden className="lp-orb lp-orb-a" />
      <div aria-hidden className="lp-orb lp-orb-b" />
      <div aria-hidden className="lp-grid" />
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 lg:grid-cols-[1.1fr_1fr] lg:pb-28">
        <div>
          <p className="lp-in-1 inline-flex items-center gap-2 rounded-full border border-[#FE5E01]/40 bg-[#FE5E01]/10 px-3 py-1 text-xs font-medium text-[#ffb37a]">
            <span className="lp-live h-2 w-2 rounded-full bg-[#FE5E01]" /> AI calling that books real appointments
          </p>
          <h1 className="lp-in-2 mt-5 font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
            Your leads call back <Grad>booked</Grad>, <br className="hidden sm:block" />
            not “maybe later.”
          </h1>
          <p className="lp-in-3 mt-5 max-w-xl text-lg text-white/70">
            Snyder Auto Appointment calls every lead with a natural-sounding AI agent, finds a time that works, books it on your calendar and sends a branded invite with a Google Meet or Zoom link — before your team has finished their coffee.
          </p>
          <div className="lp-in-4 mt-8 flex flex-wrap items-center gap-3">
            <Link to={SIGNUP} className="lp-btn lp-btn-lg rounded-full px-7 py-3.5 text-base">Start booking free →</Link>
            <a href="#demo" className="group inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3.5 text-base font-medium text-white/90 transition-colors hover:border-white/40 hover:bg-white/5">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-white text-[#090D0D] transition-transform group-hover:scale-110">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5.5v13a1 1 0 001.5.86l11-6.5a1 1 0 000-1.72l-11-6.5A1 1 0 007 5.5z" /></svg>
              </span>
              Hear a sample call
            </a>
          </div>
          <div className="lp-in-5 mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/55">
            <span>✓ No code setup</span>
            <span>✓ Google Calendar, Meet & Zoom</span>
            <span>✓ Every call recorded & transcribed</span>
          </div>
        </div>
        <HeroScene />
      </div>
    </section>
  );
}

/** Looping motion graphic: a live call turns into a calendar booking and an emailed invite. */
function HeroScene() {
  return (
    <div className="lp-scene relative mx-auto h-[440px] w-full max-w-[480px]" aria-hidden>
      {/* Call card */}
      <div className="lp-card lp-call absolute left-0 top-4 w-[78%] rounded-2xl border border-white/10 bg-[#121416]/90 p-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="lp-ring relative grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-[#FE5E01] to-[#ff9a52] font-display font-extrabold text-[#090D0D]">A</div>
          <div>
            <p className="text-sm font-semibold">Ava · AI agent</p>
            <p className="text-xs text-[#4ade80]">● On call with Jordan · 00:42</p>
          </div>
        </div>
        <div className="mt-3 flex h-8 items-center gap-[3px]">
          {Array.from({ length: 30 }, (_, i) => (
            <span key={i} className="lp-bar lp-bar-on block flex-1 rounded-full bg-[#FE5E01]" style={{ height: `${30 + Math.abs(Math.sin(i * 1.3)) * 70}%`, animationDelay: `${(i % 10) * 80}ms` }} />
          ))}
        </div>
        <p className="mt-3 rounded-xl bg-white/[0.06] px-3 py-2 text-xs text-white/80">“Tuesday at 10:30 works — I’ve booked it for you.”</p>
      </div>

      {/* Connector */}
      <svg className="absolute left-[38%] top-[150px] h-[90px] w-[120px]" viewBox="0 0 120 90" fill="none">
        <path d="M2 2 C 2 60, 118 30, 118 88" stroke="url(#lpg)" strokeWidth="2" strokeDasharray="6 6" className="lp-dash" />
        <defs><linearGradient id="lpg" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#FE5E01" /><stop offset="1" stopColor="#ffb37a" /></linearGradient></defs>
      </svg>

      {/* Calendar card */}
      <div className="lp-card lp-cal absolute right-0 top-[220px] w-[72%] rounded-2xl border border-white/10 bg-white p-4 text-[#090D0D] shadow-2xl">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold">Tuesday</p>
          <p className="text-xs text-[#6b6560]">Recruiter calendar</p>
        </div>
        <div className="mt-3 space-y-1.5">
          {['9:00', '9:30', '10:00'].map((t) => <div key={t} className="flex items-center gap-2 text-xs text-[#6b6560]"><span className="w-10">{t}</span><span className="h-6 flex-1 rounded-md bg-[#f5f1ed]" /></div>)}
          <div className="flex items-center gap-2 text-xs"><span className="w-10 text-[#6b6560]">10:30</span><span className="lp-slot flex h-8 flex-1 items-center rounded-md bg-[#FE5E01] px-2 font-semibold text-[#090D0D]">Interview · Jordan B. · Meet</span></div>
          {['11:00'].map((t) => <div key={t} className="flex items-center gap-2 text-xs text-[#6b6560]"><span className="w-10">{t}</span><span className="h-6 flex-1 rounded-md bg-[#f5f1ed]" /></div>)}
        </div>
      </div>

      {/* Invite toast */}
      <div className="lp-card lp-toast absolute -bottom-2 left-2 flex w-[70%] items-center gap-3 rounded-2xl border border-[#4ade80]/30 bg-[#0f1a13]/95 p-3 backdrop-blur">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#4ade80] text-[#08130c]">✓</span>
        <div>
          <p className="text-sm font-semibold">Invite sent to Jordan</p>
          <p className="text-xs text-white/60">Google Meet link · SMS reminder scheduled</p>
        </div>
      </div>
    </div>
  );
}

function Marquee() {
  const items = ['Google Calendar', 'Google Meet', 'Zoom', 'Twilio numbers', 'Branded email', 'SMS reminders', 'CSV lead lists', 'MP3 recordings', 'Live transcripts', 'Role-based access'];
  const renderItems = (prefix: string) => items.map((t, i) => (
    <span key={`${prefix}-${i}`} className="inline-flex shrink-0 items-center gap-3">
      <span className="h-1.5 w-1.5 rounded-full bg-[#FE5E01]" />{t}
    </span>
  ));
  return (
    <div className="relative overflow-hidden border-y border-white/10 bg-white/[0.02] py-5" aria-label="Platform integrations and features">
      <div className="lp-marquee flex w-max whitespace-nowrap text-sm font-medium text-white/50" aria-hidden="true">
        <div className="lp-marquee-group flex shrink-0 items-center gap-10 pr-10">{renderItems('first')}</div>
        <div className="lp-marquee-group flex shrink-0 items-center gap-10 pr-10">{renderItems('second')}</div>
      </div>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    { n: '01', title: 'Upload your leads', body: 'Drop in a CSV from any CRM or spreadsheet. Phones are cleaned, lists created, and custom fields kept.', chip: '1,240 leads imported ✓' },
    { n: '02', title: 'The AI agent calls', body: 'Natural voice, your script, your calling hours in each lead’s time zone. It qualifies, answers questions and offers real open slots.', chip: 'Campaign running · 6 live calls' },
    { n: '03', title: 'Meetings land on your calendar', body: 'Booked straight into Google Calendar with a Meet or Zoom link, a branded email invite and reminders — automatically.', chip: 'Tue 10:30 · Invite sent ✓' },
  ];
  return (
    <section id="how" className="relative bg-[#fbf8f5] py-20 text-[#090D0D] sm:py-28">
      <div className="mx-auto max-w-6xl px-4">
        <SectionHead light kicker="02 · How it works" title={<>From spreadsheet to <span className="text-[#FE5E01]">booked</span> in an afternoon.</>}>
          Three steps. No dialers, no chasing, no back-and-forth emails.
        </SectionHead>
        <div className="relative mt-14 grid gap-6 md:grid-cols-3">
          <div aria-hidden className="lp-track absolute left-[16%] right-[16%] top-10 hidden h-0.5 md:block" />
          {steps.map((s, i) => (
            <div key={s.n} className="lp-reveal relative rounded-3xl border border-[#e9e3dd] bg-white p-6 shadow-[0_20px_50px_-30px_rgb(9_13_13/0.25)] transition-shadow duration-300 hover:shadow-[0_30px_60px_-30px_rgb(254_94_1/0.45)]" style={{ transitionDelay: `${i * 120}ms` }}>
              <span className="relative z-10 grid h-12 w-12 place-items-center rounded-2xl bg-[#090D0D] font-display font-extrabold text-[#FE5E01]">{s.n}</span>
              <h3 className="mt-5 font-display text-xl font-extrabold">{s.title}</h3>
              <p className="mt-2 text-[#4b4540]">{s.body}</p>
              <p className="mt-5 inline-flex rounded-full bg-[#FE5E01]/10 px-3 py-1 font-mono text-xs text-[#c2410c]">{s.chip}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const FEATURES: { icon: string; title: string; body: string; tag: string }[] = [
  { icon: 'M3 5a2 2 0 012-2h3.28a1 1 0 01.95.68l1.5 4.49a1 1 0 01-.5 1.21l-2.26 1.13a11 11 0 005.52 5.52l1.13-2.26a1 1 0 011.21-.5l4.49 1.5a1 1 0 01.68.95V19a2 2 0 01-2 2h-1C9.72 21 3 14.28 3 6V5z', title: 'AI outbound campaigns', body: 'Natural, human-sounding agents call your lists with pacing, retries, concurrency limits and calling hours in each lead’s local time.', tag: 'CALL' },
  { icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', title: 'Automatic booking', body: 'The agent offers real open slots and books the appointment the moment the caller agrees — no double bookings.', tag: 'BOOK' },
  { icon: 'M15 10l4.55-2.28A1 1 0 0121 8.62v6.76a1 1 0 01-1.45.9L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z', title: 'Google Meet & Zoom', body: 'Connect Google or Zoom once. Every booking gets its own meeting link, created and kept in sync automatically.', tag: 'MEET' },
  { icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z', title: 'Branded invites & reminders', body: 'Beautiful emails with your logo for confirmations, reminders and reschedules, plus SMS reminders with built-in STOP opt-out.', tag: 'EMAIL' },
  { icon: 'M15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14M11 5L6 9H2v6h4l5 4V5z', title: 'Live listen & control', body: 'Supervisors hear any call live in the browser, and can speak, end or redirect it from the Live Monitor.', tag: 'LIVE' },
  { icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4', title: 'Instant human handoff', body: '“Let me transfer your call” — the agent hands off to your team in the same breath when a caller asks for a person.', tag: 'TRANSFER' },
  { icon: 'M5 13l4 4L19 7', title: 'Smart call endings', body: 'Calls end politely and automatically once the conversation is done. No dead air, no wasted minutes.', tag: 'END' },
  { icon: 'M9 19V6l12-3v13M9 19c0 1.1-1.34 2-3 2s-3-.9-3-2 1.34-2 3-2 3 .9 3 2zm12-3c0 1.1-1.34 2-3 2s-3-.9-3-2 1.34-2 3-2 3 .9 3 2z', title: 'HD recordings & transcripts', body: 'Every call recorded in high-quality MP3 with a full transcript and summary, playable right in the call record.', tag: 'RECORD' },
  { icon: 'M4 6h16M4 10h16M4 14h16M4 18h16', title: 'Call records (CDR)', body: 'Search, filter and export every call with outcome, duration and recording links. Bulk select, delete and download.', tag: 'CDR' },
  { icon: 'M7 16a4 4 0 01-.88-7.9A5 5 0 1115.9 6h.1a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12', title: 'Lead lists & import', body: 'Import CSVs from any tool — Excel formats, odd headers and messy phone numbers handled. Move, tag and bulk-edit leads.', tag: 'LEADS' },
  { icon: 'M11 3.06A9 9 0 1020.94 13H11V3.06zM15 3.34A9 9 0 0120.66 9H15V3.34z', title: 'Dashboard & analytics', body: 'Calls, connects, bookings, show rates and trends against the previous period — at a glance.', tag: 'INSIGHT' },
  { icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z', title: 'Reschedule & no-show', body: 'Leads reschedule from a secure link. No-shows are detected automatically so your team can follow up.', tag: 'FOLLOW-UP' },
  { icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z', title: 'Roles & permissions', body: 'Owners, admins, managers and viewers — each sees exactly what they should. Multi-organization ready.', tag: 'ACCESS' },
  { icon: 'M4 4v5h.58m15.36 2A8 8 0 004.58 9m0 0H9m11 11v-5h-.58m0 0a8 8 0 01-15.36-2m15.36 2H15', title: 'Dispositions & retries', body: 'Every outcome is tagged — booked, callback, not interested — and retries follow the rules you set.', tag: 'RETRY' },
  { icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10', title: 'Your numbers, your voice', body: 'Bring your Twilio numbers, choose voices, and tune the agent’s script, persona and goals per campaign.', tag: 'SETUP' },
  { icon: 'M9 12l2 2 4-4m5.62-4.02A12 12 0 0112 2.94a12 12 0 01-8.62 3.04A12 12 0 003 9c0 5.59 3.82 10.29 9 11.62 5.18-1.33 9-6.03 9-11.62 0-1.04-.13-2.05-.38-3.02z', title: 'Private by design', body: 'Data isolated per organization, signed expiring recording links, and secrets kept in an encrypted vault.', tag: 'SECURE' },
];

function Features() {
  return (
    <section id="features" className="relative mx-auto max-w-6xl px-4 py-20 sm:py-28">
      <SectionHead kicker="03 · Features" title={<>Everything between <Grad>“hello”</Grad> and a booked meeting.</>}>
        One platform for calling, booking, reminding and reporting — built for staffing and recruiting teams.
      </SectionHead>
      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f, i) => (
          <div key={f.title} className="lp-reveal lp-feature group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-5" style={{ transitionDelay: `${(i % 4) * 80}ms` }}>
            <div className="flex items-center justify-between">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#FE5E01]/15 text-[#FE5E01] transition-transform duration-300 group-hover:rotate-6 group-hover:scale-110">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={f.icon} /></svg>
              </span>
              <span className="font-mono text-[10px] tracking-wider text-white/35">{f.tag}</span>
            </div>
            <h3 className="mt-4 font-semibold">{f.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-white/60">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Videos() {
  return (
    <section id="videos" className="relative overflow-hidden bg-[#fbf8f5] py-20 text-[#090D0D] sm:py-28">
      <div className="mx-auto max-w-6xl px-4">
        <SectionHead light kicker="04 · Watch" title={<>See Snyder Auto Appointment <span className="text-[#FE5E01]">in action</span>.</>}>
          Three quick reels — 25 seconds each.
        </SectionHead>
        <div className="mt-14 grid justify-items-center gap-10 sm:grid-cols-3 sm:gap-6">
          {VIDEOS.map((v, i) => <Reel key={v.src} {...v} index={i} />)}
        </div>
      </div>
    </section>
  );
}

/** A vertical reel in a phone frame. Tapping plays with sound; only one reel plays at a time. */
function Reel({ src, poster, title, caption, index }: { src: string; poster: string; title: string; caption: string; index: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) {
      document.querySelectorAll<HTMLVideoElement>('video[data-reel]').forEach((o) => o !== v && o.pause());
      void v.play();
    } else v.pause();
  };
  return (
    <figure className="lp-reveal w-full max-w-[280px]" style={{ transitionDelay: `${index * 120}ms` }}>
      <div className={`lp-phone relative rounded-[2.4rem] bg-[#090D0D] p-2.5 shadow-[0_30px_70px_-25px_rgb(9_13_13/0.55)] transition-transform duration-500 ${playing ? 'scale-[1.02]' : 'hover:-rotate-1'}`}>
        <div className="relative aspect-[9/16] overflow-hidden rounded-[1.9rem] bg-[#131a2e]">
          <video
            ref={ref}
            data-reel
            src={src}
            poster={poster}
            playsInline
            preload="none"
            controls={playing}
            className="h-full w-full object-cover"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />
          {!playing && (
            <button onClick={toggle} className="group absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/70 via-transparent to-transparent pb-8" aria-label={`Play: ${title}`}>
              <span className="lp-play-hint inline-flex items-center gap-2 rounded-full bg-[#FE5E01] py-2.5 pl-3 pr-5 font-semibold text-[#090D0D] transition-transform duration-200 group-hover:scale-105">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-[#090D0D] text-[#FE5E01]">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="translate-x-px"><path d="M7 5.5v13a1 1 0 001.5.86l11-6.5a1 1 0 000-1.72l-11-6.5A1 1 0 007 5.5z" /></svg>
                </span>
                Watch
              </span>
            </button>
          )}
          <span aria-hidden className="absolute left-1/2 top-2 h-5 w-20 -translate-x-1/2 rounded-full bg-[#090D0D]" />
        </div>
      </div>
      <figcaption className="mt-5 text-center">
        <p className="font-display text-lg font-extrabold">{title}</p>
        <p className="mt-1 text-sm text-[#4b4540]">{caption}</p>
      </figcaption>
    </figure>
  );
}

function ControlBand() {
  const facts = [
    { value: 24, suffix: '/7', label: 'Campaigns run on your schedule' },
    { value: 2, suffix: '', label: 'Meeting platforms: Google Meet & Zoom' },
    { value: 100, suffix: '%', label: 'Of calls recorded & transcribed' },
    { value: 60, suffix: 's', label: 'From “yes” to invite in the inbox' },
  ];
  return (
    <section className="relative overflow-hidden border-y border-white/10 py-16">
      <div aria-hidden className="lp-orb lp-orb-c" />
      <div className="relative mx-auto grid max-w-6xl gap-8 px-4 sm:grid-cols-2 lg:grid-cols-4">
        {facts.map((f) => (
          <div key={f.label} className="lp-reveal text-center">
            <p className="font-display text-5xl font-extrabold text-white"><CountUp to={f.value} />{f.suffix && <span className="text-[#FE5E01]">{f.suffix}</span>}</p>
            <p className="mt-2 text-sm text-white/60">{f.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CountUp({ to }: { to: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
      setN(to);
      return;
    }
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - start) / 1200);
        setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [to]);
  return <span ref={ref} className="inline-grid tabular-nums"><span className="invisible col-start-1 row-start-1">{to}</span><span className="col-start-1 row-start-1">{n}</span></span>;
}

function Faq() {
  const items = [
    { q: 'Does it really sound human?', a: 'Yes. Agents use natural, expressive voices with fast responses, handle interruptions, and follow your script and tone. Press play on the demo above to hear the flow of a real booking call.' },
    { q: 'Which calendars and meeting tools does it work with?', a: 'Bookings go into Google Calendar, with Google Meet or Zoom links created automatically. Connect your accounts once in Settings → Integrations.' },
    { q: 'What happens when someone wants to talk to a person?', a: 'The agent transfers the call to your team immediately. Supervisors can also listen to any live call and take control from the Live Monitor.' },
    { q: 'Do my leads get reminders?', a: 'Yes — branded email confirmations and reminders with your logo and the meeting link, plus SMS reminders. Leads can reschedule from a secure link, and opt-outs are honored automatically.' },
    { q: 'How do I bring in my leads?', a: 'Upload a CSV exported from your CRM or spreadsheet. Common Excel quirks — semicolon files, “Mobile Phone” columns, numbers in scientific notation — are handled for you.' },
    { q: 'Is our data safe?', a: 'Each organization’s data is isolated, recordings use signed expiring links, roles control who sees what, and credentials are stored in an encrypted vault.' },
  ];
  return (
    <section id="faq" className="relative mx-auto max-w-3xl px-4 py-20 sm:py-28">
      <SectionHead kicker="05 · FAQ" title={<>Questions, <Grad>answered</Grad>.</>} />
      <div className="mt-10 space-y-3">
        {items.map((it) => (
          <details key={it.q} className="lp-reveal lp-faq group rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 open:border-[#FE5E01]/40 open:bg-[#FE5E01]/[0.06]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
              {it.q}
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/15 text-[#FE5E01] transition-transform duration-300 group-open:rotate-45">+</span>
            </summary>
            <p className="mt-3 text-white/65">{it.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== 'undefined' ? window.location.origin : '';
  const text = 'This AI calls our leads and books the meetings straight into the calendar 🤯 — Snyder Auto Appointment';
  const share = [
    { label: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}` },
    { label: 'X', href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}` },
    { label: 'WhatsApp', href: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}` },
    { label: 'Email', href: `mailto:?subject=${encodeURIComponent('You need to see this')}&body=${encodeURIComponent(`${text}\n\n${url}`)}` },
  ];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link', url);
    }
  };
  return (
    <section className="relative px-4 pb-24">
      <div className="lp-reveal lp-cta relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] p-8 text-center sm:p-16">
        <div aria-hidden className="lp-cta-rings" />
        <img src="/brand/mark-dark.png" alt="" aria-hidden className="lp-float relative mx-auto h-16 w-auto" />
        <h2 className="relative mt-6 font-display text-4xl font-extrabold leading-tight text-[#090D0D] sm:text-6xl">
          Stop chasing leads.<br />Start filling calendars.
        </h2>
        <p className="relative mx-auto mt-4 max-w-xl text-lg text-[#090D0D]/75">
          Set up your first AI calling campaign in minutes. Your next booked meeting could be one phone call away.
        </p>
        <div className="relative mt-8 flex flex-wrap justify-center gap-3">
          <Link to={SIGNUP} className="lp-btn-dark rounded-full px-8 py-4 text-base font-bold">Get started — it’s free →</Link>
          <Link to="/login" className="rounded-full border-2 border-[#090D0D] px-8 py-4 text-base font-bold text-[#090D0D] transition-colors hover:bg-[#090D0D] hover:text-white">Sign in</Link>
        </div>
        <div className="relative mt-10">
          <p className="text-sm font-semibold text-[#090D0D]/70">Know a team drowning in follow-ups? Send them this.</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <button onClick={() => void copy()} className="rounded-full bg-[#090D0D]/10 px-4 py-2 text-sm font-semibold text-[#090D0D] transition-colors hover:bg-[#090D0D] hover:text-white">
              {copied ? '✓ Link copied' : '🔗 Copy link'}
            </button>
            {share.map((s) => (
              <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer" className="rounded-full bg-[#090D0D]/10 px-4 py-2 text-sm font-semibold text-[#090D0D] transition-colors hover:bg-[#090D0D] hover:text-white">
                {s.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/10 px-4 py-10 pb-28 md:pb-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-white/50 md:flex-row">
        <Logo tone="onDark" className="h-8" />
        <p>© {new Date().getFullYear()} Snyder Automation · AI calls that book real appointments.</p>
        <div className="flex gap-5">
          <Link to="/login" className="hover:text-white">Sign in</Link>
          <a href="#features" className="hover:text-white">Features</a>
          <a href="mailto:info@cloudisoft.com" className="hover:text-white">Contact</a>
        </div>
      </div>
    </footer>
  );
}

/** Sticky sign-up bar on phones once the hero is out of view. */
function MobileCta() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > 600);
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <div className={`fixed inset-x-3 bottom-3 z-40 transition-all duration-300 md:hidden ${show ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-6 opacity-0'}`}>
      <Link to={SIGNUP} className="lp-btn flex items-center justify-center rounded-full py-3.5 text-base shadow-2xl">Start booking free →</Link>
    </div>
  );
}
