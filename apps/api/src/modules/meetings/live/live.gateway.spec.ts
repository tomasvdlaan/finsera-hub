import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@platform/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../../../core/audit/audit.service.js';
import type { AuthGuard } from '../../../core/auth/auth.guard.js';
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
import { UserService } from '../../../core/auth/user.service.js';
import { MeetingsService } from '../meetings.service.js';
import type { LiveSession } from './live-session.js';
import { LiveRegistry } from './live-registry.service.js';
import { LiveRunner } from './live-runner.service.js';
import { BehaviourRegistry } from './behaviours/behaviour.registry.js';
import type { AiToolRegistry } from '../../../core/llm/tool-registry.service.js';
import type { LlmService } from '../../../core/llm/llm.service.js';
import type { TtsService } from '../../../core/llm/tts.service.js';
import type { ConversationService } from './conversation.service.js';
import type { RecallProvider } from './capture/recall.provider.js';
import { LiveGateway } from './live.gateway.js';
import type { LiveService } from './live.service.js';

const actor: Actor = { userId: crypto.randomUUID(), role: 'admin' };

/** A WebSocket that records what was sent rather than sending it anywhere. */
class FakeSocket {
  readonly OPEN = 1;
  readyState = 1;
  readonly sent: Array<Record<string, unknown>> = [];
  closed = false;
  private handler?: (raw: Buffer) => void;

