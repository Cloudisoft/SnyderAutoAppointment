import { describe, expect, it } from 'vitest';
import { bestBitrate, parseWav, wavToMp3 } from './mp3';

/** One second of a 440 Hz tone as 16-bit PCM WAV. */
export function testWav(sampleRate: number, channels: 1 | 2): Buffer {
  const frames = sampleRate;
  const data = Buffer.alloc(frames * channels * 2);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12_000);
    for (let c = 0; c < channels; c++) data.writeInt16LE(v, (i * channels + c) * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * channels * 2, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

describe('wavToMp3', () => {
  it.each([
    [8_000, 1],
    [16_000, 1],
    [24_000, 2],
    [48_000, 2],
  ] as const)('converts %i Hz × %i channel WAV to MP3 at the highest valid bitrate', (rate, channels) => {
    const mp3 = wavToMp3(testWav(rate, channels))!;
    expect(mp3).not.toBeNull();
    expect(mp3[0]).toBe(0xff);
    expect(mp3[1]! & 0xe0).toBe(0xe0);
    // ~1 s of audio at the chosen bitrate (allowing for encoder padding).
    const expected = (bestBitrate(rate) * 1000) / 8;
    expect(mp3.length).toBeGreaterThan(expected * 0.6);
    expect(mp3.length).toBeLessThan(expected * 1.6);
  });

  it('reads chunked WAV headers and rejects non-WAV input', () => {
    expect(parseWav(testWav(16_000, 1))).toMatchObject({ sampleRate: 16_000, channels: 1, bitsPerSample: 16 });
    expect(wavToMp3(Buffer.from('not audio'))).toBeNull();
  });
});
