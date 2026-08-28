/**
 * The meeting capture seam.
 *
 * Everything above this interface — consent, the rolling window, extraction, proposals,
 * cost metering — is indifferent to where audio comes from. That matters more here than
 * usual for two reasons: Microsoft is actively restricting third-party bots in Teams, so
 * the chosen provider may become unusable at some clients through no fault of its own;
 * and a client whose DPA forbids sub-processors cannot use a hosted bot at all.
 *
 * Two implementations exist:
 *   - `recall`  — a bot joins the meeting; separate audio per participant with roster
 *                 identity attached, so attribution is a property of the transport.
 *   - `browser` — the operator's own browser captures tab audio and microphone; no vendor,
 *                 no admission, and complete attribution for a one-to-one call.
 *
 * A third (self-hosted Attendee) is documented in the decision log as the escape hatch if
 * the processor becomes unacceptable. It would implement this same interface.
 */

/** Who said something. `id` is stable within one session. */
export interface Speaker {
  id: string;
  name: string;
  /** Often absent when the bot is a guest in another organisation's tenant. */
  email?: string | null;
  isHost?: boolean;
  /** True for the operator, so the UI can tell "me" from "them" without guessing. */
  isSelf?: boolean;
}

/** One piece of audio from one speaker, already known to contain speech. */
export interface AudioSegment {
  speaker: Speaker;
  data: Buffer;
  mimeType: string;
  /** Seconds since the session started. */
  at: number;
  durationSeconds: number;
}

export interface CaptureEvents {
  onReady: (info: { sessionId: string; joinedAt: Date }) => void;
  onSpeaker: (speaker: Speaker, event: 'joined' | 'left') => void;
  onSegment: (segment: AudioSegment) => void | Promise<void>;
  onError: (error: Error) => void;
  onEnded: (reason: string) => void;
}

export interface CaptureSession {
  readonly id: string;
  readonly providerName: string;
  /**
   * Speak into the meeting. Resolves once the audio has been handed over, not once it
   * has finished playing.
   *
   * Implementations must leave the bot muted when not speaking — an open microphone in a
   * client meeting is an unpleasant surprise, and it feeds the bot's own voice back into
   * transcription.
   */
  speak(audio: Buffer, mimeType: string): Promise<void>;
  /** True while the bot's own audio is playing, so transcription can ignore itself. */
  isSpeaking(): boolean;
  /**
   * Stop or start taking audio in, without leaving the meeting.
   *
   * Optional, and honestly so: how deaf a provider can be made varies, and the layer above
   * does not depend on the answer. A browser genuinely stops — it releases the microphone or
   * the shared tab, and the operating system's recording indicator goes out. A bot sitting in
   * somebody else's call cannot promise that much: the most it can do is discard what arrives
   * and drop any half-finished utterance, so nothing is transcribed, stored or charged.
   *
   * Which is why the runner refuses paused segments itself rather than relying on this. This
   * is the improvement where it is available, never the guarantee.
   */
  setListening?(listening: boolean): Promise<void>;
  leave(): Promise<void>;
}

export interface JoinOptions {
  /** The Teams (or other) meeting URL. */
  meetingUrl: string;
  /** What the bot is called in the participant list. Never covert. */
  botName: string;
  noteId: string;
}

export interface MeetingCaptureProvider {
  readonly name: string;
  /** Whether this provider can be used at all — e.g. an API key is configured. */
  isConfigured(): boolean;
  /** Whether attribution comes from the transport rather than from guessing. */
  readonly hasPerSpeakerAudio: boolean;
  join(options: JoinOptions, events: CaptureEvents): Promise<CaptureSession>;
}
