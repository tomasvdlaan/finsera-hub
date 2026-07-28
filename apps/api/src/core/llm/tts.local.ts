import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Matches what the Gemini path produces, so the MP3 encoder needs no special case. */
export const LOCAL_SAMPLE_RATE = 24_000;

/**
 * Speech from the operating system.
 *
 * macOS ships a Dutch voice and speaks a sentence in under a second, against roughly
 * three for a hosted model. In a conversation that difference is the whole experience —
 * the voice sounds synthetic, but a synthetic voice that answers in a second is far more
 * usable than a natural one that answers in three.
 *
 * macOS only, so it is a preference rather than the implementation: anywhere without
 * `say`, the hosted path is used instead.
 */
export function isLocalSpeechAvailable(): boolean {
  return process.platform === 'darwin';
}

/**
 * Speak, returning 16-bit mono PCM at 24 kHz.
 *
 * `say` writes a WAV, and the 44-byte header is stripped so the caller receives the same
 * raw PCM the hosted path yields — one MP3 encoder, one audio format, no branching
 * downstream.
 */
export async function speakLocally(text: string, voice = 'Xander'): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'tts-'));
  const file = join(dir, 'speech.wav');
  try {
    await run('say', [
      '-v',
      voice,
      // Little-endian signed 16-bit at 24 kHz: exactly what the encoder expects.
      `--data-format=LEI16@${LOCAL_SAMPLE_RATE}`,
      '-o',
      file,
      text,
    ]);
    const wav = await readFile(file);
    return stripWavHeader(wav);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Find the samples in a WAV.
 *
 * The header is usually 44 bytes, but not always — `say` sometimes writes extra chunks,
 * and assuming 44 would prepend a burst of noise to every sentence. So the `data` chunk
 * is located rather than guessed at.
 */
export function stripWavHeader(wav: Buffer): Buffer {
  if (wav.subarray(0, 4).toString() !== 'RIFF') return wav;

  let offset = 12; // past "RIFF____WAVE"
  while (offset + 8 <= wav.length) {
    const chunkId = wav.subarray(offset, offset + 4).toString();
    const chunkSize = wav.readUInt32LE(offset + 4);
    if (chunkId === 'data') {
      return wav.subarray(offset + 8, Math.min(offset + 8 + chunkSize, wav.length));
    }
    offset += 8 + chunkSize + (chunkSize % 2); // chunks are word-aligned
  }
  return wav.subarray(44); // malformed; fall back to the usual header length
}
