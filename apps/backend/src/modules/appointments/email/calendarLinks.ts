export interface CalendarLinkInput {
  title: string;
  start: Date;
  end: Date;
  details: string;
  location: string;
}

const compact = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function googleCalendarUrl(e: CalendarLinkInput): string {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${compact(e.start)}/${compact(e.end)}`,
    details: e.details,
    location: e.location,
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

export function outlookCalendarUrl(e: CalendarLinkInput): string {
  const p = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: e.title,
    startdt: e.start.toISOString(),
    enddt: e.end.toISOString(),
    body: e.details,
    location: e.location,
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${p}`;
}
