import { Injectable, Logger } from '@nestjs/common';

/** Gemini returns 24 kHz mono PCM; Recall plays MP3. */
const SAMPLE_RATE = 24_000;
const MP3_KBPS = 64;

/**
 * Speech, for when the platform needs to say something out loud.
 *
 * Google Cloud Text-to-Speech would give better Dutch voices and MP3 directly, but it
 * refuses API keys — it wants a service account, which is a whole credential to obtain
 * and rotate. The Gemini API accepts the key already configured, so speech costs no new
 * credential and no new processor. The trade is that it returns raw PCM and the MP3
 * encoding happens here.
 */
@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);

  static isConfigured(): boolean {
    return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  }

  /**
   * Speak a line, as MP3.
   *
   * `style` is prepended as an instruction rather than spoken: these models take
   * direction ("say warmly", "say briskly"), which is the difference between a colleague
   * and a station announcement.
   */
  async speak(
    text: string,
    opts: { voice?: string; style?: string } = {},
  ): Promise<{ mp3: Buffer; mimeType: 'audio/mp3' }> {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY is not set');

    const model = process.env.MODEL_TTS ?? 'gemini-2.5-flash-preview-tts';
    const voice = opts.voice ?? process.env.TTS_VOICE ?? 'Kore';
    const prompt = opts.style ? `${opts.style}: ${text}` : text;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Speech failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
    }

    const body = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>;
    };
    const encoded = body.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!encoded) throw new Error('The model returned no audio');

    return { mp3: await pcmToMp3(Buffer.from(encoded, 'base64')), mimeType: 'audio/mp3' };
  }
}

interface Mp3EncoderLike {
  encodeBuffer(samples: Int16Array): Uint8Array;
  flush(): Uint8Array;
}
type Mp3EncoderCtor = new (channels: number, sampleRate: number, kbps: number) => Mp3EncoderLike;

let encoderCtor: Mp3EncoderCtor | null = null;

/**
 * Load the encoder, once.
 *
 * A static import compiles to a CommonJS require, and this package is ESM-only — so the
 * require silently yields an empty object and `new Mp3Encoder` fails at the first attempt
 * to speak. It passed tests because vitest resolves ESM natively; only the built server
 * hit it. A dynamic import works from both, and the shape is checked here rather than
 * trusted, so a bad load fails with a sentence instead of "not a constructor" mid-meeting.
 */
/**
 * A real dynamic import, built at runtime.
 *
 * Writing `await import(...)` is not enough: compiling to CommonJS turns it straight back
 * into require(), which is what broke in the first place. Constructing the function at
 * runtime puts it beyond the compiler's reach, so the ESM package loads as ESM.
 */
const importEsm = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<unknown>;

type MaybeModule = { Mp3Encoder?: Mp3EncoderCtor; default?: { Mp3Encoder?: Mp3EncoderCtor } };

/**
 * Load the encoder, whichever module system is in force.
 *
 * Two attempts, because the two environments this runs in disagree. Under the test
 * runner, plain `import()` is real ESM and works. In the built server it is compiled to
 * require(), which returns an empty object for an ESM-only package — so the second
 * attempt uses a function constructed at runtime, out of the compiler's reach.
 *
 * Neither alone is sufficient, and getting it wrong is invisible until the first attempt
 * to speak, which is how this shipped broken the first time.
 */
async function loadEncoder(): Promise<Mp3EncoderCtor> {
  if (encoderCtor) return encoderCtor;

  const attempts: Array<() => Promise<unknown>> = [
    () => import('@breezystack/lamejs'),
    () => importEsm('@breezystack/lamejs'),
  ];

  for (const attempt of attempts) {
    try {
      const mod = (await attempt()) as MaybeModule;
      const found = mod.Mp3Encoder ?? mod.default?.Mp3Encoder;
      if (typeof found === 'function') {
        encoderCtor = found;
        return found;
      }
    } catch {
      // Expected: one of the two throws in each environment.
    }
  }

  throw new Error('The MP3 encoder could not be loaded — cannot produce speech');
}

/**
 * 16-bit mono PCM to MP3.
 *
 * Done in process rather than by shelling out to ffmpeg: one fewer thing to install on
 * a server, and the clips are seconds long, so speed is irrelevant.
 */
export async function pcmToMp3(pcm: Buffer, sampleRate = SAMPLE_RATE): Promise<Buffer> {
  const Encoder = await loadEncoder();
  const encoder = new Encoder(1, sampleRate, MP3_KBPS);
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));

  const blocks: Uint8Array[] = [];
  const blockSize = 1_152; // one MP3 frame
  for (let i = 0; i < samples.length; i += blockSize) {
    const chunk = samples.subarray(i, i + blockSize);
    const encoded = encoder.encodeBuffer(chunk);
    if (encoded.length > 0) blocks.push(encoded);
  }
  const tail = encoder.flush();
  if (tail.length > 0) blocks.push(tail);

  return Buffer.concat(blocks.map((b) => Buffer.from(b)));
}
