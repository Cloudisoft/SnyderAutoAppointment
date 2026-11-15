import { Link } from 'react-router-dom';
import { CONTACT, LegalLayout, Section } from './LegalLayout';

export function ZoomGuidePage() {
  return (
    <LegalLayout
      title="Using Zoom with Snyder Automation"
      updated="November 15, 2026"
      intro={<p>When Zoom is connected, every appointment our AI calling agent books gets its own Zoom meeting. The join link goes into the confirmation email and reminders, and the meeting stays in sync when the appointment changes.</p>}
    >
      <Section title="Before you start">
        <ul>
          <li>A Snyder Automation account with the Owner or Admin role (needed to manage integrations).</li>
          <li>A Zoom account that can schedule meetings. Meetings are created on the Zoom account you connect, so use the account that should host appointments.</li>
        </ul>
      </Section>

      <Section id="add" title="Adding the app">
        <ol>
          <li>Sign in at <Link to="/login">Snyder Automation</Link>.</li>
          <li>Go to <strong>Settings → Calendar &amp; meetings</strong>.</li>
          <li>Next to <strong>Zoom</strong>, click <strong>Connect</strong>.</li>
          <li>Sign in to Zoom if asked, review the permissions, and click <strong>Allow</strong>.</li>
          <li>You return to Settings → Calendar &amp; meetings, where Zoom shows <strong>Connected</strong> with the Zoom account’s email.</li>
        </ol>
      </Section>

      <Section id="use" title="Using the app">
        <ol>
          <li>Go to <strong>Settings → Appointments → Appointment types</strong>, edit the appointment type your campaigns book (or create one), and set <strong>Location</strong> to <strong>Zoom (meeting created automatically)</strong>.</li>
          <li>When a lead agrees to a time on a call, the appointment is booked and a Zoom meeting is created on the connected account for that date, time and length.</li>
          <li>The lead gets an email confirmation with the Zoom join link, then reminders before the meeting. The link also appears on the appointment in <strong>Appointments</strong>.</li>
          <li>If the appointment is rescheduled (by your team or by the lead through their reschedule link), the Zoom meeting time is updated. If it is cancelled, the Zoom meeting is deleted.</li>
        </ol>
        <p>If Zoom is temporarily unavailable, the Service retries automatically, and you can open the appointment and click <strong>Create meeting link</strong> (or <strong>Re-sync</strong>) to try again.</p>
      </Section>

      <Section id="permissions" title="What the app can access">
        <ul>
          <li><strong>Your Zoom profile</strong> (user ID, email, name): to show which account is connected and to match Zoom notices to your organization.</li>
          <li><strong>Meetings it creates</strong>: to create, update and delete the meetings for appointments it books.</li>
        </ul>
        <p>It does not read your recordings, chats, contacts, or meetings it did not create. Details are in our <Link to="/privacy#zoom">Privacy Policy</Link>.</p>
      </Section>

      <Section id="remove" title="Removing the app">
        <p>You can remove the app either way:</p>
        <ol>
          <li><strong>From Snyder Automation:</strong> go to Settings → Calendar &amp; meetings and click <strong>Disconnect</strong> next to Zoom. We revoke access with Zoom and delete the stored token.</li>
          <li><strong>From Zoom:</strong> sign in to the Zoom App Marketplace, open <strong>Manage → Added Apps</strong>, find Snyder Automation and click <strong>Remove</strong>. Zoom notifies us and we delete the stored token for your organization.</li>
        </ol>
        <p>After removal, new appointments are booked without a Zoom link (or with Google Meet if that is connected). Zoom meetings created earlier stay in your Zoom account until you delete them there. To have your other Snyder Automation data deleted, contact <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>.</p>
      </Section>

      <Section title="Need help?">
        <p>Visit <Link to="/support">Support</Link> or contact us at <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a> · {CONTACT.phone}.</p>
      </Section>
    </LegalLayout>
  );
}
