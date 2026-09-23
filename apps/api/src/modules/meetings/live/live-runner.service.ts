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
import { applySession, mentions, sessionSummary } from './session-body.js';
import { ProposalLedger } from './proposal-ledger.service.js';
import { NoteDocService } from '../doc/note-doc.service.js';
import { DEFAULT_EAGERNESS, readEagerness, type Eagerness } from './eagerness.js';
import { TEMPLATES, type Template, type TemplateName } from '../templates.js';

/**
 * Runs one live meeting, whatever is supplying the audio.
 *
 * This is the layer the capture seam exists for: it takes attributed audio segments in
 * and produces transcript lines, proposals and cost — with no idea whether a bot joined
 * the call or the operator's browser is listening to a tab.
 *
 * Nothing here acts on the meeting. Proposals accumulate and are written when the session
 * ends — all of them except the ones somebody objected to, which is the only answer the
 * live panel asks for. Every proposal and every objection also lands in the ledger, so the
 * agent's suggestions can later be judged against what people did with them.
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
    private readonly docs: NoteDocService,
    private readonly ledger: ProposalLedger,
  ) {}

  /**
   * What each running meeting has switched on.
   *
   * Still a map, but no longer the truth — a read-through cache in front of the note's own
   * `agentSettings`. It exists because these are read on every utterance and a database round
   * trip in that path would cost more than the behaviours it is gating.
   */
  private readonly settings = new Map<string, BehaviourSettings>();

  /**
   * The settings for a meeting: what is cached, else what the note remembers, else what the
   * template thinks, else the platform default.
   *
   * That chain is the whole point of persisting them. A recurring client check-in is the same
   * meeting every month, and the operator who turned the nudges down in January is the person
   * who has to turn them down again in February — which is how a setting teaches people that
   * settings do not work.
   */
  async behaviourSettings(actor: Actor, noteId: string): Promise<BehaviourSettings> {
    const cached = this.settings.get(noteId);
    if (cached) return cached;

    const settings = this.behaviours.defaults(await this.eagernessFor(actor, noteId));
    try {
      const stored = (await this.meetings.agentSettings(actor, noteId)) as {
        enabled?: unknown;
        maySpeak?: unknown;
        eagerness?: unknown;
      } | null;
      if (stored) {
        // Each field independently, so a row written before a field existed still gives up
        // the fields it does have rather than being discarded whole.
        if (Array.isArray(stored.enabled)) settings.enabled = new Set(stored.enabled as string[]);
        if (typeof stored.maySpeak === 'boolean') settings.maySpeak = stored.maySpeak;
        settings.eagerness = readEagerness(stored.eagerness, settings.eagerness);
      }
    } catch (error) {
      // Unreadable settings are not a reason to refuse to record. The defaults are a complete
      // answer, and a meeting that would not start because of a preferences row would be a
      // much worse trade than a meeting that starts with the wrong preferences.
      this.logger.warn(`Could not read agent settings for ${noteId}: ${(error as Error).message}`);
    }

    this.settings.set(noteId, settings);
    return settings;
  }

  /** What the template thinks, over the platform default. */
  private async eagernessFor(actor: Actor, noteId: string): Promise<Eagerness> {
    try {
      const note = await this.meetings.get(actor, noteId);
      /*
       * Typed as the interface rather than as the literal.
       *
       * `TEMPLATES` is `satisfies Record<string, Template>`, so indexing it gives the union of
       * the literal shapes — and a template that states no opinion about eagerness has no such
       * property in its literal type, which makes reading one an error rather than undefined.
       */
      const template: Template | undefined = note.template
        ? TEMPLATES[note.template as TemplateName]
        : undefined;
      return { ...DEFAULT_EAGERNESS, ...(template?.eagerness ?? {}) };
    } catch {
      return DEFAULT_EAGERNESS;
    }
  }

  async configure(
    actor: Actor,
    noteId: string,
    patch: { enabled?: string[]; maySpeak?: boolean; eagerness?: unknown },
  ): Promise<BehaviourSettings> {
    const current = await this.behaviourSettings(actor, noteId);
    if (patch.enabled) current.enabled = new Set(patch.enabled);
    if (patch.maySpeak !== undefined) current.maySpeak = patch.maySpeak;
    if (patch.eagerness !== undefined) {
      // Narrowed against what is already set rather than against the platform default, so
      // sending one dial changes one dial.
      current.eagerness = readEagerness(patch.eagerness, current.eagerness);
    }
    this.settings.set(noteId, current);

    /*
     * Written through, and a failure to store is not a failure to apply.
     *
     * The operator changed a setting because of the meeting happening right now; that has to
     * take effect whether or not it survives until the next one.
     */
    await this.meetings
      .saveAgentSettings(actor, noteId, {
        enabled: [...current.enabled],
        maySpeak: current.maySpeak,
        eagerness: current.eagerness,
      })
      .catch((error: Error) =>
        this.logger.warn(`Could not store agent settings for ${noteId}: ${error.message}`),
      );

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
   * No longer gated on every attendee having been ticked off as consenting. That gate refused
   * to start until the list was complete, and the list is filled in by hand — so in practice it
   * blocked recording a meeting that was already happening, which is the only moment anybody
   * wants to start one.
   *
   * What consent was for has not gone anywhere: it is still recorded per attendee, still shown,
   * and `unconsentedPresent` still names anybody the bot sees who was never asked — see
   * `recordSpeaker`. Announcing the recording in the room is the part that actually matters,
   * and no gate here ever did that.
   */
  async startBot(actor: Actor, noteId: string, meetingUrl: string) {
    await this.meetings.get(actor, noteId);
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
    /*
     * Refused before transcription, which is where the cost and the record both begin.
     *
     * A bot cannot always be made deaf — it is sitting in someone else's call and the provider
     * decides what it receives — so this is the backstop that makes the promise true: whatever
     * still arrives while paused is dropped without being transcribed, stored or charged. The
     * browser stops sending at the source as well, but the source is not the thing to trust.
     */
    if (live.paused) return;

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
    const settings = await this.behaviourSettings(actor, noteId);
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
        eagerness: settings.eagerness,
      }, settings);

      for (const result of results) {
        if (result.proposals?.length) {
          const added = live.mergeProposals(result.proposals, () => this.registry.newId());
          /*
           * Written down before the panel is told about them.
           *
           * Ordering matters here in one direction only: a suggestion recorded and never
           * shown is a harmless orphan, while one shown and never recorded is a dismissal
           * with nothing to attach itself to. The ledger swallows its own failures, so this
           * cannot delay or break the broadcast that follows.
           */
          await this.ledger.recorded(noteId, added, {
            source: result.behaviour,
            eagerness: settings.eagerness[this.behaviours.dialOf(result.behaviour) ?? 'notes'],
            window: live.window(),
          });
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

      /*
       * Onto the screens watching. Not into the document — the note-taker writes its own
       * edits now, in one transaction, and this used to write the same section a second time
       * immediately afterwards from a copy held in memory. Two writers for one section is how
       * the section ends up saying whichever of them ran last.
       */
      if (live.aiNotes) this.sessions.broadcast(noteId, { type: 'notes', markdown: live.aiNotes });
    } catch (error) {
      this.logger.warn(`Behaviours failed on ${noteId}: ${(error as Error).message}`);
    }
  }

  /**
   * Object to one of the agent's suggestions, mid-meeting.
   *
   * ## Why there is no longer an accept
   *
   * Because there never really was one. `keptProposals` is everything not dismissed, so an
   * accepted decision and an untouched one produced exactly the same note; an accepted
   * action point differed from an untouched one only in whether it appeared now or when the
   * recording stopped. The panel asked a two-answer question and the system read one bit —
   * and because a card stayed until pressed, the quickest way back to the meeting was to
   * press whichever button was nearer. Every press meant the same thing, so the record of
   * them meant nothing.
   *
   * One button fixes both halves. The default is already yes, so silence is an answer and
   * costs nothing during the part of a meeting where attention is scarcest. And a press is
   * now unambiguous: somebody looked at a suggestion and said no.
   *
   * ## Where acceptance went
   *
   * To the note, where it already lived and already costs something. An action point still
   * has to be accepted onto the board — `acceptActionItem`, which creates a real task and is
   * guarded by a CHECK constraint saying so — and that decision is made after the meeting,
   * deliberately, by somebody who has to live with the task. That is a signal worth
   * recording precisely because it is not free.
   *
   * ## The one exception
   *
   * Agenda coverage keeps both buttons, because it is the only kind whose accept was ever
   * real: it calls `setAgendaCovered`, which changes something no other path changes, and
   * the live panel is where a room wants to see the agenda filling in. It is deliberately
   * NOT applied automatically — `LiveService.extract` refuses to mark an item covered
   * without being asked, on the grounds that an item ticked off because it was mentioned in
   * passing is the kind of quiet wrongness that erodes trust in the whole agent. That
   * reasoning is untouched by anything here.
   *
   * So the rule is: dismissal is always available, acceptance only where it does something.
   * Asking for it anywhere else is refused rather than quietly treated as a keep — a button
   * that returns 200 and changes nothing is precisely what this is undoing.
   */
  async decideProposal(
    actor: Actor,
    noteId: string,
    proposalId: string,
    decision: 'accepted' | 'dismissed',
  ): Promise<{ decided: boolean }> {
    const entry = this.sessions.get(noteId);
    if (!entry) throw new BadRequestException('This meeting is not being recorded');

    const at = Date.now();
    const existing = entry.live.proposals.find((p) => p.id === proposalId);
    if (decision === 'accepted' && existing && existing.kind !== 'agenda_covered') {
      throw new BadRequestException(
        'Only agenda coverage can be accepted — everything else is kept unless dismissed',
      );
    }

    const proposal = entry.live.decide(proposalId, decision);
    // Already decided, or never existed. Not an error: two people in the room may press the
    // same button, and the second press should agree with the first rather than fail.
    if (!proposal) return { decided: false };

    if (decision === 'accepted') {
      try {
        if (proposal.agendaItemId) {
          await this.meetings.setAgendaCovered(actor, noteId, proposal.agendaItemId, true);
        }
      } catch (error) {
        // Open is the honest state for something that was not applied. Without this the
        // suggestion is lost in both directions: decided here, and never acted on.
        proposal.status = 'open';
        throw error;
      }
      await this.ledger.kept(proposal, actor.userId, at);
      this.sessions.broadcast(noteId, { type: 'proposal_decided', id: proposal.id, decision });
      return { decided: true };
    }

    /*
     * Whether the note already says this, asked before the reason is written.
     *
     * A dismissal of something the document already contains is a complaint about the agent
     * repeating itself, not a verdict on the suggestion — and the two must not be counted
     * together. Read from the document authority rather than from the session's copy, so a
     * line somebody typed by hand counts just as much as one the note-taker wrote.
     *
     * Never allowed to fail the dismissal: an unknown reason is a worse row, not a broken
     * button.
     */
    let alreadyInNote = false;
    try {
      const { markdown } = await this.docs.snapshot(noteId);
      alreadyInNote = mentions(markdown, proposal.text);
    } catch (error) {
      this.logger.warn(`Could not read ${noteId} while dismissing: ${(error as Error).message}`);
    }

    await this.ledger.dismissed(proposal, actor.userId, { alreadyInNote, at });

    // So every screen watching this meeting agrees, including the one that did not press.
    this.sessions.broadcast(noteId, {
      type: 'proposal_decided',
      id: proposal.id,
      decision: 'dismissed',
    });
    return { decided: true };
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

    /*
     * Kept, not written to a section of their own.
     *
     * These used to be mirrored into `## Noted during the meeting`, beside the write-up the
     * note-taker was building from the same conversation — so a finished note carried the
     * meeting twice, in two voices, and the reader had to diff them to find out whether the
     * two lists disagreed. They are the same facts; the write-up is the record. These stay
     * live-panel signals, where they can still be dismissed.
     */

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
      /*
       * Nothing to look at while paused.
       *
       * The transcript is not growing, so every interval behaviour would re-read the same
       * window and reach the same conclusion — the note-taker rewriting identical notes and
       * the drift watcher re-reporting the same drift, each costing a model call. Skipped
       * rather than cancelled so resuming needs no new timer.
       */
      if (live.paused) return;
      void this.runBehaviours('interval', actor, noteId, live);
    }, 60_000);
    this.timers.set(noteId, timer);
  }

  private readonly timers = new Map<string, NodeJS.Timeout>();

  private async tick(actor: Actor, noteId: string, live: LiveSession): Promise<void> {
    live.extracting = true;
    try {
      const note = await this.meetings.get(actor, noteId);
      const settings = await this.behaviourSettings(actor, noteId);
      const { added, state, context } = await this.live.extract(
        live,
        note.agenda.map((a) => ({ id: a.id, title: a.title, covered: a.covered })),
        () => this.registry.newId(),
        settings.eagerness,
      );
      // `context` is absent only when the triage gate declined, in which case `added` is
      // empty too and the ledger has nothing to write.
      if (context) await this.ledger.recorded(noteId, added, context);
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
   * Stop listening, without ending the meeting.
   *
   * The gap this fills: the only way to stop the agent hearing a private aside was to end the
   * recording — which writes the note, files the proposals and cannot be undone — or to evict
   * the bot from the call and re-admit it afterwards. Both are far too heavy for "give us two
   * minutes", so in practice nobody did either and the agent heard things it should not have.
   *
   * What actually stops is layered, because no single layer can be trusted alone. The browser
   * releases the microphone or the shared tab, so the operating system's own recording
   * indicator goes out and the audio genuinely does not leave the room. The bot is muted where
   * the provider allows it. And `onSegment` refuses anything that still arrives, so a stale tab
   * or a bot that keeps streaming cannot quietly keep the transcript growing.
   *
   * The session stays open throughout: the transcript so far, the running summary and the
   * proposals awaiting a decision are all still there, and resuming continues the same meeting
   * rather than starting a second one against the same note.
   */
  async pause(actor: Actor, noteId: string): Promise<{ paused: boolean }> {
    await this.meetings.assertCanWrite(actor);
    const entry = this.sessions.get(noteId);
    if (!entry) throw new BadRequestException('That meeting is not running');

    const line = entry.live.mark('paused');
    if (line) {
      this.sessions.broadcast(noteId, { type: 'line', line });
      this.sessions.broadcast(noteId, { type: 'listening', paused: true });
      // Best effort, and deliberately not awaited into the result: a provider that cannot mute
      // must not make pausing fail, because the refusal in onSegment is what carries the promise.
      void entry.capture?.setListening?.(false).catch(() => undefined);
    }
    return { paused: true };
  }

  /** Start listening again, on the same session. */
  async resume(actor: Actor, noteId: string): Promise<{ paused: boolean }> {
    await this.meetings.assertCanWrite(actor);
    const entry = this.sessions.get(noteId);
    if (!entry) throw new BadRequestException('That meeting is not running');

    const line = entry.live.mark('resumed');
    if (line) {
      this.sessions.broadcast(noteId, { type: 'line', line });
      this.sessions.broadcast(noteId, { type: 'listening', paused: false });
      void entry.capture?.setListening?.(true).catch(() => undefined);
    }
    return { paused: false };
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
    /*
     * The cache, not the setting. What the note remembers survives — that is the point of
     * having stored it — and the next recording reads it back on its first behaviour pass.
     */
    this.settings.delete(noteId);
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
        await this.meetings.addActionItem(actor, noteId, {
          text: proposal.text,
          source: 'ai',
          proposalId: proposal.id,
        });
      }
    }

    /*
     * Close the ledger for this meeting.
     *
     * Everything not dismissed was kept — that is what the one-button panel means, and
     * leaving those rows `open` would make a meeting nobody objected during look identical
     * to one where the process died mid-recording. Written after the note, because until
     * the note is written "kept" is not yet true of anything.
     */
    await this.ledger.settled(
      noteId,
      live.keptProposals.map((p) => p.id),
    );

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
    /*
     * A paused agent does not talk.
     *
     * It cannot hear the wake word while paused, so in practice little reaches here — but an
     * interval behaviour or a queued utterance still could, and an assistant that speaks up in
     * the middle of the private conversation you paused it for would be worse than one that
     * never paused at all.
     */
    if (entry.live.paused) return;
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
      /** Listening is suspended. A tab that reloads mid-pause learns it from here. */
      paused: entry.live.paused,
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

