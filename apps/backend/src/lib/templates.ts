/**
 * Placeholder templates shared by agent prompts and emails.
 *
 * Accepted spellings are normalized to {{snake_case}}: {{ First Name }}, {{first-name}}, {first_name},
 * {{custom.plan_tier}}. Known keys are substituted; unknown placeholders are removed, never sent literally.
 */

export type TemplateVars = Record<string, string | number | null | undefined>;

export function normalizeKey(raw: string): string {
  return raw
    .trim()
    .replace(/^(custom|lead|custom_fields)\./i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const DOUBLE = /\{\{\s*([^{}]{1,80}?)\s*\}\}/g;
// Single-brace placeholder that looks like a variable name, not a code block.
const SINGLE = /(?<!\{)\{\s*([A-Za-z][A-Za-z0-9 _.-]{0,60}?)\s*\}(?!\})/g;

/** Rewrites every accepted placeholder spelling to the canonical {{key}} form. */
export function normalizeTemplate(template: string): string {
  return template
    .replace(DOUBLE, (_m, k: string) => `{{${normalizeKey(k)}}}`)
    .replace(SINGLE, (_m, k: string) => `{{${normalizeKey(k)}}}`);
}

/** Lists the canonical placeholder keys used in a template. */
export function placeholdersIn(template: string): string[] {
  const keys = new Set<string>();
  for (const m of normalizeTemplate(template).matchAll(DOUBLE)) keys.add(m[1]!);
  return [...keys];
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface RenderOptions {
  /** HTML-escape substituted values (use for HTML email bodies). */
  html?: boolean;
  /** Keys whose values are trusted HTML and must not be escaped (e.g. a pre-built link). */
  rawHtmlKeys?: string[];
}

export function renderTemplate(template: string, vars: TemplateVars, opts: RenderOptions = {}): string {
  const normalizedVars: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (v !== null && v !== undefined && String(v) !== '') normalizedVars[normalizeKey(k)] = String(v);
  }
  const out = normalizeTemplate(template).replace(DOUBLE, (_m, key: string) => {
    const v = normalizedVars[key];
    if (v === undefined) return '';
    if (opts.html && !opts.rawHtmlKeys?.includes(key)) return escapeHtml(v);
    return v;
  });
  return tidy(out);
}

/** Cleans up spacing left behind by removed placeholders ("Hi ," -> "Hi,"). */
function tidy(s: string): string {
  return s.replace(/[ \t]+([,.!?;:])/g, '$1').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/gm, '');
}

/** Builds template variables from a lead row, including its custom fields. */
export function leadVars(lead: {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  company?: string | null;
  phone_e164?: string | null;
  custom_fields?: Record<string, unknown> | null;
}): TemplateVars {
  const vars: TemplateVars = {};
  for (const [k, v] of Object.entries(lead.custom_fields ?? {})) {
    if (v !== null && typeof v !== 'object') vars[normalizeKey(k)] = String(v);
  }
  return {
    ...vars,
    first_name: lead.first_name ?? '',
    last_name: lead.last_name ?? '',
    full_name: [lead.first_name, lead.last_name].filter(Boolean).join(' '),
    email: lead.email ?? '',
    company: lead.company ?? '',
    phone: lead.phone_e164 ?? '',
  };
}
