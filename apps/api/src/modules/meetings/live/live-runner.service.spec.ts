import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@platform/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../../../core/audit/audit.service.js';
import { EventBus } from '../../../core/events/event-bus.service.js';
import { LinkService } from '../../../core/links/link.service.js';
import { EmbeddingService } from '../../../core/llm/embedding.service.js';
import { ManifestRegistry } from '../../../core/manifest/manifest.registry.js';
import { PermissionService } from '../../../core/permissions/permission.service.js';
import { RegistryService } from '../../../core/registry/registry.service.js';
import { resetDb, seedUser, testDb, truncate } from '../../../test/db.js';
import { settle, waitFor } from '../../../test/wait.js';
import { crmManifest } from '../../crm/crm.manifest.js';
import { CrmService } from '../../crm/crm.service.js';
import { scrumManifest } from '../../scrum/scrum.manifest.js';
import { ScrumService } from '../../scrum/scrum.service.js';
import { timeManifest } from '../../time/time.manifest.js';
import { TimeService } from '../../time/time.service.js';
import { meetingsManifest } from '../meetings.manifest.js';
import { UserService } from '../../../core/auth/user.service.js';
import { MeetingsService } from '../meetings.service.js';
import type { AudioSegment, CaptureEvents, CaptureSession } from './capture/provider.js';
import type { RecallProvider } from './capture/recall.provider.js';
import type { ConversationService } from './conversation.service.js';
import { BehaviourRegistry } from './behaviours/behaviour.registry.js';
import type { AiToolRegistry } from '../../../core/llm/tool-registry.service.js';
import type { LlmService } from '../../../core/llm/llm.service.js';
import type { TtsService } from '../../../core/llm/tts.service.js';
import { LiveRegistry } from './live-registry.service.js';
import { NoteDocService } from '../doc/note-doc.service.js';
import { appendMarkdown } from '../doc/note-edit.js';
import { LiveRunner } from './live-runner.service.js';
import { NoteTakerBehaviour, AI_NOTES_SECTION } from './behaviours/note-taker.behaviour.js';
import type { BehaviourContext } from './behaviours/behaviour.js';
import { LiveSession } from './live-session.js';
import type { LiveService } from './live.service.js';

const actor: Actor = { userId: crypto.randomUUID(), role: 'admin' };

const segment = (name: string, id: string, at = 0): AudioSegment => ({
  speaker: { id, name },
  data: Buffer.from('wav'),
  mimeType: 'audio/wav',
  at,
  durationSeconds: 2,
});

