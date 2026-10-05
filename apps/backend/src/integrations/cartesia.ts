import { HttpError } from '../lib/errors';
import { fetchJson } from '../lib/http';

export interface CartesiaVoice {
  id: string;
  name: string;
  description?: string;
  language?: string;
}

export interface CartesiaClient {
  listVoices(): Promise<CartesiaVoice[]>;
}

export function createCartesiaClient(apiKey: string): CartesiaClient {
  return {
    async listVoices() {
      if (!apiKey) throw new HttpError(503, 'CARTESIA_API_KEY is not configured on the server', 'not_configured');
      const res = await fetchJson<CartesiaVoice[] | { data: CartesiaVoice[] }>(
        'Cartesia',
        'https://api.cartesia.ai/voices?limit=100',
        { headers: { 'X-API-Key': apiKey, 'Cartesia-Version': '2025-04-16' } },
      );
      const list = Array.isArray(res) ? res : res.data;
      return list.map((v) => ({ id: v.id, name: v.name, description: v.description, language: v.language }));
    },
  };
}
