import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { RegistryService } from '../../../core/registry/registry.service.js';
import { MeetingsService } from '../meetings.service.js';
import type { AudioSegment, CaptureEvents, MeetingCaptureProvider } from './capture/provider.js';
import { RecallProvider } from './capture/recall.provider.js';
import { LiveRegistry } from './live-registry.service.js';
import { LiveService } from './live.service.js';
import { LiveSession } from './live-session.js';
import { ConversationService } from './conversation.service.js';
import { AiToolRegistry } from '../../../core/llm/tool-registry.service.js';
import { LlmService } from '../../../core/llm/llm.service.js';
import { TtsService } from '../../../core/llm/tts.service.js';
import { BehaviourRegistry, type BehaviourSettings } from './behaviours/behaviour.registry.js';
import { assembleBody, bodyInput } from './session-body.js';

/**
 * Runs one live meeting, whatever is supplying the audio.
 *
 * This is the layer the capture seam exists for: it takes attributed audio segments in
 * and produces transcript lines, proposals and cost — with no idea whether a bot joined
 * the call or the operator's browser is listening to a tab.
 *
 * Nothing here acts on the meeting. Proposals accumulate and are written when the session
 * ends, still needing a decision.
 */
@Injectable()
export class LiveRunner {
  private readonly logger = new Logger(LiveRunner.name);

  constructor(
    private readonly registry: RegistryService,
    private readonly meetings: MeetingsService,
    private readonly live: LiveService,
    private readonly sessions: LiveRegistry,
    private readonly recall: RecallProvider,
    private readonly conversation: ConversationService,
    private readonly behaviours: BehaviourRegistry,
    private readonly toolRegistry: AiToolRegistry,
    private readonly llm: LlmService,
    private readonly tts: TtsService,
  ) {}

  /** What each running meeting has switched on. */
  private readonly settings = new Map<string, BehaviourSettings>();

  behaviourSettings(noteId: string): BehaviourSettings {
    let current = this.settings.get(noteId);
    if (!current) {
      current = this.behaviours.defaults();
      this.settings.set(noteId, current);
    }
    return current;
  }

  configure(noteId: string, patch: { enabled?: string[]; maySpeak?: boolean }): BehaviourSettings {
    const current = this.behaviourSettings(noteId);
    if (patch.enabled) current.enabled = new Set(patch.enabled);
    if (patch.maySpeak !== undefined) current.maySpeak = patch.maySpeak;
    this.settings.set(noteId, current);
    return current;
  }

  listBehaviours() {
    return this.behaviours.list();
  }

  /**
   * Meetings where the bot is allowed to talk back.
   *
   * Off by default and per meeting, because a speaking bot is a much bigger presence in
   * a client's meeting than a silent one — and the extraction that makes this useful
   * works either way.
   */
  private readonly chatty = new Set<string>();

  setChatty(noteId: string, on: boolean): void {
    if (on) this.chatty.add(noteId);
    else this.chatty.delete(noteId);
  }

  isChatty(noteId: string): boolean {
    return this.chatty.has(noteId);
  }

  /**
   * Send a bot to a meeting.
   *
   * The consent gate is checked here rather than at the socket, because with a bot the
   * audio arrives from the internet long after anyone clicked anything — refusing at that
   * point would mean the bot had already sat in the client's meeting.
   */
  async startBot(actor: Actor, noteId: string, meetingUrl: string) {
    const note = await this.meetings.get(actor, noteId);
    if (!note.everyoneConsented) {
      throw new BadRequestException(
        'Every attendee must be recorded as having consented before a bot can join',
      );
    }
    if (!this.recall.isConfigured()) {
      throw new BadRequestException('RECALL_API_KEY is not set');
    }
    if (this.sessions.get(noteId)) {
      throw new BadRequestException('This meeting is already being captured');
    }

    const live = new LiveSession(noteId, actor.userId);
    this.sessions.start(noteId, live);

    const capture = await this.recall
      .join(
        {
          meetingUrl,
          // Named, never covert. The client sees who is in their meeting.
          botName: process.env.RECALL_BOT_NAME ?? 'Finsera Notulist',
          noteId,
        },
        this.eventsFor(actor, noteId, live),
      )
      .catch(async (error: Error) => {
        await this.sessions.end(noteId);
        throw new BadRequestException(`The bot could not join: ${error.message}`);
      });

    this.sessions.attachCapture(noteId, capture);
    this.startBehaviourTimer(actor, noteId, live);
    return { noteId, provider: capture.providerName, sessionId: capture.id };
  }

