import { Link } from 'react-router-dom';
import { CONTACT, LegalLayout, Section } from './LegalLayout';

export function TermsPage() {
  return (
    <LegalLayout
      title="Terms of Use"
      updated="November 15, 2026"
      intro={<p>These terms govern your use of Snyder Automation (also called Snyder Auto Appointment, the “Service”), provided by Snyder Staffing (“Snyder”, “we”, “us”). By creating an account or using the Service, you agree to these terms on behalf of yourself and the organization you represent.</p>}
    >
      <Section title="1. The Service">
        <p>The Service places outbound calls to leads you provide using an AI voice agent, books appointments, creates calendar events and video meetings (Google Meet or Zoom) when you connect those accounts, and sends confirmations and reminders. Features may change over time.</p>
      </Section>

      <Section title="2. Accounts">
        <p>You must provide accurate information and keep your login credentials secure. You are responsible for activity under your account and for the users you invite to your organization.</p>
      </Section>

      <Section title="3. Your responsibilities when calling and messaging">
        <p>You decide who is contacted and are responsible for doing so lawfully. In particular, you agree to:</p>
        <ul>
          <li>have the consent and legal basis required to call, record and message each lead, including under the Telephone Consumer Protection Act (TCPA), state call-recording laws, and similar laws where your leads live;</li>
          <li>honor do-not-call lists and opt-out requests, and not upload numbers you are not allowed to contact;</li>
          <li>set calling hours and campaign settings appropriately;</li>
          <li>not use the Service for unlawful, deceptive, harassing or abusive purposes.</li>
        </ul>
      </Section>

      <Section title="4. Connected services (Zoom and Google)">
        <p>When you connect Zoom or Google, you authorize the Service to act on that account only as described in our <Link to="/privacy#zoom">Privacy Policy</Link>: creating, updating and deleting the meetings and calendar events for appointments it books. Your use of Zoom and Google remains subject to their own terms. You can disconnect at any time in Settings → Calendar &amp; meetings or by removing the app from your Zoom or Google account.</p>
      </Section>

      <Section title="5. Your data">
        <p>You keep ownership of the data you upload and the data created for you, such as recordings and transcripts. You give us permission to process it only to provide and support the Service, as described in the Privacy Policy. You can delete your data in the Service or ask us to delete it.</p>
      </Section>

      <Section title="6. Acceptable use">
        <p>You may not try to gain unauthorized access to the Service, disrupt it, reverse engineer it, or use it to send spam or malware.</p>
      </Section>

      <Section title="7. Fees">
        <p>If your plan has fees, they will be agreed with you in writing or shown before you buy. Calling, messaging and AI usage may be billed based on use.</p>
      </Section>

      <Section title="8. Availability and changes">
        <p>We work to keep the Service available, but it may be interrupted for maintenance or by events outside our control. We may change or discontinue features and will give reasonable notice of material changes that affect you.</p>
      </Section>

      <Section title="9. Disclaimers">
        <p>The Service is provided “as is”. AI-generated conversations, transcripts and summaries can contain mistakes; review important details before relying on them. To the extent the law allows, we disclaim implied warranties of merchantability, fitness for a particular purpose and non-infringement.</p>
      </Section>

      <Section title="10. Limitation of liability">
        <p>To the extent the law allows, Snyder is not liable for indirect, incidental, special, consequential or punitive damages, or for lost profits or data, and our total liability for any claim is limited to the amount you paid for the Service in the 12 months before the claim.</p>
      </Section>

      <Section title="11. Termination">
        <p>You can stop using the Service and ask us to close your account at any time. We may suspend or end access if these terms are violated or if required by law. Sections that by their nature should survive termination will survive.</p>
      </Section>

      <Section title="12. Changes to these terms">
        <p>We may update these terms. We will post the new version here with a new “Last updated” date and notify account owners of significant changes. Continuing to use the Service after changes take effect means you accept them.</p>
      </Section>

      <Section title="13. Contact">
        <p>Snyder Staffing · <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a> · {CONTACT.phone}</p>
      </Section>
    </LegalLayout>
  );
}
