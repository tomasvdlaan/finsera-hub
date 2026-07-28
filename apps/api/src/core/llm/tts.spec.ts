import { describe, expect, it } from 'vitest';
import { isLocalSpeechAvailable, speakLocally, stripWavHeader } from './tts.local.js';
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
  it('produces something a player will recognise as MP3', async () => {
    const mp3 = await pcmToMp3(tone(500));
    expect(mp3.length).toBeGreaterThan(100);
    // Every MP3 frame starts with sync bits; Recall plays nothing else.
    expect(mp3[0]).toBe(0xff);
    expect(mp3[1]! & 0xe0).toBe(0xe0);
  });

  it('compresses, which is the point of not sending raw PCM', async () => {
    const pcm = tone(1_000);
    expect((await pcmToMp3(pcm)).length).toBeLessThan(pcm.length);
  });

  it('handles a very short clip without throwing', async () => {
    await expect(pcmToMp3(tone(10))).resolves.toBeInstanceOf(Buffer);
  });

  it('handles empty input', async () => {
    expect((await pcmToMp3(Buffer.alloc(0))).length).toBeGreaterThanOrEqual(0);
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

describe('local speech', () => {
  it('finds the samples wherever the header ends', () => {
    // Assuming a 44-byte header would prepend a burst of noise when `say` writes extra
    // chunks, which it sometimes does.
    const pcm = Buffer.from([1, 0, 2, 0, 3, 0]);
    const wav = Buffer.concat([
      Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'),
      Buffer.from('LIST'), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(4); return b; })(),
      Buffer.alloc(4),
      Buffer.from('data'), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(pcm.length); return b; })(),
      pcm,
    ]);
    expect(stripWavHeader(wav)).toEqual(pcm);
  });

  it('leaves raw PCM alone', () => {
    const raw = Buffer.from([1, 2, 3, 4]);
    expect(stripWavHeader(raw)).toEqual(raw);
  });

  it.runIf(isLocalSpeechAvailable())('speaks Dutch faster than the hosted model', async () => {
    const started = Date.now();
    const pcm = await speakLocally('Ja, dat klinkt goed.');
    const elapsed = Date.now() - started;

    expect(pcm.length).toBeGreaterThan(10_000);
    // The whole reason for this path. The hosted model measures ~2.8s.
    expect(elapsed).toBeLessThan(2_000);
  }, 20_000);
});
