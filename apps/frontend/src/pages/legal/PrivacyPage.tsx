import { Link } from 'react-router-dom';
import { CONTACT, LegalLayout, Section } from './LegalLayout';

export function PrivacyPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      updated="November 15, 2026"
      intro={<p>This policy explains how Snyder Staffing (“Snyder”, “we”, “us”) collects, uses, shares, retains and protects personal information in Snyder Automation (also called Snyder Auto Appointment, the “Service”), including when you connect the Service to Zoom or Google.</p>}
    >
      <Section title="1. Who we are">
        <p>The Service is operated by Snyder Staffing. Questions about this policy can be sent to <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a> or {CONTACT.phone}.</p>
        <p>Organizations that use the Service (our “customers”) decide which leads to contact and why. For lead and call data, the customer is the controller and we process that data on the customer’s behalf.</p>
      </Section>

      <Section title="2. Information we collect">
        <ul>
          <li><strong>Account information:</strong> name, email address and password (stored as a secure hash by our authentication provider), organization name, role, and time-zone settings.</li>
          <li><strong>Lead information uploaded by customers:</strong> names, phone numbers, email addresses, company, time zone, and any custom fields the customer chooses to import.</li>
          <li><strong>Call information:</strong> call recordings, transcripts, call summaries, call outcome, duration, and the phone numbers involved.</li>
          <li><strong>Appointment information:</strong> date, time, attendees, meeting links, and reminder and rescheduling history.</li>
          <li><strong>Connected-account information (Zoom and Google):</strong> the email address, display name and user ID of the connected account, and an OAuth token that lets the Service act on the customer’s behalf. We do not receive your Zoom or Google password.</li>
          <li><strong>Technical information:</strong> IP address, browser type, and server logs used to keep the Service secure and working.</li>
        </ul>
      </Section>

      <Section id="zoom" title="3. Zoom data we access and how we use it">
        <p>When an organization administrator connects Zoom, the Service uses Zoom’s API only to:</p>
        <ul>
          <li>read the connected user’s basic profile (user ID, email and name) so the connection can be shown in Settings and matched to the right organization;</li>
          <li>create a Zoom meeting for each appointment the Service books;</li>
          <li>update that meeting when the appointment is rescheduled, and delete it when the appointment is cancelled.</li>
        </ul>
        <p>We store the meeting ID and join link for those meetings so they can be included in invitations and kept in sync. We do not access Zoom recordings, chat messages, contacts, or meetings the Service did not create. We do not sell Zoom data or use it for advertising or to train AI models.</p>
        <p>If you remove the app from your Zoom account, or disconnect Zoom in Settings → Calendar &amp; meetings, we delete the stored Zoom token for your organization. Meeting links already sent in invitations remain in your appointment history until you delete them.</p>
      </Section>

      <Section title="4. How we use information">
        <ul>
          <li>To place calls on a customer’s behalf, book appointments, and send confirmations, reminders and rescheduling links.</li>
          <li>To create and manage calendar events and video meetings for booked appointments.</li>
          <li>To provide recordings, transcripts, summaries and reports to the customer.</li>
          <li>To secure, maintain, troubleshoot and improve the Service.</li>
          <li>To comply with legal obligations, including honoring do-not-call and opt-out requests.</li>
        </ul>
      </Section>

      <Section title="5. How we share information">
        <p>We do not sell personal information. We share it only with service providers that help us run the Service, under contracts that limit their use of the data to providing their services to us:</p>
        <ul>
          <li>cloud hosting and database providers;</li>
          <li>telephony providers that carry calls and SMS;</li>
          <li>speech, voice and language AI providers that power the calling agent and transcripts;</li>
          <li>email delivery providers that send invitations and reminders;</li>
          <li>Zoom and Google, when a customer connects those accounts, to create meetings and calendar events.</li>
        </ul>
        <p>We may also disclose information if required by law, to protect the rights and safety of our users or others, or as part of a merger or acquisition, in which case this policy will continue to apply.</p>
      </Section>

      <Section title="6. Data retention">
        <ul>
          <li>Customer data (leads, calls, recordings, transcripts and appointments) is kept while the customer’s account is active, or until the customer deletes it in the Service.</li>
          <li>Zoom and Google tokens are deleted as soon as the account is disconnected or the app is removed.</li>
          <li>When a customer closes its account, we delete its data within 30 days, except where we must keep it longer to meet legal obligations. Backups are overwritten on a rolling schedule.</li>
        </ul>
      </Section>

      <Section title="7. Security">
        <p>Data is encrypted in transit (HTTPS). OAuth tokens and other credentials are stored encrypted in a secrets vault. Each organization’s data is kept separate, access is limited by role, and recordings are shared only through signed links that expire.</p>
      </Section>

      <Section title="8. Your choices and rights">
        <p>Depending on where you live, you may have the right to access, correct, delete or export your personal information, or to object to certain processing. People who were called on a customer’s behalf can ask not to be called again during the call, by replying STOP to a text, or by contacting the customer directly. To make a request, contact us at <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>. If your request concerns data a customer controls, we will forward it to that customer and help them respond.</p>
      </Section>

      <Section title="9. Children">
        <p>The Service is meant for businesses and is not directed to children under 16. We do not knowingly collect their personal information.</p>
      </Section>

      <Section title="10. Changes to this policy">
        <p>We may update this policy. We will post the new version on this page with a new “Last updated” date and, for significant changes, notify account owners by email.</p>
      </Section>

      <Section title="11. Contact">
        <p>Snyder Staffing · <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a> · {CONTACT.phone} ({CONTACT.hours}). See also our <Link to="/terms">Terms of Use</Link>.</p>
      </Section>
    </LegalLayout>
  );
}