  /** The provider-agnostic handlers. Any capture provider drives the same pipeline. */
  eventsFor(actor: Actor, noteId: string, live: LiveSession): CaptureEvents {
    return {
      onReady: ({ joinedAt }) =>
        this.sessions.broadcast(noteId, { type: 'ready', joinedAt: joinedAt.toISOString() }),

      onSpeaker: (speaker, event) => {
        this.sessions.broadcast(noteId, { type: 'speaker', speaker, event });
        // The roster is the truth about who is in the room; the typed list was a guess.
        if (event === 'joined') void this.noteAttendance(actor, noteId, speaker);
      },

      onSegment: (segment) => this.onSegment(actor, noteId, live, segment),

      onError: (error) => {
        this.logger.warn(`Capture error on ${noteId}: ${error.message}`);
        this.sessions.broadcast(noteId, { type: 'error', message: error.message });
      },

      onEnded: (reason) => {
        this.sessions.broadcast(noteId, { type: 'ended', reason });
        void this.stop(actor, noteId).catch(() => undefined);
      },
    };
  }

  /**
   * One attributed utterance: transcribe it, publish it, and extract if enough has
   * accumulated.
   *
   * Segments arrive already gated for speech, so every call here is one somebody
   * actually said something.
   */
  private async onSegment(
    actor: Actor,
    noteId: string,
    live: LiveSession,
    segment: AudioSegment,
  ): Promise<void> {
    try {
      const text = await this.live.transcribeSegment(live, segment.data, segment.mimeType);
      const line = live.addLine(text, segment.speaker, segment.at);
      if (!line) return;

      this.sessions.broadcast(noteId, { type: 'line', line });
      this.sessions.broadcast(noteId, {
        type: 'cost',
        costCents: this.live.costCents(live),
      });

      if (live.shouldExtract()) void this.tick(actor, noteId, live);
      void this.runBehaviours('utterance', actor, noteId, live, {
        speaker: line.speaker,
        text: line.text,
        at: line.at,
      });
      // The freeform conversational mode is a testing aid that sits alongside the
      // behaviours rather than inside them: it has no trigger and no purpose beyond
      // proving the loop works.
      if (this.chatty.has(noteId)) void this.maybeSpeak(actor, noteId, live);
    } catch (error) {
      // A failed utterance loses a sentence. It must not end the meeting.
      this.logger.warn(`Segment failed on ${noteId}: ${(error as Error).message}`);
    }
  }

  /**
   * Consider saying something out loud.
   *
   * Never blocks the transcript: if the reply is slow or fails, audio keeps arriving and
   * the meeting record is unaffected. Speaking is the optional half.
   */
  private async maybeSpeak(actor: Actor, noteId: string, live: LiveSession): Promise<void> {
    const entry = this.sessions.get(noteId);
    if (!entry?.capture || entry.capture.isSpeaking()) return;
    if (!this.conversation.mayReply(noteId, true)) return;

    try {
      const note = await this.meetings.get(actor, noteId);
      const reply = await this.conversation.reply(live, {
        chatty: true,
        meetingTitle: note.title,
        agenda: note.agenda.filter((a) => !a.covered).map((a) => a.title),
      });
      if (!reply) return;

      await entry.capture.speak(reply.mp3, reply.mimeType);
      // Recorded in the transcript as itself, so the meeting record shows what the
      // assistant said rather than pretending it was silent.
      const line = live.addLine(reply.text, { id: 'assistant', name: 'Assistant' });
      if (line) this.sessions.broadcast(noteId, { type: 'line', line });
      this.sessions.broadcast(noteId, { type: 'spoke', text: reply.text });
    } catch (error) {
      this.logger.warn(`Could not speak on ${noteId}: ${(error as Error).message}`);
    }
  }

