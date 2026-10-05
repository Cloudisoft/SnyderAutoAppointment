import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)');

export const CallingWindowSchema = z.object({
  /** ISO weekdays, 1 = Monday ... 7 = Sunday. Evaluated in the lead's local time. */
  days: z.array(z.number().int().min(1).max(7)).min(1).default([1, 2, 3, 4, 5]),
  start: hhmm.default('09:00'),
  end: hhmm.default('18:00'),
});
export type CallingWindow = z.infer<typeof CallingWindowSchema>;

/** Editable campaign configuration (stored as campaigns.draft, frozen into versions on publish). */
export const CampaignConfigSchema = z.object({
  agent_id: z.string().uuid().nullable().default(null),
  phone_number_ids: z.array(z.string().uuid()).default([]),
  /** Business / intro name used in emails and available to prompts as {{business_name}}. */
  business_name: z.string().max(200).default(''),
  time_zone: z.string().default('America/New_York'),
  concurrency: z.number().int().min(1).max(100).default(2),
  calling_window: CallingWindowSchema.default({}),
  max_attempts: z.number().int().min(1).max(20).default(3),
  retry_delay_minutes: z.number().int().min(5).max(10_080).default(240),
});
export type CampaignConfig = z.infer<typeof CampaignConfigSchema>;

/** Agent, voice and numbers resolved at publish time so later edits don't change live calls. */
export interface CampaignSnapshotAgent {
  id: string;
  name: string;
  system_prompt: string;
  first_message: string;
  model: string;
  temperature: number;
  transfer_number: string | null;
  end_call_message: string | null;
  knowledge_base_vapi_tool_id: string | null;
  voice: { voice_id: string; name: string; model: string; language: string };
}

export interface CampaignSnapshot extends CampaignConfig {
  campaign_name: string;
  agent: CampaignSnapshotAgent;
  phone_numbers: { id: string; e164: string; vapi_phone_number_id: string }[];
}

export const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'archived'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
