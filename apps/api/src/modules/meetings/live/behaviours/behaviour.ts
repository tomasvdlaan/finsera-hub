import type { Actor } from '@platform/contracts';
import type { ToolSet } from 'ai';
import type { LlmService } from '../../../../core/llm/llm.service.js';
import type { LiveSession, Proposal } from '../live-session.js';

/**
 * What a behaviour is given to work with.
 *
 * `tools` is the same tool set the chat assistant gets — built from the module manifests
 * and filtered by the user's own permissions, with restricted tools never offered. A
 * meeting behaviour can therefore look up a quote, read a contract or search past notes
 * without any of that being reimplemented here.
 */
export interface BehaviourContext {
  actor: Actor;
  session: LiveSession;
  note: {
    id: string;
    title: string;
    agenda: Array<{ id: string; title: string; covered: boolean }>;
  };
  /** The utterance that just arrived, when the behaviour was triggered by one. */
  latest?: { speaker?: string; text: string; at: number };
  tools: ToolSet;
  llm: LlmService;
  newId: () => string;
}

/**
 * What a behaviour wants to happen.
 *
 * Everything is a proposal or an utterance — nothing here mutates a record directly. A
 * behaviour that wanted to change something would do it through a tool, and the tools
 * that change things are `write:draft`, so the result still needs confirming.
 */
export interface BehaviourResult {
  /** Said aloud in the meeting, if the behaviour is allowed to speak. */
  speak?: string;
  /** Added to the side panel for the operator to accept or dismiss. */
  proposals?: Array<Omit<Proposal, 'id' | 'status'>>;
  /** Recorded in the log, so it is visible why a behaviour did nothing. */
  reason?: string;
  /**
   * Pushed straight to the screens watching this meeting.
   *
   * The third thing a behaviour can do, after proposing and speaking. Some findings are
   * neither: they are not a commitment somebody has to accept or dismiss, and they are
   * certainly not worth saying out loud — a policy document that turns out to be relevant is
   * useful on screen and an interruption in the room.
   *
   * Nothing here is persisted. It is context for the conversation happening now, and the
   * note keeps what the conversation produced.
   */
  broadcast?: Array<{ type: string } & Record<string, unknown>>;
}

/**
 * One thing the meeting agent knows how to do.
 *
 * Adding behaviour to the agent means adding one of these and registering it — not
 * editing the loop that runs the meeting. That separation is the point: the runner
 * handles audio, transcription and cost, and has no opinion about what the agent is for.
 */
export interface MeetingBehaviour {
  readonly name: string;
  readonly description: string;

  /**
   * `utterance` runs after each transcribed line; `interval` runs on a timer.
   *
   * Most behaviours are one or the other and few should be both: reacting to speech is
   * for things somebody said, and a timer is for things nobody said.
   */
  readonly trigger: 'utterance' | 'interval';
  readonly intervalMs?: number;

  /** Whether this behaviour may make the bot talk. Silent behaviours still propose. */
  readonly canSpeak: boolean;

  /**
   * Cheap check before doing anything expensive.
   *
   * Runs on every utterance, so it must not call a model. Its job is to decide whether
   * the behaviour is worth a round trip at all — the wake word check is a string search,
   * and that is exactly the intended shape.
   */
  shouldRun(ctx: BehaviourContext): boolean;
  /**
   * Drop whatever this behaviour remembers about a meeting that has ended.
   *
   * Optional, because most behaviours keep nothing. A behaviour that does — which proposals it
   * has already looked up, how much transcript it had last time — would otherwise hold a
   * little state per meeting for the life of the process.
   */
  forget?(noteId: string): void;

  run(ctx: BehaviourContext): Promise<BehaviourResult | null>;
}