describe('LiveRunner', () => {
  let crm: CrmService;
  let meetings: MeetingsService;
  let docs: NoteDocService;
  let runner: LiveRunner;
  let sessions: LiveRegistry;
  let live: {
    transcribeSegment: ReturnType<typeof vi.fn>;
    extract: ReturnType<typeof vi.fn>;
    costCents: ReturnType<typeof vi.fn>;
  };
  let capture: { join: ReturnType<typeof vi.fn>; isConfigured: ReturnType<typeof vi.fn> };
  let conversation: {
    mayReply: ReturnType<typeof vi.fn>;
    reply: ReturnType<typeof vi.fn>;
    forget: ReturnType<typeof vi.fn>;
  };
  let behaviours: BehaviourRegistry;
  let testBehaviour: {
    name: string;
    description: string;
    trigger: 'utterance';
    canSpeak: boolean;
    shouldRun: ReturnType<typeof vi.fn>;
    run: ReturnType<typeof vi.fn>;
  };
  let joined: CaptureSession;
  let clientId: string;
  let projectId: string;

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE meetings.note_chunks, meetings.action_items, meetings.attendees,
                   meetings.agenda_items, meetings.notes, scrum.tasks,
                   crm.projects, crm.contacts, crm.clients CASCADE`);
    await seedUser(actor.userId, 'admin');

    const manifests = new ManifestRegistry();
    for (const m of [crmManifest, timeManifest, scrumManifest, meetingsManifest]) {
      manifests.register(m);
    }
    manifests.seal();

    const registry = new RegistryService(testDb, manifests);
    const permissions = new PermissionService(testDb, manifests);
    const audit = new AuditService();
    const links = new LinkService(testDb, registry, permissions, audit, manifests);
    const bus = new EventBus(manifests);
    crm = new CrmService(testDb, registry, permissions, audit, bus, links);
    const time = new TimeService(testDb, registry, permissions, audit, bus, links, crm);
    const scrum = new ScrumService(testDb, registry, permissions, audit, bus, links, crm, time);
    docs = new NoteDocService();
    meetings = new MeetingsService(
      testDb, registry, permissions, audit, bus, links,
      new EmbeddingService(), crm, scrum, new UserService(testDb), docs,
    );
    // The same wiring MeetingsModule does at boot: the authority reads and writes bodies
    // through the service, and the service edits documents through the authority.
    docs.bind({
      load: (noteId: string) => meetings.bodyOf(noteId),
      save: async (noteId: string, markdown: string, who: Actor) => {
        await meetings.update(who, noteId, { body: markdown }, { fromDocument: true });
      },
    });

    live = {
      transcribeSegment: vi.fn().mockResolvedValue('We should add supplier drill-down.'),
      extract: vi.fn().mockImplementation((session: LiveSession) => {
        const added = [{ id: 'p1', kind: 'action', text: 'Send the dataset', status: 'open' }];
        session.state = { summary: 'Talked about the model.', decisions: [], openQuestions: [] };
        session.proposals.push(...(added as never[]));
        session.markExtracted();
        return Promise.resolve({ added, state: session.state, agendaCovered: [] });
      }),
      costCents: vi.fn().mockReturnValue(11),
    };

    joined = {
      id: 'bot-1',
      providerName: 'recall',
      speak: vi.fn().mockResolvedValue(undefined),
      isSpeaking: () => false,
      leave: vi.fn().mockResolvedValue(undefined),
    };
    capture = {
      isConfigured: vi.fn().mockReturnValue(true),
      join: vi.fn().mockResolvedValue(joined),
    };

    // Speaking is the optional half; these tests are about the transcript pipeline.
    conversation = {
      mayReply: vi.fn().mockReturnValue(true),
      reply: vi.fn().mockResolvedValue(null),
      forget: vi.fn(),
    };

    // A registry holding one controllable behaviour, so the runner's handling of
    // behaviours is testable without exercising the real ones.
    testBehaviour = {
      name: 'test',
      description: 'test behaviour',
      trigger: 'utterance',
      canSpeak: true,
      shouldRun: vi.fn().mockReturnValue(false),
      run: vi.fn().mockResolvedValue(null),
    };
    behaviours = new BehaviourRegistry(
      testBehaviour as unknown as never,
      { name: 'unused', description: '', trigger: 'interval', canSpeak: false,
        shouldRun: () => false, run: async () => null } as unknown as never,
      { name: 'unused2', description: '', trigger: 'interval', canSpeak: false,
        shouldRun: () => false, run: async () => null } as unknown as never,
      { name: 'unused3', description: '', trigger: 'interval', canSpeak: false,
        shouldRun: () => false, run: async () => null } as unknown as never,
    );

    sessions = new LiveRegistry();
    runner = new LiveRunner(
      registry,
      meetings,
      live as unknown as LiveService,
      sessions,
      capture as unknown as RecallProvider,
      conversation as unknown as ConversationService,
      behaviours,
      { buildToolSet: vi.fn().mockResolvedValue({ tools: {}, invocations: [] }) } as unknown as AiToolRegistry,
      {} as LlmService,
      { speak: vi.fn().mockResolvedValue({ mp3: Buffer.from('mp3'), mimeType: 'audio/mp3' }) } as unknown as TtsService,
      docs,
    );

    const client = await crm.createClient(actor, { name: 'DocHorse', status: 'active' });
    clientId = client.id;
    const project = await crm.createProject(actor, {
      clientId,
      name: 'Power BI',
      billingModel: 'time_and_materials',
    });
    projectId = project.id;
  });

  const noteWithConsent = async (consented = true) => {
    const note = await meetings.create(actor, {
      title: 'Voortgang',
      clientId,
      projectId,
      attendees: [{ name: 'Tomas' }, { name: 'Marieke' }],
    });
    if (consented) {
      for (const person of note.attendees) {
        await meetings.setConsent(actor, note.id, person.id, 'granted');
      }
    }
    return note;
  };

  // ── the consent gate, checked before the bot travels ──

  it('refuses to send a bot without consent from everyone', async () => {
    const note = await noteWithConsent(false);
    await expect(
      runner.startBot(actor, note.id, 'https://teams.microsoft.com/meet/123'),
    ).rejects.toThrow(/consent/i);
    // The bot never left, which is the point: refusing later would mean it had already
    // sat in the client's meeting.
    expect(capture.join).not.toHaveBeenCalled();
  });

  it('sends a named bot once everyone has consented', async () => {
    const note = await noteWithConsent();
    const result = await runner.startBot(actor, note.id, 'https://teams.microsoft.com/meet/123');

    expect(result.provider).toBe('recall');
    expect(capture.join).toHaveBeenCalledOnce();
    const [options] = capture.join.mock.calls[0] as [{ botName: string; meetingUrl: string }];
    expect(options.botName).toBeTruthy(); // never covert
    expect(options.meetingUrl).toBe('https://teams.microsoft.com/meet/123');
  });

  it('refuses to capture the same meeting twice', async () => {
    const note = await noteWithConsent();
    await runner.startBot(actor, note.id, 'https://teams.microsoft.com/meet/123');
    await expect(
      runner.startBot(actor, note.id, 'https://teams.microsoft.com/meet/123'),
    ).rejects.toThrow(/already being captured/);
  });

  it('leaves no session behind when the bot cannot join', async () => {
    const note = await noteWithConsent();
    capture.join.mockRejectedValueOnce(new Error('Teams sent the bot to the lobby'));

    await expect(
      runner.startBot(actor, note.id, 'https://teams.microsoft.com/meet/123'),
    ).rejects.toThrow(/lobby/);
    // Otherwise a failed join would block every later attempt on this note.
    expect(sessions.get(note.id)).toBeUndefined();
  });

  // ── the pipeline, independent of provider ──

  it('attributes each utterance to the person who said it', async () => {
    const note = await noteWithConsent();
    const session = new LiveSession(note.id, actor.userId);
    sessions.start(note.id, session);
    const events: CaptureEvents = runner.eventsFor(actor, note.id, session);

    await events.onSegment(segment('Marieke', '7', 12));
    live.transcribeSegment.mockResolvedValueOnce('I will send it Friday.');
    await events.onSegment(segment('Jan', '9', 20));

    expect(session.lines).toHaveLength(2);
    expect(session.lines[0]!.speaker).toBe('Marieke');
    expect(session.lines[1]!.speaker).toBe('Jan');
    // The attributed form is what the model reads — the reason for the whole provider.
    expect(session.transcript).toContain('Marieke:');
    expect(session.transcript).toContain('Jan:');
  });

  it('keeps the meeting alive when one utterance fails to transcribe', async () => {
    const note = await noteWithConsent();
    const session = new LiveSession(note.id, actor.userId);
    sessions.start(note.id, session);
    const events = runner.eventsFor(actor, note.id, session);

    live.transcribeSegment.mockRejectedValueOnce(new Error('provider hiccup'));
    await events.onSegment(segment('Marieke', '7'));
    expect(session.lines).toHaveLength(0);

    await events.onSegment(segment('Marieke', '7'));
    expect(session.lines).toHaveLength(1);
  });

  it('extracts once enough has been said, not on every utterance', async () => {
    const note = await noteWithConsent();
    const session = new LiveSession(note.id, actor.userId);
    sessions.start(note.id, session);
    const events = runner.eventsFor(actor, note.id, session);

    await events.onSegment(segment('Marieke', '7'));
    expect(live.extract).not.toHaveBeenCalled();

    live.transcribeSegment.mockResolvedValueOnce('word '.repeat(300));
    await events.onSegment(segment('Marieke', '7'));
    await waitFor(() => live.extract.mock.calls.length > 0, { label: 'the extraction pass' });
    expect(live.extract).toHaveBeenCalledOnce();
  });

  // ── deciding a suggestion while it can still be decided ──

  /**
   * `Proposal.status` has existed since the type was written and nothing ever changed it.
   * Every suggestion was created open and stayed open until the recording stopped, when all
   * of them were written down at once — so the agent's contribution arrived as a pile of
   * homework at the moment the meeting ended and the context for judging it had gone.
   */
  const withProposal = async (kind: 'action' | 'decision' = 'action') => {
    const note = await noteWithConsent();
    const session = new LiveSession(note.id, actor.userId);
    sessions.start(note.id, session);
    // A recording that captured nothing is not written up at all — stop() returns early —
    // so without a line these tests would assert against an empty body and pass whatever
    // the code did.
    session.addLine('We should send them the drill-down.', { id: '7', name: 'Marieke' });
    const [proposal] = session.mergeProposals(
      [{ kind, text: 'Send DocHorse the supplier drill-down' }],
      // Any unique id: a live proposal is in-memory until it is accepted, and only then
      // does it become a row with a registry id of its own.
      () => crypto.randomUUID(),
    );
    return { note, session, proposal: proposal! };
  };

  it('turns an accepted action into an action point there and then', async () => {
    const { note, session, proposal } = await withProposal();

    await runner.decideProposal(actor, note.id, proposal.id, 'accepted');

    const after = await meetings.get(actor, note.id);
    expect(after.actionItems).toHaveLength(1);
    expect(after.actionItems[0]!.text).toBe('Send DocHorse the supplier drill-down');
    // Marked, so it is not created a second time when the meeting stops.
    expect(session.openProposals).toHaveLength(0);
  });

  it('does not add an accepted action twice when the meeting then stops', async () => {
    const { note, proposal } = await withProposal();
    sessions.attachCapture(note.id, joined);
    await runner.decideProposal(actor, note.id, proposal.id, 'accepted');

    await runner.stop(actor, note.id);

    const after = await meetings.get(actor, note.id);
    expect(after.actionItems).toHaveLength(1);
  });

  it('keeps a dismissed suggestion out of the note entirely', async () => {
    const { note, proposal } = await withProposal('decision');
    sessions.attachCapture(note.id, joined);
    await runner.decideProposal(actor, note.id, proposal.id, 'dismissed');

    await runner.stop(actor, note.id);

    const body = await docs.markdown(note.id);
    expect(body).not.toContain('supplier drill-down');
  });

  it('writes an accepted decision into the note rather than deleting it', async () => {
    /*
     * The inversion this guards against. The end-of-session write read `openProposals`, so
     * accepting a decision — saying "yes, record that" — would have been the one way to
     * make sure it was never recorded. Undecided and accepted both belong in the note.
     */
    const { note, proposal } = await withProposal('decision');
    sessions.attachCapture(note.id, joined);
    await runner.decideProposal(actor, note.id, proposal.id, 'accepted');

    await runner.stop(actor, note.id);

    expect(await docs.markdown(note.id)).toContain('supplier drill-down');
  });

  it('treats deciding the same suggestion twice as agreement, not an error', async () => {
    // Two people in the room, one suggestion, both press. The second press must not create
    // a second action point, and must not fail in front of the client either.
    const { note, proposal } = await withProposal();

    const first = await runner.decideProposal(actor, note.id, proposal.id, 'accepted');
    const second = await runner.decideProposal(actor, note.id, proposal.id, 'dismissed');

    expect(first.decided).toBe(true);
    expect(second.decided).toBe(false);
    const after = await meetings.get(actor, note.id);
    expect(after.actionItems).toHaveLength(1);
  });

  it('refuses to decide anything on a meeting that is not being recorded', async () => {
    const note = await noteWithConsent();
    await expect(
      runner.decideProposal(actor, note.id, 'whatever', 'accepted'),
    ).rejects.toThrow(/not being recorded/i);
  });

  // ── notes while it is still happening ──

  /**
   * The complaint this answers: the agent appeared to take no notes at all and then put
   * everything down at once when the meeting ended.
   *
   * It was taking them the whole time — the note-taker revises its section every ninety
   * seconds — but they were held in memory and pushed to the panel, and the document was
   * only written on stop. Notes you cannot see in the note are not notes yet.
   */
  /*
   * The note-taker, driven against the real document authority.
   *
   * These used to drive LiveRunner instead, because the runner held the write: a behaviour
   * set `session.aiNotes` and the runner copied it into one section afterwards. The write
   * belongs to the behaviour now — it emits section-scoped edits and applies them in one
   * transaction — so the properties are asserted where they are enforced. They are the same
   * properties, and the first of them is the one that makes live note-taking survivable.
   */
  describe('the note-taker', () => {
    const contextFor = (
      noteId: string,
      session: LiveSession,
      object: unknown,
    ): BehaviourContext =>
      ({
        actor,
        session,
        note: { id: noteId, title: 'Voortgang', agenda: [] },
        tools: {},
        llm: {
          generateStructured: vi.fn().mockResolvedValue({
            object,
            usage: { inputTokens: 10, outputTokens: 5 },
          }),
        } as unknown as LlmService,
        newId: () => crypto.randomUUID(),
        eagerness: { notes: 'balanced', actions: 'balanced', speech: 'balanced' },
      }) as BehaviourContext;

    /** Dense enough to clear the triage gate, so these test the writer and not the gate. */
    const consequential =
      'Marieke: we doen 40 uur, uiterlijk vrijdag klaar. Ik stuur de dataset morgen door. ';

    const sessionSaying = (noteId: string) => {
      const session = new LiveSession(noteId, actor.userId);
      session.addLine(consequential.repeat(12), { id: '7', name: 'Marieke' });
      return session;
    };

    it('writes its notes into the document while the meeting is still running', async () => {
      const note = await noteWithConsent();
      const session = sessionSaying(note.id);

      const ctx = contextFor(note.id, session, {
        worthEditing: true,
        ops: [
          {
            op: 'replace',
            heading: AI_NOTES_SECTION,
            markdown: '- DocHorse asked for a supplier drill-down',
            confidence: 0.9,
          },
        ],
      });
      await new NoteTakerBehaviour(docs).run(ctx);

      const body = await docs.markdown(note.id);
      expect(body).toContain('supplier drill-down');
      expect(body).toContain(AI_NOTES_SECTION);
    });

    it('leaves what somebody else wrote alone, and adds below it instead', async () => {
      /*
       * The invariant the old single-section rule bought, kept under a rule that lets the
       * agent write everywhere: it may add to a section a person wrote, never replace it.
       */
      const note = await noteWithConsent();
      await docs.edit(note.id, actor, (tr) => appendMarkdown(tr, '## Mine\n\nDo not touch this.'));
      const session = sessionSaying(note.id);

      const ctx = contextFor(note.id, session, {
        worthEditing: true,
        ops: [
          {
            op: 'replace',
            heading: 'Mine',
            markdown: '- A point the agent heard',
            confidence: 0.9,
          },
        ],
      });
      await new NoteTakerBehaviour(docs).run(ctx);

      const body = await docs.markdown(note.id);
      expect(body).toContain('A point the agent heard');
      expect(body).toContain('Do not touch this.');
    });

    it('fills in an empty heading the template left', async () => {
      // The thing it could not do before at all: the note had a `## Risks` waiting and the
      // agent could only ever write under its own heading.
      const note = await noteWithConsent();
      await docs.edit(note.id, actor, (tr) => appendMarkdown(tr, '## Risks'));
      const session = sessionSaying(note.id);

      const ctx = contextFor(note.id, session, {
        worthEditing: true,
        ops: [
          { op: 'replace', heading: 'Risks', markdown: '- Supplier data is late', confidence: 0.9 },
        ],
      });
      await new NoteTakerBehaviour(docs).run(ctx);

      expect(await docs.markdown(note.id)).toContain('Supplier data is late');
    });

    it('writes nothing when it decides the passage was not worth an edit', async () => {
      const note = await noteWithConsent();
      const session = sessionSaying(note.id);
      const before = await docs.markdown(note.id);

      const ctx = contextFor(note.id, session, { worthEditing: false, ops: [] });
      const result = await new NoteTakerBehaviour(docs).run(ctx);

      expect(result?.reason).toBe('Nothing new worth recording');
      expect(await docs.markdown(note.id)).toBe(before);
    });

    it('discards an edit that does not clear the confidence floor', async () => {
      // The half of the dial that does not depend on the model taking the wording seriously.
      const note = await noteWithConsent();
      const session = sessionSaying(note.id);
      const before = await docs.markdown(note.id);

      const ctx = contextFor(note.id, session, {
        worthEditing: true,
        ops: [
          {
            op: 'replace',
            heading: AI_NOTES_SECTION,
            markdown: '- A guess',
            confidence: 0.2,
          },
        ],
      });
      const result = await new NoteTakerBehaviour(docs).run(ctx);

      expect(result?.reason).toContain('confidence floor');
      expect(await docs.markdown(note.id)).toBe(before);
    });

    it('does not call the model at all for small talk', async () => {
      /*
       * The gate, and the property that makes it safe: the watermark does not advance, so
       * the passage is reconsidered next pass along with whatever follows it.
       */
      const note = await noteWithConsent();
      const session = new LiveSession(note.id, actor.userId);
      session.addLine('Hoe was je weekend? Prima hoor. '.repeat(40), { id: '7', name: 'Marieke' });

      const ctx = contextFor(note.id, session, { worthEditing: true, ops: [] });
      const result = await new NoteTakerBehaviour(docs).run(ctx);

      expect(ctx.llm.generateStructured).not.toHaveBeenCalled();
      expect(result?.reason).toContain('Nothing worth reading');
    });
  });

  /*
   * A note is an observation, and there is nothing to decide about one. Before this it
   * arrived as a card whose only sensible answer was yes, next to a document that did not
   * contain the thing the meeting was about.
   */
  it('writes what it noticed into the note rather than asking about it', async () => {
    const note = await noteWithConsent();
    const session = new LiveSession(note.id, actor.userId);
    sessions.start(note.id, session);

    const added = session.mergeProposals(
      [{ kind: 'note', text: 'Marieke wants the supplier drill-down before the audit' }],
      () => crypto.randomUUID(),
    );

    const suggestions = await runner.recordNotes(actor, note.id, session, added);

    // Nothing left to answer, and it is on the page.
    expect(suggestions).toHaveLength(0);
    const body = await docs.markdown(note.id);
    expect(body).toContain('Noted during the meeting');
    expect(body).toContain('supplier drill-down');
  });

  it('still asks about an action, which becomes somebody’s task', async () => {
    const note = await noteWithConsent();
    const session = new LiveSession(note.id, actor.userId);
    sessions.start(note.id, session);

    const added = session.mergeProposals(
      [
        { kind: 'note', text: 'The export runs at 03:00' },
        { kind: 'action', text: 'Joost moves the refresh window' },
        { kind: 'decision', text: 'Phase two starts after the close' },
      ],
      () => crypto.randomUUID(),
    );

    const suggestions = await runner.recordNotes(actor, note.id, session, added);

    expect(suggestions.map((p) => p.kind)).toEqual(['action', 'decision']);
    expect(await docs.markdown(note.id)).toContain('The export runs at 03:00');
  });

  /*
   * The end-of-session write covers the same section. It has to replace it rather than
   * append a second copy under a heading of its own, which is what the panel-era code did
   * with everything it had been showing all meeting.
   */
  it('does not write a note a second time when the meeting stops', async () => {
    const note = await noteWithConsent();
    const session = new LiveSession(note.id, actor.userId);
    sessions.start(note.id, session);

    const added = session.mergeProposals(
      [{ kind: 'note', text: 'Marieke wants the supplier drill-down' }],
      () => crypto.randomUUID(),
    );
    await runner.recordNotes(actor, note.id, session, added);
    await runner.stop(actor, note.id);

    const body = await docs.markdown(note.id);
    expect(body.split('supplier drill-down').length - 1).toBe(1);
    // And not under the heading for things still awaiting an answer.
    expect(body).not.toContain('Suggested by the assistant');
  });

  it('keeps recording when the notes cannot be written', async () => {
    // Liveness is the thing at risk here, never the meeting. The end-of-session write
    // covers the same section from the same source.
    const note = await noteWithConsent();
    const session = new LiveSession(note.id, actor.userId);
    sessions.start(note.id, session);
    const events = runner.eventsFor(actor, note.id, session);

    testBehaviour.shouldRun.mockReturnValue(true);
    testBehaviour.run.mockImplementation(async (ctx: { session: LiveSession }) => {
      ctx.session.aiNotes = 'Notes that will not land';
      return { reason: 'Notes updated' };
    });
    const edit = vi.spyOn(docs, 'edit').mockRejectedValue(new Error('document unavailable'));

    await events.onSegment(segment('Marieke', '7'));

    expect(sessions.get(note.id)).toBeDefined();
    expect(session.lines).toHaveLength(1);
    edit.mockRestore();
  });

  // ── what survives ──

  it('writes an attributed transcript and leaves proposals undecided', async () => {
    const note = await noteWithConsent();
    const session = new LiveSession(note.id, actor.userId);
    sessions.start(note.id, session);
    sessions.attachCapture(note.id, joined);
    const events = runner.eventsFor(actor, note.id, session);

    live.transcribeSegment.mockResolvedValueOnce('word '.repeat(300));
    await events.onSegment(segment('Marieke', '7'));
    await waitFor(() => live.extract.mock.calls.length > 0, { label: 'the extraction pass' });

    const result = await runner.stop(actor, note.id);
    expect(result.saved).toBe(true);

    const saved = await meetings.get(actor, note.id);
    // The transcript is its own record now, and deliberately not in the note.
    expect(saved.body).not.toContain('## Transcript');
    expect(saved.body).toContain('## Summary');
    expect(saved.transcriptCostCents).toBe(11);

    const [transcript] = await meetings.listTranscripts(actor, note.id);
    expect(transcript!.provider).toBe(joined.providerName);
    // Who said it, which is what makes a transcript worth reading afterwards.
    expect(JSON.stringify(transcript!.lines)).toContain('Marieke');

    expect(saved.actionItems).toHaveLength(1);
    expect(saved.actionItems[0]!.status).toBe('proposed');
    expect(saved.actionItems[0]!.source).toBe('ai');
    // Still nothing on the board.
    expect((await testDb.execute(sql`SELECT id FROM scrum.tasks`)).rows).toHaveLength(0);
  });

  it('tells the bot to leave when the meeting stops', async () => {
    const note = await noteWithConsent();
    await runner.startBot(actor, note.id, 'https://teams.microsoft.com/meet/123');
    await runner.stop(actor, note.id);
    expect(joined.leave).toHaveBeenCalledOnce();
  });

  it('writes nothing when nobody said anything', async () => {
    const note = await noteWithConsent();
    const before = await meetings.get(actor, note.id);
    sessions.start(note.id, new LiveSession(note.id, actor.userId));

    expect((await runner.stop(actor, note.id)).saved).toBe(false);
    const after = await meetings.get(actor, note.id);
    expect(after.body).toBe(before.body);
    expect(after.transcribedAt).toBeNull();
  });

  // ── speaking ──

  it('speaks into the meeting through the capture session', async () => {
    const note = await noteWithConsent();
    await runner.startBot(actor, note.id, 'https://teams.microsoft.com/meet/123');
    await runner.speak(note.id, Buffer.from('mp3'), 'audio/mp3');
    expect(joined.speak).toHaveBeenCalledWith(expect.any(Buffer), 'audio/mp3');
  });

  it('stays silent unless chatty mode is on', async () => {
    const note = await noteWithConsent();
    await runner.startBot(actor, note.id, 'https://teams.microsoft.com/meet/123');
    const session = sessions.get(note.id)!.live;
    const events = runner.eventsFor(actor, note.id, session);

    await events.onSegment(segment('Marieke', '7'));
    await settle();
    expect(conversation.reply).not.toHaveBeenCalled();
  });

  it('speaks when chatty, and records what it said in the transcript', async () => {
    const note = await noteWithConsent();
    await runner.startBot(actor, note.id, 'https://teams.microsoft.com/meet/123');
    runner.setChatty(note.id, true);

    conversation.reply.mockResolvedValueOnce({
      text: 'Zal ik dat als actiepunt noteren?',
      mp3: Buffer.from('mp3'),
      mimeType: 'audio/mp3',
    });

    const session = sessions.get(note.id)!.live;
    const events = runner.eventsFor(actor, note.id, session);
    await events.onSegment(segment('Marieke', '7'));
    await waitFor(() => vi.mocked(joined.speak).mock.calls.length > 0, {
      label: 'the assistant to speak',
    });

    expect(joined.speak).toHaveBeenCalledWith(expect.any(Buffer), 'audio/mp3');
    // What the assistant said belongs in the record, attributed to it.
    expect(session.lines.some((l) => l.speaker === 'Assistant')).toBe(true);
  });

  it('does not talk over itself', async () => {
    const note = await noteWithConsent();
    await runner.startBot(actor, note.id, 'https://teams.microsoft.com/meet/123');
    runner.setChatty(note.id, true);
    joined.isSpeaking = () => true; // already mid-sentence

    const session = sessions.get(note.id)!.live;
    await runner.eventsFor(actor, note.id, session).onSegment(segment('Marieke', '7'));
    await settle();

    expect(conversation.reply).not.toHaveBeenCalled();
  });

  it('refuses to speak into a meeting it is not in', async () => {
    const note = await noteWithConsent();
    await expect(runner.speak(note.id, Buffer.from('mp3'), 'audio/mp3')).rejects.toThrow(
      /No live capture/,
    );
  });

  describe('pausing', () => {
    it('refuses audio while paused, and takes it again after', async () => {
      const note = await meetings.create(actor, { title: 'Sensitive bit' });
      const session = new LiveSession(note.id, actor.userId);
      sessions.start(note.id, session);
      const events = runner.eventsFor(actor, note.id, session);

      await events.onSegment(segment('Marieke', '7', 5));
      expect(session.lines).toHaveLength(1);

      await runner.pause(actor, note.id);
      live.transcribeSegment.mockClear();
      await events.onSegment(segment('Marieke', '7', 20));

      /*
       * Refused before transcription, which is where the cost and the record both begin. The
       * bot may still be sending — this is the layer that makes that harmless.
       */
      expect(live.transcribeSegment).not.toHaveBeenCalled();
      expect(session.lines.filter((l) => l.kind !== 'paused')).toHaveLength(1);

      await runner.resume(actor, note.id);
      await events.onSegment(segment('Marieke', '7', 40));
      expect(live.transcribeSegment).toHaveBeenCalled();
    });

    it('leaves the meeting running, with everything it had', async () => {
      const note = await meetings.create(actor, { title: 'Still going' });
      const session = new LiveSession(note.id, actor.userId);
      sessions.start(note.id, session);
      const events = runner.eventsFor(actor, note.id, session);
      await events.onSegment(segment('Marieke', '7', 5));

      await runner.pause(actor, note.id);

      // The distinction the whole feature rests on: pausing is not stopping. The session is
      // still registered, so nothing has been written, filed or finalised.
      expect(sessions.get(note.id)).toBeDefined();
      expect(session.lines.some((l) => l.speaker === 'Marieke')).toBe(true);
    });

    it('marks the gap in the transcript', async () => {
      const note = await meetings.create(actor, { title: 'Gap' });
      const session = new LiveSession(note.id, actor.userId);
      sessions.start(note.id, session);

      await runner.pause(actor, note.id);
      await runner.resume(actor, note.id);

      expect(session.lines.some((l) => l.kind === 'paused')).toBe(true);
    });

    it('is idempotent, so a double click is not two events', async () => {
      const note = await meetings.create(actor, { title: 'Twice' });
      const session = new LiveSession(note.id, actor.userId);
      sessions.start(note.id, session);

      await runner.pause(actor, note.id);
      await runner.pause(actor, note.id);

      expect(session.lines.filter((l) => l.kind === 'paused')).toHaveLength(1);
    });

    it('refuses to pause a meeting that is not running', async () => {
      const note = await meetings.create(actor, { title: 'Not running' });
      await expect(runner.pause(actor, note.id)).rejects.toThrow(/not running/);
    });

    it('tells the capture provider to stop listening, where it can', async () => {
      const note = await meetings.create(actor, { title: 'Deafen' });
      const session = new LiveSession(note.id, actor.userId);
      const setListening = vi.fn().mockResolvedValue(undefined);
      sessions.start(note.id, session);
      sessions.attachCapture(note.id, {
        id: 'cap-1',
        providerName: 'recall',
        speak: vi.fn(),
        isSpeaking: () => false,
        setListening,
        leave: vi.fn(),
      } as unknown as CaptureSession);

      await runner.pause(actor, note.id);
      await settle();
      expect(setListening).toHaveBeenCalledWith(false);

      await runner.resume(actor, note.id);
      await settle();
      expect(setListening).toHaveBeenCalledWith(true);
    });
  });
});
