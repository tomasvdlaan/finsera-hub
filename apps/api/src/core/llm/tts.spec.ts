import { describe, expect, it } from 'vitest';
import { TtsService, pcmToMp3 } from './tts.service.js';

/** A tone as 16-bit mono PCM at 24 kHz, standing in for speech. */
const tone = (ms: number, hz = 220) => {
  const rate = 24_000;
  const samples = Math.round((rate * ms) / 1000);
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 0.3 * 32_767), i * 2);
  }
  return buf;
};

describe('pcmToMp3', () => {
  it('produces something a player will recognise as MP3', () => {
    const mp3 = pcmToMp3(tone(500));
    expect(mp3.length).toBeGreaterThan(100);
    // Every MP3 frame starts with sync bits; Recall plays nothing else.
    expect(mp3[0]).toBe(0xff);
    expect(mp3[1]! & 0xe0).toBe(0xe0);
  });

  it('compresses, which is the point of not sending raw PCM', () => {
    const pcm = tone(1_000);
    expect(pcmToMp3(pcm).length).toBeLessThan(pcm.length);
  });

  it('handles a very short clip without throwing', () => {
    expect(() => pcmToMp3(tone(10))).not.toThrow();
  });

  it('handles empty input', () => {
    expect(pcmToMp3(Buffer.alloc(0)).length).toBeGreaterThanOrEqual(0);
  });
});

describe('TtsService', () => {
  const configured = TtsService.isConfigured();

  it('knows whether it can speak', () => {
    expect(typeof configured).toBe('boolean');
  });

  /**
   * Hits the real API, so it runs only when a key is present.
   *
   * Worth keeping rather than mocking: the thing most likely to break here is the
   * response shape, and a mock of the response shape cannot notice it changing.
   */
  it.runIf(configured)(
    'speaks Dutch and returns playable MP3',
    async () => {
      const { mp3, mimeType } = await new TtsService().speak(
        'Goedemiddag, ik luister mee met deze vergadering.',
        { style: 'Zeg dit vriendelijk en rustig' },
      );
      expect(mimeType).toBe('audio/mp3');
      expect(mp3.length).toBeGreaterThan(1_000);
      expect(mp3[0]).toBe(0xff);
    },
    60_000,
  );
});
