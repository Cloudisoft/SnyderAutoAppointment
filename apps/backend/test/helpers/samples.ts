import type { CampaignSnapshot } from '@snyder/shared';

export const sampleSnapshot: CampaignSnapshot = {
  campaign_name: 'Spring Outreach',
  agent_id: 'a',
  phone_number_ids: ['p'],
  business_name: 'Acme Co',
  time_zone: 'America/New_York',
  concurrency: 1,
  calling_window: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' },
  max_attempts: 3,
  retry_delay_minutes: 60,
  agent: {
    id: 'a',
    name: 'Agent',
    system_prompt: 'Call {{first_name}} at {{company}} about {{plan_tier}}. {{unknown_thing}}',
    first_message: 'Hi {{first_name}}, this is {{agent_name}} from {{business_name}}.',
    model: 'gpt-4o',
    temperature: 0.4,
    transfer_number: '+12125550199',
    end_call_message: null,
    knowledge_base_vapi_tool_id: 'kb-tool',
    voice: { voice_id: 'v1', name: 'Katie', model: 'sonic-3', language: 'en' },
  },
  phone_numbers: [{ id: 'p', e164: '+12125550100', vapi_phone_number_id: 'pn1' }],
};