  send(payload: string) {
    this.sent.push(JSON.parse(payload) as Record<string, unknown>);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  on(event: string, handler: (raw: Buffer) => void) {
    if (event === 'message') this.handler = handler;
  }
  /** Deliver a client message, as the ws library would. */
  async deliver(message: Record<string, unknown>) {
    this.handler?.(Buffer.from(JSON.stringify(message)));
    // The handler is async and not awaited by ws; give it a turn to finish.
    await new Promise((r) => setTimeout(r, 30));
  }
  messagesOfType(type: string) {
    return this.sent.filter((m) => m.type === type);
  }
}

const request = (query: string) => ({ url: `/api/meetings/live?${query}` }) as never;

describe('LiveGateway', () => {
  let meetings: MeetingsService;
  let crm: CrmService;
  let gateway: LiveGateway;
  let sessions: LiveRegistry;
  let runner: LiveRunner;
  let behaviourRuns: BehaviourRegistry;
  let live: { transcribeSegment: ReturnType<typeof vi.fn>; extract: ReturnType<typeof vi.fn>; costCents: ReturnType<typeof vi.fn> };
  let clientId: string;
  let projectId: string;

  beforeEach(async () => {
    // The real window is 45s. These tests are about what happens at each end of it.
    process.env.LIVE_RECONNECT_GRACE_MS = '40';
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
    meetings = new MeetingsService(
      testDb, registry, permissions, audit, bus, links,
      new EmbeddingService(), crm, scrum, new UserService(testDb),
    );

    // The models are faked: this tests the gateway's behaviour, not the provider's.
    live = {
      transcribeSegment: vi.fn().mockResolvedValue('We should add supplier drill-down.'),
      // Faithful to the real one, which updates the session's running state in place —
      // that state is what persist() writes, so a fake that only returned it would test
      // a gateway that does not exist.
      extract: vi.fn().mockImplementation((session: LiveSession) => {
        const added = [
          { id: 'p1', kind: 'action', text: 'Add supplier drill-down', status: 'open' },
          { id: 'p2', kind: 'note', text: 'They liked the spend view', status: 'open' },
        ];
        session.state = {
          summary: 'Discussed the spend model.',
          decisions: ['Add a supplier dimension'],
          openQuestions: [],
        };
        session.proposals.push(...(added as never[]));
        session.markExtracted();
        return Promise.resolve({ added, state: session.state, agendaCovered: [] });
      }),
      costCents: vi.fn().mockReturnValue(7),
    };

    const auth = { verifyToken: vi.fn().mockResolvedValue(actor) } as unknown as AuthGuard;
    /*
     * A real LiveRunner, because the gateway now ends meetings through it rather than
     * writing the note itself — a stub here would assert the stub.
     *
     * Its behaviours are stubbed off (an empty enabled set makes runBehaviours return
     * before it reaches a model) so these tests stay about the socket. That the socket
     * runs behaviours at all is covered separately.
     */
    sessions = new LiveRegistry();
    const noBehaviours = new BehaviourRegistry(
      { name: 'a', description: '', trigger: 'utterance', canSpeak: false,
        shouldRun: () => false, run: async () => null } as unknown as never,
      { name: 'b', description: '', trigger: 'interval', canSpeak: false,
        shouldRun: () => false, run: async () => null } as unknown as never,
      { name: 'c', description: '', trigger: 'interval', canSpeak: false,
        shouldRun: () => false, run: async () => null } as unknown as never,
      { name: 'd', description: '', trigger: 'interval', canSpeak: false,
        shouldRun: () => false, run: async () => null } as unknown as never,
    );
    noBehaviours.defaults = () => ({ enabled: new Set<string>(), maySpeak: false });
    behaviourRuns = noBehaviours;

    runner = new LiveRunner(
      registry,
      meetings,
      live as unknown as LiveService,
      sessions,
      { isConfigured: () => false } as unknown as RecallProvider,
      { forget: vi.fn() } as unknown as ConversationService,
      noBehaviours,
      { buildToolSet: vi.fn().mockResolvedValue({ tools: {}, invocations: [] }) } as unknown as AiToolRegistry,
      {} as LlmService,
      {} as unknown as TtsService,
    );

    gateway = new LiveGateway(
      auth,
      registry,
      meetings,
      live as unknown as LiveService,
      sessions,
      runner,
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
      attendees: [{ name: 'Tomas' }, { name: 'Client' }],
    });
    if (consented) {
      for (const person of note.attendees) {
        await meetings.setConsent(actor, note.id, person.id, 'granted');
      }
    }
    return note;
  };

  // ── the gate ──

  it('refuses to open without consent from everyone', async () => {
    const note = await noteWithConsent(false);
    const socket = new FakeSocket();

    await gateway.handleConnection(socket as never, request(`token=t&noteId=${note.id}`));

    expect(socket.closed).toBe(true);
    expect(socket.messagesOfType('ready')).toHaveLength(0);
    expect(String(socket.messagesOfType('error')[0]?.message)).toMatch(/consent/i);
  });

  it('refuses when one attendee declined', async () => {
    const note = await noteWithConsent(false);
    await meetings.setConsent(actor, note.id, note.attendees[0]!.id, 'granted');
    await meetings.setConsent(actor, note.id, note.attendees[1]!.id, 'declined');

    const socket = new FakeSocket();
    await gateway.handleConnection(socket as never, request(`token=t&noteId=${note.id}`));
    expect(socket.closed).toBe(true);
  });

  it('opens once everyone has consented', async () => {
    const note = await noteWithConsent();
    const socket = new FakeSocket();

    await gateway.handleConnection(socket as never, request(`token=t&noteId=${note.id}`));

    expect(socket.closed).toBe(false);
    expect(socket.messagesOfType('ready')).toHaveLength(1);
  });

  it('refuses without a token or a note', async () => {
    const socket = new FakeSocket();
    await gateway.handleConnection(socket as never, request('noteId=nothing'));
    expect(socket.closed).toBe(true);
  });

  // ── the loop ──

  it('transcribes a segment into a line, and never stores the audio', async () => {
    const note = await noteWithConsent();
    const socket = new FakeSocket();
    await gateway.handleConnection(socket as never, request(`token=t&noteId=${note.id}`));

    await socket.deliver({
      type: 'audio',
      mimeType: 'audio/webm',
      data: Buffer.from('pretend audio').toString('base64'),
    });

    const lines = socket.messagesOfType('line');
    expect(lines).toHaveLength(1);
    expect((lines[0]!.line as { text: string }).text).toBe('We should add supplier drill-down.');
    // The buffer was passed to the transcriber and dropped; nothing wrote it anywhere.
    expect(live.transcribeSegment).toHaveBeenCalledOnce();
    expect(socket.messagesOfType('cost')).toHaveLength(1);
  });

  it('keeps going when a segment fails to transcribe', async () => {
    const note = await noteWithConsent();
    const socket = new FakeSocket();
    await gateway.handleConnection(socket as never, request(`token=t&noteId=${note.id}`));

    live.transcribeSegment.mockRejectedValueOnce(new Error('provider hiccup'));
    await socket.deliver({ type: 'audio', data: Buffer.from('x').toString('base64') });
    expect(socket.closed).toBe(false); // a lost few seconds must not end the meeting

    live.transcribeSegment.mockResolvedValueOnce('Back again.');
    await socket.deliver({ type: 'audio', data: Buffer.from('y').toString('base64') });
    expect(socket.messagesOfType('line')).toHaveLength(1);
  });

  it('runs an extraction once enough has been said, and pushes the proposals', async () => {
    const note = await noteWithConsent();
    const socket = new FakeSocket();
    await gateway.handleConnection(socket as never, request(`token=t&noteId=${note.id}`));

    // One long segment crosses the threshold in a single step.
    live.transcribeSegment.mockResolvedValueOnce('word '.repeat(300));
    await socket.deliver({ type: 'audio', data: Buffer.from('x').toString('base64') });
    await new Promise((r) => setTimeout(r, 60));

    expect(live.extract).toHaveBeenCalledOnce();
    expect(socket.messagesOfType('proposals')).toHaveLength(1);
    expect(socket.messagesOfType('state')).toHaveLength(1);
  });

  it('does not extract on a short segment', async () => {
    const note = await noteWithConsent();
    const socket = new FakeSocket();
    await gateway.handleConnection(socket as never, request(`token=t&noteId=${note.id}`));

    await socket.deliver({ type: 'audio', data: Buffer.from('x').toString('base64') });
    expect(live.extract).not.toHaveBeenCalled();
  });


  // ── the session is on the register, and comes off it ──

  it('registers the session, so the note counts as being captured', async () => {
    const note = await noteWithConsent();
    const socket = new FakeSocket();
    await gateway.handleConnection(socket as never, request(`token=t&noteId=${note.id}`));

    expect(sessions.active).toContain(note.id);
  });

  it('takes the session off the register when it stops', async () => {
    const note = await noteWithConsent();
    const socket = new FakeSocket();
    await gateway.handleConnection(socket as never, request(`token=t&noteId=${note.id}`));
    await socket.deliver({ type: 'audio', data: Buffer.from('x').toString('base64') });
    await socket.deliver({ type: 'stop' });

    // The whole risk of registering: a session left listed is a note that can never be
    // recorded again, because every path that starts one refuses while one is running.
    expect(sessions.active).not.toContain(note.id);
  });

  it('writes the meeting down when nobody comes back', async () => {
    const note = await noteWithConsent();
    const socket = new FakeSocket();
    await gateway.handleConnection(socket as never, request(`token=t&noteId=${note.id}`));
    await socket.deliver({ type: 'audio', data: Buffer.from('x').toString('base64') });

    await gateway.handleDisconnect(socket as never);
    await new Promise((r) => setTimeout(r, 120));

    // The grace window is what makes a reload survivable, and the timer at the end of it is
    // now the only thing that will ever write an abandoned meeting down. A session left on
    // the register is a note that can never be recorded again.
    expect(sessions.active).not.toContain(note.id);
    expect((await meetings.get(actor, note.id)).endedAt).not.toBeNull();
  });

  it('frees the note even when saving what was said fails', async () => {
    const note = await noteWithConsent();
    const socket = new FakeSocket();
    await gateway.handleConnection(socket as never, request(`token=t&noteId=${note.id}`));
    await socket.deliver({ type: 'audio', data: Buffer.from('x').toString('base64') });

    // A locked note is worse than a lost transcript: one is a bad meeting, the other is
    // a meeting you can never record again without a restart.
    vi.spyOn(meetings, 'update').mockRejectedValueOnce(new Error('database gone'));
    await gateway.handleDisconnect(socket as never);
    await new Promise((r) => setTimeout(r, 120));

    expect(sessions.active).not.toContain(note.id);
  });

  it('tells the screen it stopped', async () => {
    const note = await noteWithConsent();
    const socket = new FakeSocket();
    await gateway.handleConnection(socket as never, request(`token=t&noteId=${note.id}`));
    await socket.deliver({ type: 'audio', data: Buffer.from('x').toString('base64') });
    await socket.deliver({ type: 'stop' });

    // Sent to the watchers handed back by end(); a lookup by note id would find nothing,
    // which is why this message used to go nowhere at all.
    expect(socket.messagesOfType('stopped')).toHaveLength(1);
  });

  it('says so even when the recording caught nothing', async () => {
    const note = await noteWithConsent();
    const socket = new FakeSocket();
    await gateway.handleConnection(socket as never, request(`token=t&noteId=${note.id}`));
    await socket.deliver({ type: 'stop' });

    expect(socket.messagesOfType('stopped')).toHaveLength(1);
    expect(sessions.active).not.toContain(note.id);
  });

  it('records when the meeting actually ran, not just its date', async () => {
    const note = await noteWithConsent();
    const socket = new FakeSocket();
    await gateway.handleConnection(socket as never, request(`token=t&noteId=${note.id}`));

    // notes.startedAt and endedAt have existed with a CHECK constraint since the module was
    // written and nothing wrote them, so nothing could say whether a note filed under
    // Tuesday was a nine o'clock stand-up or an evening that overran.
    const started = await meetings.get(actor, note.id);
    expect(started.startedAt).not.toBeNull();
    expect(started.endedAt).toBeNull();

    await socket.deliver({ type: 'audio', data: Buffer.from('x').toString('base64') });
    await socket.deliver({ type: 'stop' });

    const ended = await meetings.get(actor, note.id);
    expect(ended.endedAt).not.toBeNull();
    expect(new Date(ended.endedAt!).getTime()).toBeGreaterThanOrEqual(
      new Date(ended.startedAt!).getTime(),
    );
  });

  it('stamps the end time even when the recording caught nothing', async () => {
    const note = await noteWithConsent();
    const socket = new FakeSocket();
    await gateway.handleConnection(socket as never, request(`token=t&noteId=${note.id}`));
    await socket.deliver({ type: 'stop' });

    // A start with no end reads as still running, forever, and cannot be told apart from a
    // meeting that genuinely never stopped.
    const saved = await meetings.get(actor, note.id);
    expect(saved.startedAt).not.toBeNull();
    expect(saved.endedAt).not.toBeNull();
  });

  it('keeps the first start time when the same note is recorded twice', async () => {
    const note = await noteWithConsent();
    const first = new FakeSocket();
    await gateway.handleConnection(first as never, request(`token=t&noteId=${note.id}`));
    const startedAt = (await meetings.get(actor, note.id)).startedAt;
    await first.deliver({ type: 'stop' });

    const second = new FakeSocket();
    await gateway.handleConnection(second as never, request(`token=t&noteId=${note.id}`));

    // A note recorded twice spans from the first recording to the last, which is the honest
    // reading of "when was this meeting".
    expect((await meetings.get(actor, note.id)).startedAt).toEqual(startedAt);
  });

  // ── surviving a reload ──

  it('holds the meeting open when the recording tab goes away', async () => {
    const note = await noteWithConsent();
    const socket = new FakeSocket();
    await gateway.handleConnection(socket as never, request(`token=t&noteId=${note.id}`));
    await socket.deliver({ type: 'audio', data: Buffer.from('x').toString('base64') });

    await gateway.handleDisconnect(socket as never);

    // A reload closes the socket and reopens it a second later; closing the tab never reopens
    // it, and nothing on the wire tells them apart. So the session waits.
    expect(sessions.active).toContain(note.id);
    expect(sessions.isOrphaned(note.id)).toBe(true);
    expect((await meetings.get(actor, note.id)).endedAt).toBeNull();
  });

  it('gives the meeting back to a tab that comes straight back', async () => {
    const note = await noteWithConsent();
    const first = new FakeSocket();
    await gateway.handleConnection(first as never, request(`token=t&noteId=${note.id}`));
    live.transcribeSegment.mockResolvedValueOnce('Said before the reload');
    await first.deliver({ type: 'audio', data: Buffer.from('x').toString('base64') });
    await gateway.handleDisconnect(first as never);

    const reloaded = new FakeSocket();
    await gateway.handleConnection(reloaded as never, request(`token=t&noteId=${note.id}`));

    // Told it is the source, not a watcher — otherwise it would sit there recording nothing.
    expect(reloaded.messagesOfType('ready')[0]!.mode).toBe('source');
    expect(sessions.isOrphaned(note.id)).toBe(false);

    // And it is the same meeting: what was said before the reload is still there.
    live.transcribeSegment.mockResolvedValueOnce('Said after the reload');
    await reloaded.deliver({ type: 'audio', data: Buffer.from('y').toString('base64') });
    await reloaded.deliver({ type: 'stop' });

    const [transcript] = await meetings.listTranscripts(actor, note.id);
    const said = JSON.stringify(transcript!.lines);
    expect(said).toContain('Said before the reload');
    expect(said).toContain('Said after the reload');
  });

  it('still watches, rather than taking over, while a source is live', async () => {
    const note = await noteWithConsent();
    const holder = new FakeSocket();
    await gateway.handleConnection(holder as never, request(`token=t&noteId=${note.id}`));

    const second = new FakeSocket();
    await gateway.handleConnection(second as never, request(`token=t&noteId=${note.id}`));

    // Two tabs both sending audio would double every line and the cost with it.
    expect(second.messagesOfType('ready')[0]!.mode).toBe('watching');
  });

  it('stopping on purpose ends it now, with nothing left armed', async () => {
    const note = await noteWithConsent();
    const socket = new FakeSocket();
    await gateway.handleConnection(socket as never, request(`token=t&noteId=${note.id}`));
    await socket.deliver({ type: 'audio', data: Buffer.from('x').toString('base64') });
    await socket.deliver({ type: 'stop' });

    // No grace window: you said stop. And nothing left that could finish it a second time.
    expect(sessions.active).not.toContain(note.id);
    expect((await meetings.get(actor, note.id)).endedAt).not.toBeNull();
  });

  it('records whether the audio was a microphone or a shared tab', async () => {
    const note = await noteWithConsent();
    const socket = new FakeSocket();
    await gateway.handleConnection(
      socket as never,
      request(`token=t&noteId=${note.id}&source=tab`),
    );

    // Needed on reconnect: a microphone can be reacquired silently, a shared tab never can.
    expect(socket.messagesOfType('ready')[0]!.source).toBe('tab');
    await gateway.handleDisconnect(socket as never);
    const status = runner.status(note.id) as { awaitingAudio: boolean; source: string };
    expect(status.awaitingAudio).toBe(true);
    expect(status.source).toBe('tab');
  });

  // ── behaviours, which never ran here before ──

  it('runs behaviours on what was said', async () => {
    behaviourRuns.defaults = () => ({ enabled: new Set(['a', 'b', 'c']), maySpeak: false });
    const note = await noteWithConsent();
    const socket = new FakeSocket();
    await gateway.handleConnection(socket as never, request(`token=t&noteId=${note.id}`));

    const ran = vi.spyOn(behaviourRuns, 'run').mockResolvedValue([]);
    await socket.deliver({ type: 'audio', data: Buffer.from('x').toString('base64') });
    await new Promise((r) => setTimeout(r, 40));

    expect(ran).toHaveBeenCalled();
    expect(ran.mock.calls[0]![0]).toBe('utterance');
  });

  it('a second tab watches instead of opening a rival session', async () => {
    const note = await noteWithConsent();
    const first = new FakeSocket();
    await gateway.handleConnection(first as never, request(`token=t&noteId=${note.id}`));

    const second = new FakeSocket();
    await gateway.handleConnection(second as never, request(`token=t&noteId=${note.id}`));

    expect(second.messagesOfType('ready')[0]!.mode).toBe('watching');
    // And it sees the same transcript as the tab holding the microphone.
    await first.deliver({ type: 'audio', data: Buffer.from('x').toString('base64') });
    expect(second.messagesOfType('line')).toHaveLength(1);
  });

  // ── what survives the meeting ──

  it('writes the transcript and the proposals when the session stops', async () => {
    const note = await noteWithConsent();
    const socket = new FakeSocket();
    await gateway.handleConnection(socket as never, request(`token=t&noteId=${note.id}`));

    live.transcribeSegment.mockResolvedValueOnce('word '.repeat(300));
    await socket.deliver({ type: 'audio', data: Buffer.from('x').toString('base64') });
    await new Promise((r) => setTimeout(r, 60));
    await socket.deliver({ type: 'stop' });

    const saved = await meetings.get(actor, note.id);
    // What was understood stays in the note; what was said goes next to it.
    expect(saved.body).toContain('## Summary');
    expect(saved.body).toContain('## Decisions');
    expect(saved.body).not.toContain('## Transcript');
    expect(saved.transcribedAt).not.toBeNull();
    expect(saved.transcriptCostCents).toBe(7);

    const [transcript] = await meetings.listTranscripts(actor, note.id);
    expect(transcript!.lines).not.toHaveLength(0);
    // No capture provider on this path, which is what 'browser' means.
    expect(transcript!.provider).toBe('browser');

    // Only the ACTION proposal became an action point, and it is still only proposed.
    expect(saved.actionItems).toHaveLength(1);
    expect(saved.actionItems[0]!.text).toBe('Add supplier drill-down');
    expect(saved.actionItems[0]!.status).toBe('proposed');
    expect(saved.actionItems[0]!.source).toBe('ai');
  });

  it('nothing reaches the board on its own', async () => {
    const note = await noteWithConsent();
    const socket = new FakeSocket();
    await gateway.handleConnection(socket as never, request(`token=t&noteId=${note.id}`));

    live.transcribeSegment.mockResolvedValueOnce('word '.repeat(300));
    await socket.deliver({ type: 'audio', data: Buffer.from('x').toString('base64') });
    await new Promise((r) => setTimeout(r, 60));
    await socket.deliver({ type: 'stop' });

    const tasks = await testDb.execute(sql`SELECT id FROM scrum.tasks`);
    expect(tasks.rows).toHaveLength(0);
  });

  it('saves what was said even when the connection drops', async () => {
    const note = await noteWithConsent();
    const socket = new FakeSocket();
    await gateway.handleConnection(socket as never, request(`token=t&noteId=${note.id}`));
    await socket.deliver({ type: 'audio', data: Buffer.from('x').toString('base64') });

    // A crashed tab should not also lose the meeting — it costs the grace window, no more.
    await gateway.handleDisconnect(socket as never);
    await new Promise((r) => setTimeout(r, 120));

    const [transcript] = await meetings.listTranscripts(actor, note.id);
    expect(JSON.stringify(transcript!.lines)).toContain('We should add supplier drill-down.');
  });

  it('writes nothing when no audio was ever received', async () => {
    const note = await noteWithConsent();
    const before = await meetings.get(actor, note.id);
    const socket = new FakeSocket();
    await gateway.handleConnection(socket as never, request(`token=t&noteId=${note.id}`));
    await gateway.handleDisconnect(socket as never);

    const after = await meetings.get(actor, note.id);
    expect(after.body).toBe(before.body);
    expect(after.transcribedAt).toBeNull();
  });
});
