import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { WebSocket } from 'ws';
import { SpeechBuffer, pcmToWav } from './vad.js';
import type {
  AudioSegment,
  CaptureEvents,
  CaptureSession,
  JoinOptions,
  MeetingCaptureProvider,
  Speaker,
} from './provider.js';

/**
 * Frankfurt by default, never the US endpoint.
 *
 * The region is part of the decision, not a preference: an EU deployment is what makes
 * this defensible to a client, so the default must be the safe one. Overriding it is
 * possible but has to be deliberate.
 */
const DEFAULT_REGION = 'https://eu-central-1.recall.ai';

/** What we subscribe to; anything else is worth a look rather than a silent drop. */
const KNOWN_EVENTS = new Set([
  'audio_separate_raw.data',
  'participant_events.join',
  'participant_events.leave',
]);

interface RecallMessage {
  event?: string;
  data?: {
    data?: {
      buffer?: string;
      timestamp?: { relative?: number };
      participant?: { id?: number | string; name?: string; is_host?: boolean; extra_data?: unknown };
    };
    participant?: { id?: number | string; name?: string; is_host?: boolean };
  };
}

/**
 * Recall.ai as a capture provider.
 *
 * A bot joins the Teams meeting and streams **one audio channel per participant** back to
 * us, each tagged with that person's roster identity. Attribution is therefore a property
 * of the transport rather than something inferred from a mixed stream — which is the
 * entire reason this provider was chosen (see G3 in the decision log).
 *
 * Recall never transcribes here. It supplies audio and identity; Gemini does the words.
 * That keeps Recall a processor of audio only, and adds no second processor of content.
 */
@Injectable()
export class RecallProvider implements MeetingCaptureProvider {
  readonly name = 'recall';
  readonly hasPerSpeakerAudio = true;
  private readonly logger = new Logger(RecallProvider.name);

  isConfigured(): boolean {
    return Boolean(process.env.RECALL_API_KEY);
  }

  private get baseUrl(): string {
    return process.env.RECALL_REGION_URL ?? DEFAULT_REGION;
  }

