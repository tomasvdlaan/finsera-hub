import { Injectable, Logger } from '@nestjs/common';
import { Mp3Encoder } from '@breezystack/lamejs';

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

    return { mp3: pcmToMp3(Buffer.from(encoded, 'base64')), mimeType: 'audio/mp3' };
  }
}

/**
 * 16-bit mono PCM to MP3.
 *
 * Done in process rather than by shelling out to ffmpeg: one fewer thing to install on
 * a server, and the clips are seconds long, so speed is irrelevant.
 */
export function pcmToMp3(pcm: Buffer, sampleRate = SAMPLE_RATE): Buffer {
  const encoder = new Mp3Encoder(1, sampleRate, MP3_KBPS);
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
