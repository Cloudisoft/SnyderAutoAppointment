import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../../components/Brand';

export const CONTACT = {
  email: 'info@snyderstaffing.com',
  phone: '+1 (941) 940-9896',
  phoneHref: 'tel:+19419409896',
  hours: 'Monday–Friday, 9:00 AM–6:00 PM Eastern',
};

const NAV = [
  { to: '/docs/zoom', label: 'Zoom guide' },
  { to: '/support', label: 'Support' },
  { to: '/privacy', label: 'Privacy' },
  { to: '/terms', label: 'Terms' },
];

/** Plain, readable layout for the public legal, support and documentation pages. */
export function LegalLayout({ title, updated, intro, children }: { title: string; updated?: string; intro?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} · Snyder Automation`;
    window.scrollTo(0, 0);
    return () => { document.title = prev; };
  }, [title]);

  return (
    <div className="min-h-screen bg-[#fbf8f5] text-[#090D0D]">
      <header className="border-b border-[#e9e3dd] bg-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4">
          <Link to="/" aria-label="Snyder Automation home"><Logo tone="onLight" className="h-9" /></Link>
          <nav className="ml-auto flex flex-wrap gap-x-5 gap-y-2 text-sm text-[#4b4540]">
            {NAV.map((n) => <Link key={n.to} to={n.to} className="hover:text-[#c2410c]">{n.label}</Link>)}
            <Link to="/login" className="font-semibold text-[#c2410c] hover:text-[#090D0D]">Sign in</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-10 sm:py-14">
        <h1 className="font-display text-3xl font-extrabold sm:text-4xl">{title}</h1>
        {updated && <p className="mt-2 text-sm text-[#6b6560]">Last updated: {updated}</p>}
        {intro && <div className="mt-5 text-lg leading-8 text-[#4b4540]">{intro}</div>}
        <div className="legal mt-8 space-y-8 leading-7 text-[#2b2724]">{children}</div>
      </main>
      <footer className="border-t border-[#e9e3dd] bg-white">
        <div className="mx-auto flex max-w-4xl flex-col gap-2 px-4 py-6 text-sm text-[#6b6560] sm:flex-row sm:justify-between">
          <p>© {new Date().getFullYear()} Snyder Staffing · Snyder Automation</p>
          <p>
            <a href={`mailto:${CONTACT.email}`} className="hover:text-[#c2410c]">{CONTACT.email}</a> · <a href={CONTACT.phoneHref} className="hover:text-[#c2410c]">{CONTACT.phone}</a>
          </p>
        </div>
      </footer>
    </div>
  );
}

export function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6">
      <h2 className="font-display text-xl font-extrabold">{title}</h2>
      <div className="mt-3 space-y-3 [&_a]:font-medium [&_a]:text-[#c2410c] [&_a:hover]:underline [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ol>li]:list-decimal [&_ul]:space-y-1.5 [&_ol]:space-y-1.5">{children}</div>
    </section>
  );
}
