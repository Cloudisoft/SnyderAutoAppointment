/**
 * Plays a live call's raw 16-bit little-endian PCM audio stream from a WebSocket.
 * Chunks are queued back-to-back with a small jitter buffer so playback is smooth.
 */
export interface PcmFormat {
  sampleRate: number;
  channels: 1 | 2;
}

export const PCM_FORMATS: { id: string; label: string; format: PcmFormat }[] = [
  { id: '16000-1', label: 'Standard (16 kHz)', format: { sampleRate: 16000, channels: 1 } },
  { id: '16000-2', label: 'Stereo (16 kHz)', format: { sampleRate: 16000, channels: 2 } },
  { id: '8000-1', label: 'Phone (8 kHz)', format: { sampleRate: 8000, channels: 1 } },
  { id: '24000-1', label: 'HD (24 kHz)', format: { sampleRate: 24000, channels: 1 } },
];

export class LivePcmPlayer {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private ws: WebSocket | null = null;
  private nextTime = 0;
  private leftover: Uint8Array = new Uint8Array(0);

  constructor(
    private format: PcmFormat,
    private onState: (s: 'connecting' | 'live' | 'closed' | 'error', detail?: string) => void,
  ) {}

  start(url: string) {
    this.stop();
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
    this.nextTime = 0;
    this.onState('connecting');
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => this.onState('live');
    ws.onerror = () => this.onState('error', 'Could not connect to the live audio.');
    ws.onclose = () => {
      if (this.ws === ws) this.onState('closed');
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') return; // status messages
      this.enqueue(new Uint8Array(ev.data as ArrayBuffer));
    };
    this.ws = ws;
  }

  setVolume(v: number) {
    if (this.gain) this.gain.gain.value = v;
  }

  stop() {
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    void this.ctx?.close();
    this.ctx = null;
    this.gain = null;
    this.leftover = new Uint8Array(0);
  }

  private enqueue(bytes: Uint8Array) {
    const ctx = this.ctx;
    if (!ctx || !this.gain) return;
    // Keep whole frames only (2 bytes per sample per channel); carry the rest to the next chunk.
    const frameBytes = 2 * this.format.channels;
    const data = new Uint8Array(this.leftover.length + bytes.length);
    data.set(this.leftover);
    data.set(bytes, this.leftover.length);
    const usable = data.length - (data.length % frameBytes);
    this.leftover = data.slice(usable);
    const frames = usable / frameBytes;
    if (!frames) return;
    const view = new DataView(data.buffer, data.byteOffset, usable);
    const buffer = ctx.createBuffer(this.format.channels, frames, this.format.sampleRate);
    for (let ch = 0; ch < this.format.channels; ch++) {
      const out = buffer.getChannelData(ch);
      for (let i = 0; i < frames; i++) out[i] = view.getInt16((i * this.format.channels + ch) * 2, true) / 32768;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.gain);
    const now = ctx.currentTime;
    // Start slightly in the future and re-sync if we fell behind (network hiccup).
    if (this.nextTime < now + 0.05) this.nextTime = now + 0.15;
    src.start(this.nextTime);
    this.nextTime += buffer.duration;
  }
}
