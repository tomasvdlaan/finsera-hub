import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { RegistryService } from '../../../core/registry/registry.service.js';
import { MeetingsService } from '../meetings.service.js';
import type { AudioSegment, CaptureEvents, MeetingCaptureProvider } from './capture/provider.js';
import { RecallProvider } from './capture/recall.provider.js';
import { LiveRegistry } from './live-registry.service.js';
import { LiveService } from './live.service.js';
import { LiveSession, type Proposal } from './live-session.js';
import { ConversationService } from './conversation.service.js';
import { AiToolRegistry } from '../../../core/llm/tool-registry.service.js';
import { LlmService } from '../../../core/llm/llm.service.js';
import { TtsService } from '../../../core/llm/tts.service.js';
import { BehaviourRegistry, type BehaviourSettings } from './behaviours/behaviour.registry.js';
import { NOTED_SECTION, applySession, notedMarkdown, sessionSummary } from './session-body.js';
import { NoteDocService } from '../doc/note-doc.service.js';
import { replaceSectionMarkdown } from '../doc/note-edit.js';
import { AI_NOTES_SECTION } from './behaviours/note-taker.behaviour.js';

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
  /** The last notes written into each document, so an unrevised section is not rewritten. */
  private readonly writtenNotes = new Map<string, string>();

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
    private readonly docs: NoteDocService,
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
    // The note learns when the meeting actually began, not just which day it was filed on.
    await this.meetings.stampSession(actor, noteId, { startedAt: live.startedAt });

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
      onReady: ({ joinedAt }) => {
        // Kept as well as broadcast, so a tab that arrives later still learns it.
        live.joinedAt = joinedAt;
        this.sessions.broadcast(noteId, { type: 'ready', joinedAt: joinedAt.toISOString() });
      },

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
          const suggestions = await this.recordNotes(actor, noteId, live, added);
          if (suggestions.length > 0) {
            this.sessions.broadcast(noteId, { type: 'proposals', proposals: suggestions });
          }
        }
        if (result.speak) await this.say(noteId, live, result.speak);
        // Straight to the screens watching, unpersisted. See BehaviourResult.broadcast.
        for (const message of result.broadcast ?? []) {
          this.sessions.broadcast(noteId, message);
        }
      }

      // Into the document as they are revised, and onto the screens watching.
      await this.writeNotes(actor, noteId, live);
      if (live.aiNotes) this.sessions.broadcast(noteId, { type: 'notes', markdown: live.aiNotes });
    } catch (error) {
      this.logger.warn(`Behaviours failed on ${noteId}: ${(error as Error).message}`);
    }
  }

  /**
   * Accept or dismiss one of the agent's suggestions, mid-meeting.
   *
   * Everything a suggestion could become was already reachable — an action point, a covered
   * agenda item — but only after the recording stopped, and only by working through a list.
   * So the agent's contribution arrived as homework at exactly the moment the meeting was
   * over and nobody wanted any.
   *
   * Accepting does now what stopping would have done later, which is the property worth
   * keeping: an accepted action becomes the same proposed action point on the note, from
   * the same source, so nothing behaves differently for having been decided early. It does
   * NOT go straight onto the board — that needs a project and is a commitment the room
   * should make deliberately, and the note offers it one step later.
   */
  async decideProposal(
    actor: Actor,
    noteId: string,
    proposalId: string,
    decision: 'accepted' | 'dismissed',
  ): Promise<{ decided: boolean }> {
    const entry = this.sessions.get(noteId);
    if (!entry) throw new BadRequestException('This meeting is not being recorded');

    const proposal = entry.live.decide(proposalId, decision);
    // Already decided, or never existed. Not an error: two people in the room may press the
    // same button, and the second press should agree with the first rather than fail.
    if (!proposal) return { decided: false };

    if (decision === 'accepted') {
      try {
        if (proposal.kind === 'action') {
          await this.meetings.addActionItem(actor, noteId, { text: proposal.text, source: 'ai' });
        } else if (proposal.kind === 'agenda_covered' && proposal.agendaItemId) {
          await this.meetings.setAgendaCovered(actor, noteId, proposal.agendaItemId, true);
        }
        // A decision or a note needs nothing done to it: staying open is what puts it in the
        // note at the end, and that is what accepting one means.
      } catch (error) {
        /*
         * Put it back, or the suggestion is lost in both directions — decided here and never
         * written anywhere. Open is the honest state for something that was not applied.
         */
        proposal.status = 'open';
        throw error;
      }
    }

    // So every screen watching this meeting agrees, including the one that did not press.
    this.sessions.broadcast(noteId, {
      type: 'proposal_decided',
      id: proposal.id,
      decision,
    });
    return { decided: true };
  }

  /**
   * Put the assistant's notes into the note while the meeting is still running.
   *
   * They were only ever written when the recording stopped, so a meeting produced nothing
   * visible in the document for its whole length and then everything at once at the end.
   * The notes existed the entire time — the note-taker revises them every ninety seconds —
   * they were just held in memory and broadcast to the panel, which is a different thing
   * from being in the note you have open.
   *
   * The original reason for waiting was that a revision every ninety seconds would fill the
   * note's history with drafts. It does not: `steps` is a bounded in-memory buffer for
   * collaborative sync, and there is no persisted history of a note body to fill. What a
   * write actually costs is one debounced UPDATE and a re-index — which is strictly less
   * than a person typing the same notes by hand, since their every pause flushes too.
   *
   * Safe against whatever else is happening in the document because it replaces one section
   * by heading rather than writing the body: everything outside `## Notes from the meeting`
   * is untouched, so somebody typing their own summary during the meeting keeps it.
   */
  private async writeNotes(actor: Actor, noteId: string, live: LiveSession): Promise<void> {
    const markdown = live.aiNotes?.trim();
    if (!markdown) return;
    // The note-taker leaves `aiNotes` alone when nothing new was said, so an unchanged
    // section means there is nothing to write — and writing it anyway would produce a
    // no-op revision every ninety seconds for the length of a quiet meeting.
    if (this.writtenNotes.get(noteId) === markdown) return;

    try {
      await this.docs.edit(noteId, actor, (tr) =>
        replaceSectionMarkdown(tr, AI_NOTES_SECTION, markdown),
      );
      this.writtenNotes.set(noteId, markdown);
    } catch (error) {
      /*
       * Never fatal. The end-of-session write covers the same section from the same source,
       * so a failure here costs liveness and not the notes — and a meeting that stopped
       * recording because the document was briefly unavailable would be a much worse trade.
       */
      this.logger.warn(`Could not write live notes on ${noteId}: ${(error as Error).message}`);
    }
  }

  /**
   * Put what it noticed into the document, and keep it out of the waiting pile.
   *
   * A note is an observation — "Tomas mentioned the scheduling logic could be inverted" —
   * and there is nothing to decide about one. Asking anyway produced a column of cards whose
   * only possible answer was yes, next to a document that did not contain the thing the
   * meeting was about. So notes go straight in, and the cards are left for the two kinds of
   * suggestion that genuinely need an answer: an action, which becomes somebody's task, and
   * a decision, which is a claim about what the room agreed.
   *
   * They are marked accepted rather than dropped, so the session still deduplicates them by
   * text and the end-of-session write knows they are already on the page.
   *
   * Returns what is still worth showing as a suggestion. Every path that produces proposals
   * calls this — the behaviours, the runner's extraction and the socket's — because three
   * copies of this rule is how the bot and the browser came to write different notes for the
   * same meeting.
   */
  async recordNotes(
    actor: Actor,
    noteId: string,
    live: LiveSession,
    added: Proposal[],
  ): Promise<Proposal[]> {
    const notes = added.filter((p) => p.kind === 'note');
    if (notes.length === 0) return added;

    for (const note of notes) live.decide(note.id, 'accepted');

    const markdown = notedMarkdown(live.keptProposals);
    if (markdown) {
      try {
        await this.docs.edit(noteId, actor, (tr) =>
          replaceSectionMarkdown(tr, NOTED_SECTION, markdown),
        );
      } catch (error) {
        /*
         * Never fatal, for the same reason as writeNotes: applySession replaces this exact
         * section from the same source when the recording stops, so a failure here costs
         * liveness rather than the notes.
         */
        this.logger.warn(`Could not write live notes on ${noteId}: ${(error as Error).message}`);
      }
    }

    return added.filter((p) => p.kind !== 'note');
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

  /**
   * Run the utterance behaviours for a session this runner is not driving.
   *
   * The socket path transcribes its own audio — it has no capture provider to take
   * segments from — but everything after a line exists is identical, and duplicating it
   * is how the two paths drifted apart in the first place.
   */
  async onUtterance(
    actor: Actor,
    noteId: string,
    live: LiveSession,
    latest: { speaker?: string; text: string; at: number },
  ): Promise<void> {
    await this.runBehaviours('utterance', actor, noteId, live, latest);
  }

  /** Start the interval behaviours for a session started elsewhere, e.g. by the socket. */
  startBehaviours(actor: Actor, noteId: string, live: LiveSession): void {
    this.startBehaviourTimer(actor, noteId, live);
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
      const suggestions = await this.recordNotes(actor, noteId, live, added);
      if (suggestions.length > 0) {
        this.sessions.broadcast(noteId, { type: 'proposals', proposals: suggestions });
      }
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
    /*
     * Forgotten, or a second recording onto the same note would compare its first notes
     * against the last ones from the previous recording and decline to write them.
     */
    this.writtenNotes.delete(noteId);
    const timer = this.timers.get(noteId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(noteId);
    }
    // Read before ending, because ending takes the session off the register and the
    // provider is the only thing that says whether a bot or a browser was listening.
    const provider = this.sessions.get(noteId)?.capture?.providerName ?? 'browser';

    const ended = await this.sessions.end(noteId);
    if (!ended) return { saved: false };
    const { live, watchers } = ended;

    /*
     * The end time is stamped here, before anything is written.
     *
     * It used to sit below the empty-session return, so a recording that captured nothing
     * left the note with a start and no end — which reads as still running, forever, and
     * there is no way to tell it apart from a meeting that never stopped. The session has
     * ended by this line whatever it produced, so this is where the fact belongs.
     */
    await this.meetings.stampSession(actor, noteId, { endedAt: new Date() });

    if (live.lines.length === 0) {
      // Still tell the screen, or a recording that captured nothing looks like one that
      // is somehow still going.
      this.sessions.push(watchers, { type: 'stopped', costCents: 0, lines: 0 });
      return { saved: false };
    }

    const costCents = this.live.costCents(live);

    // The transcript first, and as its own record. If the body write fails after this, what
    // was said is still saved — the other order loses the speech to keep the summary.
    await this.meetings.saveTranscript(actor, noteId, {
      startedAt: live.startedAt,
      durationSeconds: live.durationSeconds,
      provider,
      lines: live.lines,
      tokens: live.tokensIn + live.tokensOut,
      costCents,
    });

    /*
     * Through the document authority, and flushed before anything reads the note back.
     *
     * This was the last whole-body write in the platform: it took the copy of the body it had
     * fetched before the transcript was saved, rebuilt the entire string, and wrote it over
     * the top — so stopping a recording while somebody was still typing discarded everything
     * they had written since the fetch. As bounded edits it merges with them instead.
     */
    await this.docs.edit(noteId, actor, (tr) => applySession(tr, sessionSummary(live)));
    await this.docs.flush(noteId);

    for (const proposal of live.openProposals) {
      if (proposal.kind === 'action') {
        await this.meetings.addActionItem(actor, noteId, { text: proposal.text, source: 'ai' });
      }
    }

    // Rounded cents read as "0" for a short meeting, which looks like broken metering
    // rather than a cheap one. The token counts are kept so the real figure is
    // recoverable, and the UI says "under a cent" instead of nothing.
    await this.meetings.recordTranscription(actor, noteId, {
      tokens: live.tokensIn + live.tokensOut,
      costCents,
      durationSeconds: live.durationSeconds,
    });

    // Pushed to the watchers handed back by end(), not broadcast by note id: the session
    // is off the register by now, so a lookup would find nothing to send to.
    this.sessions.push(watchers, { type: 'stopped', costCents, lines: live.lines.length });
    return { saved: true, costCents, lines: live.lines.length };
  }

  /** Speak into the meeting, if the provider supports it. */
  async speak(noteId: string, audio: Buffer, mimeType: string): Promise<void> {
    const entry = this.sessions.get(noteId);
    if (!entry?.capture) throw new BadRequestException('No live capture for this meeting');
    await entry.capture.speak(audio, mimeType);
  }

  /**
   * Which meetings are being recorded right now.
   *
   * The register already knows; nothing could ask it. A meeting started in another tab, or
   * left running while you went to look at something else, was invisible to every page but
   * the one that started it.
   */
  active(): Array<{ noteId: string; startedAt: string; provider: string }> {
    return this.sessions.active.map((noteId) => {
      const entry = this.sessions.get(noteId)!;
      return {
        noteId,
        startedAt: entry.live.startedAt.toISOString(),
        provider: entry.capture?.providerName ?? 'browser',
      };
    });
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
      /**
       * Nobody is feeding this meeting audio at the moment.
       *
       * True between a recording tab going away and one coming back — the window that makes
       * a page reload survivable. A browser that sees this knows to take the session over
       * rather than watch it, and `source` says whether it can pick the audio back up on its
       * own: a microphone it can, a shared tab always needs a fresh gesture.
       */
      awaitingAudio: this.sessions.isOrphaned(noteId),
      source: entry.live.source,
      startedAt: entry.live.startedAt.toISOString(),
      /** Null until a bot is admitted; absent entirely for browser capture. */
      joinedAt: entry.live.joinedAt?.toISOString() ?? null,
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

