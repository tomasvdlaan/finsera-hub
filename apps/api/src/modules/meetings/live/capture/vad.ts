/**
 * Voice activity detection over raw PCM.
 *
 * This exists for cost, not for quality. Recall delivers a separate stream per
 * participant, so a one-hour meeting with four people is four stream-hours of audio —
 * and transcribing all of it would cost four times as much to learn that three people
 * were silent. People take turns, so gating on actual speech brings the total back to
 * roughly one stream-hour.
 *
 * Deliberately crude: energy plus zero-crossing rate over 16 kHz mono PCM. A real VAD
 * model would be more accurate and would also be another dependency, another thing to
 * keep loaded, and another failure mode — for deciding "is anyone talking", crude is
 * enough. Being wrong costs a few cents or a few missed words, not correctness.
 */

/** Recall delivers 16 kHz mono signed 16-bit little-endian. */
export const SAMPLE_RATE = 16_000;

export interface VoiceActivity {
  hasSpeech: boolean;
  /** Root mean square amplitude, 0..1. */
  level: number;
  speechRatio: number;
}

/**
 * Thresholds.
 *
 * RMS_SILENCE is set low on purpose: missing quiet speech is worse than paying to
 * transcribe a little room tone, because a missed sentence can be the one that contained
 * the commitment.
 */
const RMS_SILENCE = 0.008;
const FRAME_MS = 30;

export function detectVoiceActivity(pcm: Buffer, sampleRate = SAMPLE_RATE): VoiceActivity {
  const samples = pcm.length / 2;
  if (samples === 0) return { hasSpeech: false, level: 0, speechRatio: 0 };

  const frameSamples = Math.max(1, Math.floor((sampleRate * FRAME_MS) / 1000));
  let speechFrames = 0;
  let totalFrames = 0;
  let sumSquares = 0;

  for (let start = 0; start + frameSamples <= samples; start += frameSamples) {
    let frameSquares = 0;
    let crossings = 0;
    let previous = 0;

    for (let i = 0; i < frameSamples; i++) {
      const sample = pcm.readInt16LE((start + i) * 2) / 32_768;
      frameSquares += sample * sample;
      if (i > 0 && Math.sign(sample) !== Math.sign(previous)) crossings++;
      previous = sample;
    }

    const rms = Math.sqrt(frameSquares / frameSamples);
    sumSquares += frameSquares;
    totalFrames++;

    // Loud enough, and not so busy with zero crossings that it is obviously hiss.
    const zcr = crossings / frameSamples;
    if (rms > RMS_SILENCE && zcr < 0.35) speechFrames++;
  }

  if (totalFrames === 0) return { hasSpeech: false, level: 0, speechRatio: 0 };

  const speechRatio = speechFrames / totalFrames;
  return {
    hasSpeech: speechRatio > 0.12, // a couple of words is enough to be worth transcribing
    level: Math.sqrt(sumSquares / (totalFrames * frameSamples)),
    speechRatio,
  };
}

/**
 * Accumulates one speaker's audio until there is enough worth transcribing.
 *
 * Sending every arriving frame would mean an API call per fraction of a second; waiting
 * for a long fixed window would make the agent slow to react. This flushes when the
 * speaker pauses, or when the buffer reaches the maximum — so a sentence goes as a
 * sentence, and a monologue still gets broken up.
 */
export class SpeechBuffer {
  private chunks: Buffer[] = [];
  private silentMs = 0;
  private speechMs = 0;

  constructor(
    private readonly minSpeechMs = 700,
    // How long to wait after someone stops before deciding they have finished. Every
    // millisecond here is added to how long the agent takes to respond, and 400ms is
    // still comfortably longer than the pause inside a sentence.
    private readonly trailingSilenceMs = 400,
    private readonly maxSpeechMs = 20_000,
  ) {}

  /** Returns audio to transcribe, or null if there is nothing worth sending yet. */
  add(pcm: Buffer, sampleRate = SAMPLE_RATE): Buffer | null {
    const durationMs = (pcm.length / 2 / sampleRate) * 1000;
    const { hasSpeech } = detectVoiceActivity(pcm, sampleRate);

    if (hasSpeech) {
      this.chunks.push(pcm);
      this.speechMs += durationMs;
      this.silentMs = 0;
      // A long monologue is flushed mid-flow rather than held to the end.
      return this.speechMs >= this.maxSpeechMs ? this.flush() : null;
    }

    // Silence: keep it only if it sits between speech, so a sentence is not clipped.
    if (this.speechMs > 0) {
      this.chunks.push(pcm);
      this.silentMs += durationMs;
      if (this.silentMs >= this.trailingSilenceMs) {
        return this.speechMs >= this.minSpeechMs ? this.flush() : this.discard();
      }
    }
    return null;
  }

  private flush(): Buffer {
    const audio = Buffer.concat(this.chunks);
    this.reset();
    return audio;
  }

  private discard(): null {
    this.reset();
    return null;
  }

  private reset(): void {
    this.chunks = [];
    this.silentMs = 0;
    this.speechMs = 0;
  }

  /** Whatever is held, for when a speaker stops or the meeting ends mid-sentence. */
  drain(): Buffer | null {
    if (this.speechMs < this.minSpeechMs) {
      this.reset();
      return null;
    }
    return this.flush();
  }
}

/**
 * PCM to WAV.
 *
 * Gemini's documented audio formats do not include raw PCM, and WAV is a 44-byte header
 * away — considerably less trouble than discovering mid-meeting that the format was
 * rejected.
 */
export function pcmToWav(pcm: Buffer, sampleRate = SAMPLE_RATE, channels = 1): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); //  format: PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32); // block align
  header.writeUInt16LE(16, 34); //           bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}
