import { describe, expect, it } from 'vitest';
import { resolveLeadTimeZone, timeZoneFromPhone } from './timezone';

describe('lead time zone resolution', () => {
  it('prefers a valid lead field', () => {
    expect(resolveLeadTimeZone({ leadTimeZone: 'America/Denver', phoneE164: '+12125550142', campaignTimeZone: 'UTC' })).toEqual({
      timeZone: 'America/Denver',
      source: 'lead',
    });
  });
  it('derives from the phone number region when the lead field is missing or invalid', () => {
    expect(resolveLeadTimeZone({ leadTimeZone: 'Not/AZone', phoneE164: '+13105550100', campaignTimeZone: 'UTC' })).toEqual({
      timeZone: 'America/Los_Angeles',
      source: 'phone',
    });
    expect(timeZoneFromPhone('+12125550142')).toBe('America/New_York');
    expect(timeZoneFromPhone('+13125550100')).toBe('America/Chicago');
    expect(timeZoneFromPhone('+16025550100')).toBe('America/Phoenix');
    expect(timeZoneFromPhone('+14165550100')).toBe('America/Toronto');
    expect(timeZoneFromPhone('+442071234567')).toBe('Europe/London');
  });
  it('falls back to the campaign time zone', () => {
    expect(resolveLeadTimeZone({ phoneE164: '+61291234567', campaignTimeZone: 'America/New_York' })).toEqual({
      timeZone: 'America/New_York',
      source: 'campaign',
    });
    expect(resolveLeadTimeZone({ campaignTimeZone: 'Europe/Paris' }).source).toBe('campaign');
  });
});
