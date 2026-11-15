import { Link } from 'react-router-dom';
import { CONTACT, LegalLayout, Section } from './LegalLayout';

export function SupportPage() {
  return (
    <LegalLayout
      title="Support"
      intro={<p>Need help with Snyder Automation? Our team answers questions about calling, booking, integrations and your account.</p>}
    >
      <Section title="Contact us">
        <div className="grid gap-4 sm:grid-cols-2">
          <a href={`mailto:${CONTACT.email}?subject=${encodeURIComponent('Snyder Automation support')}`} className="block rounded-2xl border border-[#e9e3dd] bg-white p-5 no-underline hover:border-[#FE5E01]">
            <span className="block text-sm text-[#6b6560]">Email</span>
            <span className="mt-1 block text-lg font-semibold text-[#090D0D]">{CONTACT.email}</span>
            <span className="mt-1 block text-sm text-[#6b6560]">We reply within one business day.</span>
          </a>
          <a href={CONTACT.phoneHref} className="block rounded-2xl border border-[#e9e3dd] bg-white p-5 no-underline hover:border-[#FE5E01]">
            <span className="block text-sm text-[#6b6560]">Phone</span>
            <span className="mt-1 block text-lg font-semibold text-[#090D0D]">{CONTACT.phone}</span>
            <span className="mt-1 block text-sm text-[#6b6560]">{CONTACT.hours}</span>
          </a>
        </div>
        <p>To help us respond quickly, include your organization name, the email you sign in with, and what you were doing when the problem happened (a screenshot helps).</p>
      </Section>

      <Section title="Common questions">
        <p><strong>Zoom says “Invalid redirect” or the connection fails.</strong> Make sure you are an administrator in your Snyder Automation organization, then try Connect next to Zoom in Settings → Calendar &amp; meetings again. If it still fails, contact us.</p>
        <p><strong>Booked appointments don’t have a Zoom link.</strong> Check that Zoom shows “Connected” in Settings → Calendar &amp; meetings and that the appointment type’s Location is set to Zoom (Settings → Appointments). Then open the appointment and click Create meeting link.</p>
        <p><strong>How do I stop using Zoom with Snyder Automation?</strong> See <Link to="/docs/zoom#remove">Removing the app</Link>.</p>
        <p><strong>A lead asked not to be called again.</strong> Mark them as Do Not Call on the lead, or they are marked automatically when they ask during a call or reply STOP to a text.</p>
      </Section>

      <Section title="More resources">
        <ul>
          <li><Link to="/docs/zoom">Zoom integration guide</Link></li>
          <li><Link to="/privacy">Privacy Policy</Link></li>
          <li><Link to="/terms">Terms of Use</Link></li>
        </ul>
      </Section>
    </LegalLayout>
  );
}
