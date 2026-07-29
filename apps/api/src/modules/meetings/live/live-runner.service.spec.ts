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
import { crmManifest } from '../../crm/crm.manifest.js';
import { CrmService } from '../../crm/crm.service.js';
import { scrumManifest } from '../../scrum/scrum.manifest.js';
import { ScrumService } from '../../scrum/scrum.service.js';
import { timeManifest } from '../../time/time.manifest.js';
import { TimeService } from '../../time/time.service.js';
import { meetingsManifest } from '../meetings.manifest.js';
import { MeetingsService } from '../meetings.service.js';
import type { AudioSegment, CaptureEvents, CaptureSession } from './capture/provider.js';
import type { RecallProvider } from './capture/recall.provider.js';
import type { ConversationService } from './conversation.service.js';
import { BehaviourRegistry } from './behaviours/behaviour.registry.js';
import type { AiToolRegistry } from '../../../core/llm/tool-registry.service.js';
import type { LlmService } from '../../../core/llm/llm.service.js';
import type { TtsService } from '../../../core/llm/tts.service.js';
import { LiveRegistry } from './live-registry.service.js';
import { LiveRunner } from './live-runner.service.js';
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
    const links = new LinkService(testDb, registry, permissions, audit);
    const bus = new EventBus(manifests);
    crm = new CrmService(testDb, registry, permissions, audit, bus, links);
    const time = new TimeService(testDb, registry, permissions, audit, bus, links, crm);
    const scrum = new ScrumService(testDb, registry, permissions, audit, bus, links, crm, time);
    meetings = new MeetingsService(
      testDb, registry, permissions, audit, bus, links,
      new EmbeddingService(), crm, scrum,
    );

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
    await new Promise((r) => setTimeout(r, 40));
    expect(live.extract).toHaveBeenCalledOnce();
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
    await new Promise((r) => setTimeout(r, 40));

    const result = await runner.stop(actor, note.id);
    expect(result.saved).toBe(true);

    const saved = await meetings.get(actor, note.id);
    expect(saved.body).toContain('## Transcript');
    expect(saved.body).toContain('**Marieke:**'); // who said it, in the record
    expect(saved.body).toContain('## Summary');
    expect(saved.transcriptCostCents).toBe(11);

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
    await new Promise((r) => setTimeout(r, 30));
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
    await new Promise((r) => setTimeout(r, 50));

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
    await new Promise((r) => setTimeout(r, 30));

    expect(conversation.reply).not.toHaveBeenCalled();
  });

  it('refuses to speak into a meeting it is not in', async () => {
    const note = await noteWithConsent();
    await expect(runner.speak(note.id, Buffer.from('mp3'), 'audio/mp3')).rejects.toThrow(
      /No live capture/,
    );
  });
});
