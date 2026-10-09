import { Mp3Encoder } from '@breezystack/lamejs';

/** Highest MP3 bitrate valid for each sample rate band (MPEG-1 / MPEG-2 / MPEG-2.5 layer III). */
export function bestBitrate(sampleRate: number): number {
  if (sampleRate >= 32_000) return 256;
  if (sampleRate >= 16_000) return 160;
  return 64;
}

interface WavInfo {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  format: number;
  data: Buffer;
}

/** Reads a RIFF/WAVE file's fmt and data chunks. Returns null for anything that isn't WAV. */
export function parseWav(buf: Buffer): WavInfo | null {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let offset = 12;
  let fmt: Omit<WavInfo, 'data'> | null = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bitsPerSample: buf.readUInt16LE(body + 14) };
    } else if (id === 'data' && fmt) {
      // Streaming recorders sometimes leave the data size as 0/0xFFFFFFFF; take the rest of the file then.
      const end = size && size !== 0xffffffff ? Math.min(buf.length, body + size) : buf.length;
      return { ...fmt, data: buf.subarray(body, end) };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

/** Converts 16-bit PCM WAV to MP3 at the best bitrate for its sample rate. Null if not convertible. */
export function wavToMp3(buf: Buffer): Buffer | null {
  const wav = parseWav(buf);
  if (!wav || wav.format !== 1 || wav.bitsPerSample !== 16 || wav.channels < 1 || wav.channels > 2) return null;
  const samples = new Int16Array(wav.data.buffer.slice(wav.data.byteOffset, wav.data.byteOffset + (wav.data.length - (wav.data.length % (2 * wav.channels)))));
  const encoder = new Mp3Encoder(wav.channels, wav.sampleRate, bestBitrate(wav.sampleRate));
  const out: Uint8Array[] = [];
  const block = 1152 * 32;
  if (wav.channels === 1) {
    for (let i = 0; i < samples.length; i += block) out.push(encoder.encodeBuffer(samples.subarray(i, i + block)));
  } else {
    const frames = samples.length / 2;
    const left = new Int16Array(frames);
    const right = new Int16Array(frames);
    for (let i = 0; i < frames; i++) {
      left[i] = samples[i * 2]!;
      right[i] = samples[i * 2 + 1]!;
    }
    for (let i = 0; i < frames; i += block) out.push(encoder.encodeBuffer(left.subarray(i, i + block), right.subarray(i, i + block)));
  }
  out.push(encoder.flush());
  return Buffer.concat(out.map((u) => Buffer.from(u.buffer, u.byteOffset, u.byteLength)));
}
