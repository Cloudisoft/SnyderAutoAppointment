import { HttpError } from '../lib/errors';
import { z } from 'zod';
import { fetchJson } from '../lib/http';

export const CallExtractionSchema = z.object({
  summary: z.string().default(''),
  meeting_agreed: z.boolean().default(false),
  /** ISO 8601 with offset, only when an exact date and time were agreed. */
  meeting_start: z.string().nullable().default(null),
  attendee_email: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
});
export type CallExtraction = z.infer<typeof CallExtractionSchema>;

export interface OpenAiClient {
  readonly enabled: boolean;
  extractCall(input: { transcript: string; nowIso: string; timeZone: string }): Promise<CallExtraction>;
}

const SYSTEM = `You analyse transcripts of outbound sales/scheduling phone calls.
Return JSON with keys: summary (2-3 sentences), meeting_agreed (true only if the prospect clearly agreed to a specific meeting date AND time),
meeting_start (ISO 8601 with UTC offset for the agreed start, resolved against the provided current time and time zone; null if not exact),
attendee_email (if spoken, else null), notes (anything the prospect asked to be noted, else null).`;

export function createOpenAiClient(apiKey: string, model = 'gpt-4o-mini'): OpenAiClient {
  return {
    enabled: !!apiKey,
    async extractCall({ transcript, nowIso, timeZone }) {
      if (!apiKey) throw new HttpError(503, 'The AI service is not configured on the server (missing API key)', 'not_configured');
      const res = await fetchJson<{ choices: { message: { content: string } }[] }>(
        'OpenAI',
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          timeoutMs: 30_000,
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: SYSTEM },
              { role: 'user', content: `Current time: ${nowIso}\nTime zone: ${timeZone}\n\nTranscript:\n${transcript.slice(0, 60_000)}` },
            ],
          }),
        },
      );
      return CallExtractionSchema.parse(JSON.parse(res.choices[0]?.message.content ?? '{}'));
    },
  };
}
