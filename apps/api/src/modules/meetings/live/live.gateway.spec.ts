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
import { MeetingsService } from '../meetings.service.js';
import type { LiveSession } from './live-session.js';
import { LiveRegistry } from './live-registry.service.js';
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
  let live: { transcribeSegment: ReturnType<typeof vi.fn>; extract: ReturnType<typeof vi.fn>; costCents: ReturnType<typeof vi.fn> };
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
    gateway = new LiveGateway(auth, registry, meetings, live as unknown as LiveService, new LiveRegistry());

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
    expect(saved.body).toContain('## Transcript');
    expect(saved.body).toContain('## Summary');
    expect(saved.body).toContain('## Decisions');
    expect(saved.transcribedAt).not.toBeNull();
    expect(saved.transcriptCostCents).toBe(7);

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

    // A crashed tab should not also lose the meeting.
    await gateway.handleDisconnect(socket as never);

    const saved = await meetings.get(actor, note.id);
    expect(saved.body).toContain('We should add supplier drill-down.');
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