  /**
   * Record someone the bot saw, and surface it if they were never asked for consent.
   *
   * The bot itself appears on the roster and is skipped: it is a participant, but not one
   * whose agreement means anything.
   */
  private async noteAttendance(
    actor: Actor,
    noteId: string,
    speaker: { id: string; name: string; email?: string | null },
  ): Promise<void> {
    const botName = process.env.RECALL_BOT_NAME ?? 'Finsera Notulist';
    if (speaker.name === botName || speaker.name === 'Assistant') return;

    try {
      const note = await this.meetings.recordAttendance(actor, noteId, {
        name: speaker.name,
        email: speaker.email ?? null,
      });
      this.sessions.broadcast(noteId, {
        type: 'attendees',
        attendees: note.attendees,
        unconsentedPresent: note.unconsentedPresent.map((p) => p.name),
      });
    } catch (error) {
      this.logger.warn(`Could not record attendance on ${noteId}: ${(error as Error).message}`);
    }
  }

  /**
   * Run the behaviours that are due.
   *
   * They get the same tool set the chat assistant does — built from the manifests and
   * filtered by the operator's own permissions, with restricted tools never offered. So
   * "what did we quote them last time?" is answerable in a meeting for exactly the same
   * reason it is answerable in the chat, with no second implementation to keep in step.
   */
  private async runBehaviours(
    trigger: 'utterance' | 'interval',
    actor: Actor,
    noteId: string,
    live: LiveSession,
    latest?: { speaker?: string; text: string; at: number },
  ): Promise<void> {
    const settings = this.behaviourSettings(noteId);
    if (settings.enabled.size === 0) return;

    try {
      const note = await this.meetings.get(actor, noteId);
      const { tools } = await this.toolRegistry.buildToolSet(actor);

      const results = await this.behaviours.run(trigger, {
        actor,
        session: live,
        note: {
          id: noteId,
          title: note.title,
          agenda: note.agenda.map((a) => ({ id: a.id, title: a.title, covered: a.covered })),
        },
        latest,
        tools,
        llm: this.llm,
        newId: () => this.registry.newId(),
      }, settings);

      for (const result of results) {
        if (result.proposals?.length) {
          const added = live.mergeProposals(result.proposals, () => this.registry.newId());
          if (added.length > 0) {
            this.sessions.broadcast(noteId, { type: 'proposals', proposals: added });
          }
        }
        if (result.speak) await this.say(noteId, live, result.speak);
      }

      // Push the assistant's notes to the screen as they are revised. The document is
      // only written when the meeting ends, so a revision every ninety seconds does not
      // fill the note's history with drafts.
      if (live.aiNotes) this.sessions.broadcast(noteId, { type: 'notes', markdown: live.aiNotes });
    } catch (error) {
      this.logger.warn(`Behaviours failed on ${noteId}: ${(error as Error).message}`);
    }
  }

  /** Say something aloud and record that it was said. */
  private async say(noteId: string, live: LiveSession, text: string): Promise<void> {
    const entry = this.sessions.get(noteId);
    if (!entry?.capture || entry.capture.isSpeaking()) return;

    const spoken = await this.tts.speak(text);
    await entry.capture.speak(spoken.mp3, spoken.mimeType);

    const line = live.addLine(text, { id: 'assistant', name: 'Assistant' });
    if (line) this.sessions.broadcast(noteId, { type: 'line', line });
    this.sessions.broadcast(noteId, { type: 'spoke', text });
  }

