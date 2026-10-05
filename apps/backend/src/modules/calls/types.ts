export interface CallRow {
  id: string;
  organization_id: string;
  campaign_id: string | null;
  campaign_version_id: string | null;
  campaign_lead_id: string | null;
  lead_id: string | null;
  vapi_call_id: string | null;
  status: string;
  started_at: Date | null;
  ended_at: Date | null;
  connected: boolean;
  dnc_requested: boolean;
  booking_tools_enabled: boolean;
  end_processed_at: Date | null;
  to_number: string;
}

/** Normalized end-of-call data from either the webhook report or a reconciliation fetch. */
export interface CallEndData {
  vapiCallId: string;
  endedReason: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  recordingUrl: string | null;
  transcript: string | null;
  summary: string | null;
  structuredData: Record<string, unknown> | null;
  cost: number | null;
  source: 'webhook' | 'reconcile';
}
