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
        /*
         * When the bot gives up, decided here rather than by whatever Recall defaults to.
         *
         * Left unset, the defaults govern — including a silence detector and a short
         * everyone-left timeout — and a bot that leaves for one of those reasons looks
         * identical from the room to one that crashed. These are the conditions we actually
         * want, and naming them means a future surprise is a change to this list.
         *
         * The generous one is `in_call_not_recording`: a meeting can sit quiet for a long
         * stretch and still be a meeting, and there is no cost to us in the bot waiting —
         * audio is transcribed on speech, so silence is nearly free.
         */
        automatic_leave: {
          // Nobody ever turned up. Twenty minutes, then stop paying for an empty room.
          noone_joined_timeout: 1200,
          // Everyone genuinely left. Not instant: a Teams reconnect empties the room for a
          // few seconds and the bot should still be there when people come back.
          everyone_left_timeout: 120,
          in_call_not_recording_timeout: 7200,
          recording_permission_denied_timeout: 60,
        },
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
/**
 * How long a dropped stream has to come back before the meeting is called over.
 *
 * Recall reconnected within eight seconds every time it was observed doing so, so a minute is
 * generous. It is the cost of being wrong in the other direction that sets it: ending early
 * evicts a bot from a meeting that is still running, and the only way back is for somebody to
 * notice and start again.
 */
const RECONNECT_GRACE_MS = 60_000;

/** How often to ping an idle stream. Well inside any idle timeout worth worrying about. */
const PING_EVERY_MS = 30_000;

export class RecallSession implements CaptureSession {
  readonly providerName = 'recall';
  private readonly buffers = new Map<string, SpeechBuffer>();
  private readonly speakers = new Map<string, Speaker>();
  private readonly startedAt = new Date();
  private speaking = false;
  /** False while the meeting is paused; incoming audio is discarded rather than buffered. */
  private listening = true;
  private socket: WebSocket | null = null;
  /** Counters so a shape mismatch is logged a few times, not every frame. */
  private unrecognised = 0;
  private noParticipant = 0;
  /** Running while the stream is gone but the bot may still come back — see `onClosed`. */
  private reconnectTimer: NodeJS.Timeout | null = null;
  /** Keeps the stream from being closed for being quiet — see `attach`. */
  private pingTimer: NodeJS.Timeout | null = null;
  /** Set once the meeting is deliberately over, so a late close cannot re-end it. */
  private finished = false;

  constructor(
    readonly id: string,
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly events: CaptureEvents,
    private readonly logger: Logger,
    /** Compared against the token Recall presents when it connects. */
    readonly streamToken: string,
  ) {}

  /**
   * Called by the gateway when Recall's websocket arrives and identifies this session.
   *
   * May be called more than once for one meeting. Recall's realtime stream reconnects when it
   * drops, and it drops: on a real recording the connection was closed from our end roughly
   * every eight minutes, with Recall logging "peer closed connection without sending TLS
   * close_notify" and reconnecting within seconds. That is ordinary and the meeting should not
   * notice it.
   */
  attach(socket: WebSocket): void {
    const previous = this.socket;
    this.socket = socket;

    // The bot is back. Whatever grace period was running is over, and nothing ended.
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.logger.log(`Recall stream for ${this.id} came back; the meeting continues`);
    }

    /*
     * The old socket's listeners go before the new one's arrive.
     *
     * This is the bug that ended three real meetings. `close` fires late — up to a minute or
     * two after the connection actually failed — so the dead socket's handler ran AFTER the
     * replacement had attached, ended the session, and made the server post `leave_call`. In
     * Recall's own log: reconnect succeeds at 15:11:12, we evict the bot at 15:11:13.
     */
    previous?.removeAllListeners();
    if (previous && previous !== socket) previous.close();

    this.startPing(socket);
    this.events.onReady({ sessionId: this.id, joinedAt: this.startedAt });
    // Returned rather than voided, for the same two reasons as the live gateway: `void` on a
    // rejecting promise is an unhandled rejection, and a caller that cannot await the handler
    // has to guess how long it takes.
    socket.on('message', (raw: Buffer) =>
      this.onMessage(raw).catch((error: unknown) =>
        this.logger.error(`Recall message failed: ${String(error)}`),
      ),
    );
    socket.on('close', () => this.onClosed(socket));
    socket.on('error', (error: Error) =>
      this.logger.warn(`Recall stream error on ${this.id}: ${error.message}`),
    );
  }

  /**
   * The stream went away. That is not the same as the meeting being over.
   *
   * It used to be treated as the same thing: any close ended the session, wrote up the note and
   * told the bot to leave a call it was still sitting in. Recall would reconnect a few seconds
   * later and find nothing to attach to — ten such reconnects were refused across one
   * afternoon, and each looked, from the room, like the bot wandering off for no reason.
   *
   * So a close starts a clock instead. Reconnect inside it and the meeting never noticed;
   * miss it and the meeting ends as before, with a reason that says what actually happened.
   */
  private onClosed(socket: WebSocket): void {
    // A late close from a socket that has already been replaced. The meeting is fine.
    if (socket !== this.socket) return;
    if (this.finished || this.reconnectTimer) return;

    this.stopPing();
    this.logger.warn(
      `Recall stream for ${this.id} dropped; waiting ${RECONNECT_GRACE_MS / 1000}s for it to return`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.events.onEnded('The bot stopped sending audio and did not come back');
    }, RECONNECT_GRACE_MS);
  }

  /**
   * A ping every half minute, because a quiet meeting is not an abandoned one.
   *
   * Nothing kept the stream warm, so a stretch with no audio looked like an idle connection to
   * whatever sits between us and Recall, and it was closed. A ping is the cheapest frame there
   * is and it makes the connection's silence indistinguishable from its use.
   */
  private startPing(socket: WebSocket): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (socket.readyState === socket.OPEN) socket.ping();
    }, PING_EVERY_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
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

    // Paused. Dropped here rather than upstream so it is never even buffered into an
    // utterance — see setListening.
    if (!this.listening) return;

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

  /**
   * Stop or start taking audio in.
   *
   * The buffers are dropped on the way into a pause, not kept. Half an utterance captured
   * just before it would otherwise be flushed on the way out — a fragment of the sentence
   * somebody paused the meeting to say, arriving in the transcript minutes later with nothing
   * around it to explain it.
   *
   * The bot stays in the call. It cannot be made truly deaf from here — the audio is already
   * being sent to us by the provider — so what this buys is that nothing is buffered,
   * transcribed, stored or charged. The refusal in LiveRunner.onSegment is the guarantee.
   */
  async setListening(listening: boolean): Promise<void> {
    this.listening = listening;
    if (!listening) this.buffers.clear();
  }

  async leave(): Promise<void> {
    // Deliberate: no grace period applies, and a close from here must not re-end anything.
    this.finished = true;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

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

    this.socket?.removeAllListeners();
    this.socket?.close();
  }
}