  /** The timer for interval-triggered behaviours, e.g. watching for agenda drift. */
  private startBehaviourTimer(actor: Actor, noteId: string, live: LiveSession): void {
    const timer = setInterval(() => {
      if (!this.sessions.get(noteId)) return clearInterval(timer);
      void this.runBehaviours('interval', actor, noteId, live);
    }, 60_000);
    this.timers.set(noteId, timer);
  }

  private readonly timers = new Map<string, NodeJS.Timeout>();

  private async tick(actor: Actor, noteId: string, live: LiveSession): Promise<void> {
    live.extracting = true;
    try {
      const note = await this.meetings.get(actor, noteId);
      const { added, state } = await this.live.extract(
        live,
        note.agenda.map((a) => ({ id: a.id, title: a.title, covered: a.covered })),
        () => this.registry.newId(),
      );
      if (added.length > 0) this.sessions.broadcast(noteId, { type: 'proposals', proposals: added });
      this.sessions.broadcast(noteId, { type: 'state', state });
    } catch (error) {
      this.logger.warn(`Extraction failed on ${noteId}: ${(error as Error).message}`);
    } finally {
      live.extracting = false;
    }
  }

  /**
   * End the meeting and write what it produced.
   *
   * The transcript is attributed where the provider knew who spoke, which is what makes
   * it worth reading afterwards rather than merely worth having.
   */
  async stop(actor: Actor, noteId: string) {
    this.chatty.delete(noteId);
    this.conversation.forget(noteId);
    this.behaviours.forget(noteId);
    this.settings.delete(noteId);
    const timer = this.timers.get(noteId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(noteId);
    }
    const live = await this.sessions.end(noteId);
    if (!live || live.lines.length === 0) return { saved: false };

    const note = await this.meetings.get(actor, noteId);

    await this.meetings.update(actor, noteId, { body: assembleBody(bodyInput(live, note.body)) });

    for (const proposal of live.openProposals) {
      if (proposal.kind === 'action') {
        await this.meetings.addActionItem(actor, noteId, { text: proposal.text, source: 'ai' });
      }
    }

    const costCents = this.live.costCents(live);
    // Rounded cents read as "0" for a short meeting, which looks like broken metering
    // rather than a cheap one. The token counts are kept so the real figure is
    // recoverable, and the UI says "under a cent" instead of nothing.
    await this.meetings.recordTranscription(actor, noteId, {
      tokens: live.tokensIn + live.tokensOut,
      costCents,
      durationSeconds: live.durationSeconds,
    });

    this.sessions.broadcast(noteId, { type: 'stopped', costCents, lines: live.lines.length });
    return { saved: true, costCents, lines: live.lines.length };
  }

  /** Speak into the meeting, if the provider supports it. */
  async speak(noteId: string, audio: Buffer, mimeType: string): Promise<void> {
    const entry = this.sessions.get(noteId);
    if (!entry?.capture) throw new BadRequestException('No live capture for this meeting');
    await entry.capture.speak(audio, mimeType);
  }

  /**
   * Whether a session is running, and what it has produced so far.
   *
   * The browser holds its live state in memory, so a refresh loses it — but the meeting
   * has not stopped, and a panel that shows "not running" while a bot sits in the call
   * is worse than useless. This lets a reload pick the session back up.
   */
  status(noteId: string) {
    const entry = this.sessions.get(noteId);
    if (!entry) return { running: false as const };
    return {
      running: true as const,
      provider: entry.capture?.providerName ?? 'browser',
      startedAt: entry.live.startedAt.toISOString(),
      lines: entry.live.lines,
      proposals: entry.live.openProposals,
      state: entry.live.state,
      costCents: this.live.costCents(entry.live),
      speakers: [...entry.live.speakers.values()],
    };
  }

  providers(): MeetingCaptureProvider[] {
    return [this.recall];
  }
}

