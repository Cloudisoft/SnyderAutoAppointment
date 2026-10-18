// Sample calls for the landing-page demo: recorded AI agent and caller voices. Fictional people and businesses.

export type Speaker = 'agent' | 'caller';

export interface DemoLine {
  who: Speaker;
  text: string;
  /** Start and end of this line in the recording, in seconds. */
  at: [number, number];
  /** What the platform does at this moment, shown in the "behind the scenes" log. */
  event?: { label: string; detail: string; tone?: 'info' | 'success' | 'warn' };
}

export interface Scenario {
  id: string;
  tab: string;
  agent: string;
  caller: string;
  business: string;
  summary: string;
  outcome: string;
  /** Recorded call (AI agent voice + human caller voice). */
  audio: string;
  lines: DemoLine[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'interview',
    tab: 'Interview scheduling',
    agent: 'Ava',
    caller: 'Jordan',
    business: 'Snyder Staffing · Recruiting',
    summary: 'Calls a new applicant, confirms interest and books the interview on the recruiter’s calendar.',
    outcome: 'Interview booked · Google Meet invite sent',
    audio: '/demo/interview.mp3',
    lines: [
      { who: 'agent', at: [0.4, 5.84], text: 'Hi, is this Jordan? This is Ava calling from Snyder Staffing about the warehouse supervisor role you applied for.', event: { label: 'Call connected', detail: 'Outbound · campaign “October applicants”' } },
      { who: 'caller', at: [6.39, 10.31], text: 'Oh hi, yes, this is Jordan. Thanks for calling back so quickly.' },
      { who: 'agent', at: [10.86, 17.1], text: 'Of course! The hiring manager would love a quick twenty-minute video interview. Do mornings or afternoons work better for you this week?' },
      { who: 'caller', at: [17.65, 20.53], text: 'Mornings are best. Maybe Tuesday?' },
      { who: 'agent', at: [21.08, 26.52], text: 'Tuesday works. I have 9:30 or 10:30 in the morning, Eastern time. Which do you prefer?', event: { label: 'Checked availability', detail: 'Recruiter calendar · 2 open slots on Tue' } },
      { who: 'caller', at: [27.07, 28.75], text: 'Let’s do 10:30.' },
      { who: 'agent', at: [29.3, 36.18], text: 'Perfect. I’ve booked Tuesday at 10:30 AM Eastern with Maria Lopez. Should I send the invite to jordan.b@example.com?', event: { label: 'Appointment booked', detail: 'Tue 10:30 AM ET · 20 min · Maria Lopez', tone: 'success' } },
      { who: 'caller', at: [36.73, 38.33], text: 'Yes, that’s the one.' },
      { who: 'agent', at: [38.88, 44.48], text: 'Done. You’ll get an email with a Google Meet link now, and a reminder text the morning of. Anything else I can help with?', event: { label: 'Invite emailed', detail: 'Branded email + Google Meet link · SMS reminder scheduled', tone: 'success' } },
      { who: 'caller', at: [45.03, 47.35], text: 'No, that’s great. Thank you!' },
      { who: 'agent', at: [47.9, 50.46], text: 'You’re welcome, Jordan. Good luck on Tuesday. Goodbye!', event: { label: 'Call ended automatically', detail: 'Outcome: Interview booked · recording saved (MP3)' } },
    ],
  },

  {
    id: 'reschedule',
    tab: 'Reschedule',
    agent: 'Ava',
    caller: 'Marcus',
    business: 'Snyder Staffing · Recruiting',
    summary: 'A candidate can’t make it. The agent moves the interview and updates every invite.',
    outcome: 'Moved to Wed 1:00 PM · invites updated',
    audio: '/demo/reschedule.mp3',
    lines: [
      { who: 'agent', at: [0.4, 4.56], text: 'Hi Marcus, it’s Ava from Snyder Staffing, confirming your interview tomorrow at 11.', event: { label: 'Reminder call', detail: 'Day-before confirmation' } },
      { who: 'caller', at: [5.11, 9.43], text: 'Ah, I actually have a conflict tomorrow. Could we move it?' },
      { who: 'agent', at: [9.98, 14.06], text: 'No problem at all. I can do Wednesday at 1 PM or Thursday at 9 AM.', event: { label: 'Checked availability', detail: 'Same interviewer · next 3 days' } },
      { who: 'caller', at: [14.61, 16.61], text: 'Wednesday at one works.' },
      { who: 'agent', at: [17.16, 23.88], text: 'Done. Your interview is now Wednesday at 1 PM. The calendar invite and meeting link are updated, and the old time is released.', event: { label: 'Appointment rescheduled', detail: 'Calendar event moved · Meet link kept · email sent', tone: 'success' } },
      { who: 'caller', at: [24.43, 26.75], text: 'Perfect, thanks for being flexible.' },
      { who: 'agent', at: [27.3, 29.78], text: 'Happy to help. See you Wednesday, Marcus. Bye now!', event: { label: 'Call ended automatically', detail: 'Outcome: Rescheduled' } },
    ],
  },
  {
    id: 'transfer',
    tab: 'Live transfer',
    agent: 'Ava',
    caller: 'Devin',
    business: 'Snyder Staffing · Recruiting',
    summary: 'The caller wants a person. The agent hands off instantly — no extra questions.',
    outcome: 'Transferred to a recruiter',
    audio: '/demo/transfer.mp3',
    lines: [
      { who: 'agent', at: [0.4, 5.44], text: 'Hi, this is Ava from Snyder Staffing. Is now a good time to talk about the forklift operator opening?', event: { label: 'Call connected', detail: 'Outbound · campaign “Forklift operators”' } },
      { who: 'caller', at: [5.99, 11.59], text: 'Actually, I have a few questions about pay and benefits. Can I talk to a real person?' },
      { who: 'agent', at: [12.14, 15.34], text: 'Of course. Let me transfer your call to one of our recruiters right now.', event: { label: 'Transfer started', detail: 'Warm transfer to recruiting desk', tone: 'warn' } },
      { who: 'agent', at: [15.89, 17.97], text: 'Connecting you now. Thanks for your patience!', event: { label: 'Transferred', detail: 'Supervisor notified · transcript attached to the record', tone: 'success' } },
    ],
  },

];
