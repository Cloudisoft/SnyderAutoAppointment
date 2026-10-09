import { escapeHtml } from '../../../lib/templates';

/** Snyder Automation email look: orange accent, ink text, logo header. Email-safe (tables + inline styles). */
export const BRAND = { orange: '#FE5E01', orangeText: '#C2410C', ink: '#090D0D', muted: '#6B6560', line: '#E9E3DD', soft: '#FFF4EC', page: '#F4F1EE' };
const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const DISPLAY = "Montserrat,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export type Tone = 'success' | 'brand' | 'danger';
const TONES: Record<Tone, { bg: string; fg: string }> = {
  success: { bg: '#E7F6EC', fg: '#15803D' },
  brand: { bg: BRAND.soft, fg: BRAND.orangeText },
  danger: { bg: '#FDECEC', fg: '#B91C1C' },
};

export function button(href: string, label: string, primary = false): string {
  const style = primary
    ? `background:${BRAND.orange};color:${BRAND.ink};border:1px solid ${BRAND.orange};`
    : `background:#ffffff;color:${BRAND.ink};border:1px solid ${BRAND.line};`;
  return `<a href="${escapeHtml(href)}" style="${style}display:inline-block;padding:11px 18px;border-radius:10px;font-weight:700;font-size:14px;text-decoration:none;margin:4px 8px 4px 0;font-family:${FONT}">${escapeHtml(label)}</a>`;
}

export function link(href: string, text = href): string {
  return `<a href="${escapeHtml(href)}" style="color:${BRAND.orangeText};font-weight:600;word-break:break-word;overflow-wrap:break-word">${escapeHtml(text)}</a>`;
}

/** Big date/time block at the top of the email. */
export function whenBlock(o: { label: string; date: string; time: string; zone: string; strike?: boolean }): string {
  const s = o.strike ? 'text-decoration:line-through;color:#9CA3AF;' : '';
  return `<table role="presentation" width="100%" style="border-collapse:collapse;margin:4px 0 20px"><tr>
<td style="border-left:4px solid ${o.strike ? '#D1D5DB' : BRAND.orange};background:${o.strike ? '#F9FAFB' : BRAND.soft};border-radius:0 12px 12px 0;padding:14px 18px">
<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${BRAND.muted};font-weight:700">${escapeHtml(o.label)}</div>
<div style="font-family:${DISPLAY};font-size:20px;font-weight:800;color:${BRAND.ink};margin-top:4px;${s}">${escapeHtml(o.date)}</div>
<div style="font-size:15px;color:${BRAND.ink};margin-top:2px;${s}">${escapeHtml(o.time)} <span style="color:${BRAND.muted}">· ${escapeHtml(o.zone)}</span></div>
</td></tr></table>`;
}

/** Prominent "Join" card for Google Meet / Zoom / video links. */
export function joinCard(o: { provider: string; url: string }): string {
  const name = o.provider === 'zoom' ? 'Zoom' : o.provider === 'google_meet' ? 'Google Meet' : 'video call';
  return `<table role="presentation" width="100%" style="border-collapse:collapse;margin:0 0 20px"><tr>
<td style="background:${BRAND.ink};border-radius:14px;padding:18px 20px">
<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#FF8A47;font-weight:700">Meeting link</div>
<div style="font-family:${DISPLAY};font-size:17px;font-weight:800;color:#ffffff;margin:4px 0 12px">Join on ${escapeHtml(name)}</div>
<a href="${escapeHtml(o.url)}" style="display:inline-block;background:${BRAND.orange};color:${BRAND.ink};font-weight:800;font-size:15px;text-decoration:none;padding:12px 22px;border-radius:10px;font-family:${FONT}">Join ${escapeHtml(name)} →</a>
<div style="margin-top:10px;font-size:12px;color:#B8B3AE;word-break:break-all">${escapeHtml(o.url)}</div>
</td></tr></table>`;
}

export function detailsTable(rows: [string, string][]): string {
  return `<table role="presentation" width="100%" style="border-collapse:collapse;margin:4px 0 20px;border:1px solid ${BRAND.line};border-radius:12px">${rows
    .map(
      ([k, v], i) =>
        `<tr><td style="padding:10px 14px;color:${BRAND.muted};width:110px;vertical-align:top;font-size:13px;${i ? `border-top:1px solid ${BRAND.line};` : ''}">${escapeHtml(k)}</td><td style="padding:10px 14px;font-size:14px;color:${BRAND.ink};${i ? `border-top:1px solid ${BRAND.line};` : ''}">${escapeHtml(v)}</td></tr>`,
    )
    .join('')}</table>`;
}

/** Full branded email: logo header, status pill + heading, content, footer. */
export function layout(o: { logoUrl: string; preheader: string; pill: { text: string; tone: Tone }; heading: string; inner: string; footer: string; businessName: string }): string {
  const tone = TONES[o.pill.tone];
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${escapeHtml(o.heading)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.page};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(o.preheader)}</div>
<table role="presentation" width="100%" style="border-collapse:collapse;background:${BRAND.page}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" style="max-width:600px;border-collapse:collapse;font-family:${FONT};font-size:15px;line-height:1.55;color:${BRAND.ink}">
<tr><td style="background:${BRAND.orange};height:5px;border-radius:14px 14px 0 0;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="background:#ffffff;padding:22px 28px 6px;border-left:1px solid ${BRAND.line};border-right:1px solid ${BRAND.line}">
<table role="presentation" width="100%" style="border-collapse:collapse"><tr>
<td><img src="${escapeHtml(o.logoUrl)}" width="168" height="44" alt="Snyder Automation" style="display:block;border:0;height:44px;width:168px"></td>
<td align="right" style="font-size:12px;color:${BRAND.muted}">${escapeHtml(o.businessName)}</td>
</tr></table></td></tr>
<tr><td style="background:#ffffff;padding:18px 28px 28px;border:1px solid ${BRAND.line};border-top:0;border-radius:0 0 14px 14px">
<span style="display:inline-block;background:${tone.bg};color:${tone.fg};font-size:12px;font-weight:800;padding:5px 11px;border-radius:999px;letter-spacing:.02em">${escapeHtml(o.pill.text)}</span>
<h1 style="font-family:${DISPLAY};font-size:24px;line-height:1.25;font-weight:800;margin:12px 0 16px;color:${BRAND.ink}">${escapeHtml(o.heading)}</h1>
${o.inner}
</td></tr>
<tr><td style="padding:18px 8px 0;text-align:center;font-size:12px;color:${BRAND.muted}">${o.footer}</td></tr>
<tr><td style="padding:10px 8px 0;text-align:center;font-size:11px;color:#A8A29E">Scheduling by <span style="color:${BRAND.orangeText};font-weight:700">Snyder Automation</span></td></tr>
</table></td></tr></table></body></html>`;
}