  /**
   * Create the bot and wire its realtime stream back to us.
   *
   * Note the direction: Recall connects TO us, so `RECALL_WEBHOOK_BASE` must be an
   * address Recall can reach. In development that means a tunnel — there is no way round
   * it, and discovering it during a client meeting would be worse than reading it here.
   */
  async join(options: JoinOptions, events: CaptureEvents): Promise<CaptureSession> {
    const apiKey = process.env.RECALL_API_KEY;
    if (!apiKey) throw new Error('RECALL_API_KEY is not set');

    const publicBase = process.env.RECALL_WEBHOOK_BASE;
    if (!publicBase) {
      throw new Error(
        'RECALL_WEBHOOK_BASE is not set — Recall connects to us, so it needs a publicly ' +
          'reachable wss:// address (a tunnel in development).',
      );
    }

    // The endpoint Recall connects to is on the public internet, and Recall sends no
    // credentials of its own. A per-session secret in the URL is what stops anyone who
    // guesses the address from injecting audio into a client's meeting notes.
    const streamToken = randomBytes(24).toString('base64url');
    const streamUrl =
      `${publicBase.replace(/^http/, 'ws')}/api/meetings/recall` +
      `?noteId=${encodeURIComponent(options.noteId)}&token=${streamToken}`;

    const response = await fetch(`${this.baseUrl}/api/v1/bot/`, {
      method: 'POST',
      headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meeting_url: options.meetingUrl,
        bot_name: options.botName,
        recording_config: {
          // Per-participant audio: the whole point. Recall's own transcription stays off.
          audio_separate_raw: {},
          participant_events: {},
          // Recall's defaults record mixed VIDEO and keep it forever. Neither is wanted:
          // we stream audio through and discard it, and a stored recording of a client
          // meeting sitting on a vendor's disk is the exact thing this design avoids.
          // The shortest retention Recall offers is used, and the recording is deleted
          // explicitly when the bot leaves.
          retention: { type: 'timed', hours: 1 },
          realtime_endpoints: [
            {
              type: 'websocket',
              url: streamUrl,
              events: [
                'audio_separate_raw.data',
                'participant_events.join',
                'participant_events.leave',
              ],
            },
          ],
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Recall refused the bot: ${response.status} ${await response.text()}`);
    }

    const bot = (await response.json()) as { id: string };
    this.logger.log(`Recall bot ${bot.id} joining for note ${options.noteId}`);

    return new RecallSession(bot.id, apiKey, this.baseUrl, events, this.logger, streamToken);
  }
}

/**
 * One live meeting.
 *
 * Recall opens the websocket to us, so this object mostly receives. It holds a
 * `SpeechBuffer` per participant, which is what stops four silent streams from costing
 * four streams' worth of transcription.
 */
export class RecallSession implements CaptureSession {
  readonly providerName = 'recall';
  private readonly buffers = new Map<string, SpeechBuffer>();
  private readonly speakers = new Map<string, Speaker>();
  private readonly startedAt = new Date();
  private speaking = false;
  private socket: WebSocket | null = null;
  /** Counters so a shape mismatch is logged a few times, not every frame. */
  private unrecognised = 0;
  private noParticipant = 0;

  constructor(
    readonly id: string,
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly events: CaptureEvents,
    private readonly logger: Logger,
    /** Compared against the token Recall presents when it connects. */
    readonly streamToken: string,
  ) {}

  /** Called by the gateway when Recall's websocket arrives and identifies this session. */
  attach(socket: WebSocket): void {
    this.socket = socket;
    this.events.onReady({ sessionId: this.id, joinedAt: this.startedAt });
    // Returned rather than voided, for the same two reasons as the live gateway: `void` on a
    // rejecting promise is an unhandled rejection, and a caller that cannot await the handler
    // has to guess how long it takes.
    socket.on('message', (raw: Buffer) =>
      this.onMessage(raw).catch((error: unknown) =>
        this.logger.error(`Recall message failed: ${String(error)}`),
      ),
    );
    socket.on('close', () => this.events.onEnded('The bot disconnected'));
  }

  private async onMessage(raw: Buffer): Promise<void> {
    let message: RecallMessage;
    try {
      message = JSON.parse(raw.toString()) as RecallMessage;
    } catch {
      return;
    }

    // Everything below drops messages it does not recognise. Silently doing that is how
    // "the bot is in the call but the transcript is empty" happens with nothing in the
    // logs, so the first few unfamiliar frames are recorded verbatim.
    if (this.unrecognised < 3 && !KNOWN_EVENTS.has(message.event ?? '')) {
      this.unrecognised++;
      this.logger.warn(`Unrecognised Recall frame: ${raw.toString().slice(0, 400)}`);
    }

    const participant = message.data?.data?.participant ?? message.data?.participant;
    if (!participant?.id) {
      if (message.event === 'audio_separate_raw.data' && this.noParticipant < 3) {
        this.noParticipant++;
        this.logger.warn(`Audio frame with no participant: ${raw.toString().slice(0, 400)}`);
      }
      return;
    }
    const speaker = this.rememberSpeaker(participant);

    if (message.event === 'participant_events.join') {
      return this.events.onSpeaker(speaker, 'joined');
    }
    if (message.event === 'participant_events.leave') {
      // Whatever they were mid-way through saying should not be lost.
      const held = this.buffers.get(speaker.id)?.drain();
      if (held) await this.emit(speaker, held);
      this.buffers.delete(speaker.id);
      return this.events.onSpeaker(speaker, 'left');
    }
    if (message.event !== 'audio_separate_raw.data') return;

    // The bot's own voice comes back on the mix; transcribing it would feed the agent
    // its own words and let it converse with itself.
    if (this.speaking) return;

    const encoded = message.data?.data?.buffer;
    if (!encoded) return;

    const pcm = Buffer.from(encoded, 'base64');
    const buffer = this.buffers.get(speaker.id) ?? new SpeechBuffer();
    this.buffers.set(speaker.id, buffer);

    const utterance = buffer.add(pcm);
    if (utterance) await this.emit(speaker, utterance);
  }

  private async emit(speaker: Speaker, pcm: Buffer): Promise<void> {
    const segment: AudioSegment = {
      speaker,
      // WAV rather than raw PCM: Gemini's documented formats do not include bare PCM.
      data: pcmToWav(pcm),
      mimeType: 'audio/wav',
      at: Math.round((Date.now() - this.startedAt.getTime()) / 1000),
      durationSeconds: pcm.length / 2 / 16_000,
    };
    try {
      await this.events.onSegment(segment);
    } catch (error) {
      this.events.onError(error as Error);
    }
  }

  private rememberSpeaker(participant: {
    id?: number | string;
    name?: string;
    is_host?: boolean;
  }): Speaker {
    const id = String(participant.id);
    const known = this.speakers.get(id);
    // Display names can change mid-meeting; the latest one wins, but identity does not.
    const speaker: Speaker = {
      id,
      name: participant.name ?? known?.name ?? 'Unknown participant',
      isHost: participant.is_host ?? known?.isHost,
    };
    this.speakers.set(id, speaker);
    return speaker;
  }

  /**
   * Speak into the meeting.
   *
   * Muted-when-idle is Recall's behaviour, not ours to implement — but the
   * `speaking` flag is ours, and it is what stops the bot transcribing itself.
   */
  async speak(audio: Buffer, mimeType: string): Promise<void> {
    if (mimeType !== 'audio/mp3' && mimeType !== 'audio/mpeg') {
      throw new Error(`Recall output expects MP3, not ${mimeType}`);
    }
    this.speaking = true;
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/bot/${this.id}/output_audio/`, {
        method: 'POST',
        headers: { Authorization: `Token ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'mp3', b64_data: audio.toString('base64') }),
      });
      if (!response.ok) {
        throw new Error(`Recall refused the audio: ${response.status} ${await response.text()}`);
      }
    } finally {
      // Held briefly after the request so the tail of the bot's own audio is ignored too.
      setTimeout(() => (this.speaking = false), 1_000);
    }
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  async leave(): Promise<void> {
    // Flush anything held, so a meeting ending mid-sentence keeps that sentence.
    for (const [speakerId, buffer] of this.buffers) {
      const held = buffer.drain();
      const speaker = this.speakers.get(speakerId);
      if (held && speaker) await this.emit(speaker, held);
    }
    this.buffers.clear();

    await fetch(`${this.baseUrl}/api/v1/bot/${this.id}/leave_call/`, {
      method: 'POST',
      headers: { Authorization: `Token ${this.apiKey}` },
    }).catch((error) => this.logger.warn(`Could not stop the bot: ${(error as Error).message}`));

    // The audio was streamed through and discarded here; whatever Recall kept is deleted
    // rather than left to expire. Short retention is the safety net, not the plan.
    await fetch(`${this.baseUrl}/api/v1/bot/${this.id}/delete_media/`, {
      method: 'POST',
      headers: { Authorization: `Token ${this.apiKey}` },
    }).catch((error) =>
      this.logger.warn(`Could not delete the recording: ${(error as Error).message}`),
    );

    this.socket?.close();
  }
}
