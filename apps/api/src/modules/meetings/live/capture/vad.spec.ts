import { describe, expect, it } from 'vitest';
import { SAMPLE_RATE, SpeechBuffer, detectVoiceActivity, pcmToWav } from './vad.js';

/** Silence, as a muted participant's stream sounds. */
const silence = (ms: number) => Buffer.alloc(Math.round((SAMPLE_RATE * ms) / 1000) * 2);

/** A tone standing in for speech: loud, low zero-crossing rate. */
const tone = (ms: number, amplitude = 0.3, hz = 180) => {
  const samples = Math.round((SAMPLE_RATE * ms) / 1000);
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE) * amplitude * 32_767), i * 2);
  }
  return buf;
};

/** White noise: loud but with a high zero-crossing rate, like fan or line hiss. */
const hiss = (ms: number, amplitude = 0.25) => {
  const samples = Math.round((SAMPLE_RATE * ms) / 1000);
  const buf = Buffer.alloc(samples * 2);
  let seed = 1;
  for (let i = 0; i < samples; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff; // deterministic, so the test cannot flake
    buf.writeInt16LE(Math.round(((seed / 0x7fffffff) * 2 - 1) * amplitude * 32_767), i * 2);
  }
  return buf;
};

describe('detectVoiceActivity', () => {
  it('finds no speech in silence', () => {
    const result = detectVoiceActivity(silence(500));
    expect(result.hasSpeech).toBe(false);
    expect(result.level).toBe(0);
  });

  it('finds speech in a tone', () => {
    expect(detectVoiceActivity(tone(500)).hasSpeech).toBe(true);
  });

  it('ignores hiss, which is loud but not speech', () => {
    // Room tone on an open mic would otherwise be transcribed all meeting, on every
    // stream, which is exactly the cost this exists to avoid.
    expect(detectVoiceActivity(hiss(500)).hasSpeech).toBe(false);
  });

  it('handles an empty buffer without dividing by zero', () => {
    expect(detectVoiceActivity(Buffer.alloc(0))).toEqual({
      hasSpeech: false,
      level: 0,
      speechRatio: 0,
    });
  });

  it('detects quiet speech, because a missed sentence costs more than a wasted cent', () => {
    expect(detectVoiceActivity(tone(500, 0.02)).hasSpeech).toBe(true);
  });
});

describe('SpeechBuffer', () => {
  it('emits nothing while a participant is silent', () => {
    const buffer = new SpeechBuffer();
    for (let i = 0; i < 20; i++) expect(buffer.add(silence(100))).toBeNull();
  });

  it('emits an utterance once the speaker pauses', () => {
    const buffer = new SpeechBuffer();
    for (let i = 0; i < 10; i++) expect(buffer.add(tone(100))).toBeNull(); // 1s of speech

    // Trailing silence closes the utterance.
    expect(buffer.add(silence(300))).toBeNull();
    const utterance = buffer.add(silence(400));

    expect(utterance).not.toBeNull();
    expect(utterance!.length).toBeGreaterThan(SAMPLE_RATE); // ~1s of speech plus the pause
  });

  it('discards a cough — too short to be worth an API call', () => {
    const buffer = new SpeechBuffer();
    buffer.add(tone(200));
    buffer.add(silence(300));
    expect(buffer.add(silence(400))).toBeNull();
  });

  it('breaks up a monologue rather than holding it to the end', () => {
    const buffer = new SpeechBuffer(700, 600, 3_000);
    let emitted: Buffer | null = null;
    for (let i = 0; i < 40 && !emitted; i++) emitted = buffer.add(tone(100));

    // Without this the agent would say nothing for as long as someone kept talking.
    expect(emitted).not.toBeNull();
  });

  it('drains what it holds when the meeting ends mid-sentence', () => {
    const buffer = new SpeechBuffer();
    for (let i = 0; i < 10; i++) buffer.add(tone(100));
    expect(buffer.drain()).not.toBeNull();
  });

  it('drains nothing when only a fragment was held', () => {
    const buffer = new SpeechBuffer();
    buffer.add(tone(200));
    expect(buffer.drain()).toBeNull();
  });
});

describe('pcmToWav', () => {
  it('writes a header Gemini will accept', () => {
    const wav = pcmToWav(tone(100));
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.subarray(8, 12).toString()).toBe('WAVE');
    expect(wav.readUInt16LE(22)).toBe(1); //      mono
    expect(wav.readUInt32LE(24)).toBe(16_000); // sample rate
    expect(wav.readUInt16LE(34)).toBe(16); //     bits per sample
  });

  it('declares the right sizes, or players read past the end', () => {
    const pcm = tone(100);
    const wav = pcmToWav(pcm);
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
    expect(wav.readUInt32LE(4)).toBe(36 + pcm.length);
    expect(wav.length).toBe(44 + pcm.length);
  });
});
