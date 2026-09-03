import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@platform/contracts';
import { eq, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { timeManifest } from '../time/time.manifest.js';
import { TimeService } from '../time/time.service.js';
import { resetDb, seedUser, testDb, truncate } from '../../test/db.js';
import { crmManifest } from '../crm/crm.manifest.js';
import { CrmService } from '../crm/crm.service.js';
import { scrumManifest } from '../scrum/scrum.manifest.js';
import { ScrumService } from '../scrum/scrum.service.js';
import { PortalTicketsService } from './portal-tickets.service.js';
import { PortalUsersService } from './portal-users.service.js';
import { portalManifest } from './portal.manifest.js';
import { portalTicketMessages, portalTickets } from './portal.schema.js';
import type { PortalVisitor } from './portal.projection.js';

const actor: Actor = { userId: crypto.randomUUID(), role: 'admin' };

describe('PortalTicketsService', () => {
  let tickets: PortalTicketsService;
  let crm: CrmService;
  let clientId: string;
  let projectId: string;
  let visitor: PortalVisitor;
  let other: { clientId: string; visitor: PortalVisitor };

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE portal.tickets, portal.ticket_messages, portal.users,
      scrum.tasks, scrum.sprints, scrum.boards, time.entries,
      crm.project_members, crm.projects, crm.contacts, crm.clients CASCADE`);
    await seedUser(actor.userId, 'admin', 'Tomas');

    const manifests = new ManifestRegistry();
    for (const m of [crmManifest, timeManifest, scrumManifest, portalManifest]) {
      manifests.register(m);
    }
    manifests.seal();
    const registry = new RegistryService(testDb, manifests);
    const permissions = new PermissionService(testDb, manifests);
    const audit = new AuditService();
    const events = new EventBus(manifests);
    const links = new LinkService(testDb, registry, permissions, audit, manifests);
    crm = new CrmService(testDb, registry, permissions, audit, events, links);
    const time = new TimeService(testDb, registry, permissions, audit, events, links, crm);
    const scrum = new ScrumService(
      testDb, registry, permissions, audit, events, links, crm, time,
    );
    const users = new PortalUsersService(testDb, permissions, audit);
    tickets = new PortalTicketsService(testDb, audit, scrum);

    clientId = (await crm.createClient(actor, { name: 'Duce', status: 'active' })).id;
    await crm.updateClient(actor, clientId, { portalSlug: 'duce' });
    projectId = (
      await crm.createProject(actor, {
        clientId, name: 'Dashboard', billingModel: 'fixed_fee', budgetAmountCents: 500_000,
      })
    ).id;
    const pu = await users.invite(actor, {
      clientId, email: 'finance@duce.nl', oidcSubject: 'sub-duce',
    });
    visitor = { portalUserId: pu.id, clientId, email: 'finance@duce.nl' };

    const otherClient = (await crm.createClient(actor, { name: 'DocHorse', status: 'active' })).id;
    await crm.updateClient(actor, otherClient, { portalSlug: 'dochorse' });
    const otherPu = await users.invite(actor, {
      clientId: otherClient, email: 'them@dochorse.nl', oidcSubject: 'sub-dh',
    });
    other = {
      clientId: otherClient,
      visitor: { portalUserId: otherPu.id, clientId: otherClient, email: 'them@dochorse.nl' },
    };
  });

  const openOne = () =>
    tickets.open(visitor, { subject: 'Extra rapportage', body: 'Kunt u ook Q3 toevoegen?' });

  it('opens a ticket with the client’s words as the first message', async () => {
    const { id, status } = await openOne();
    expect(status).toBe('waiting_on_finsera');

    const thread = await tickets.threadForClient(visitor, id);
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]).toMatchObject({
      author_kind: 'client', body: 'Kunt u ook Q3 toevoegen?', author_name: 'finance@duce.nl',
    });
  });

  // ── whose turn it is, derived rather than typed ──

  it('hands the ticket back and forth as each side writes', async () => {
    const { id } = await openOne();
    expect((await tickets.reply(actor, id, { body: 'We pakken het op.' })).status).toBe(
      'waiting_on_client',
    );
    expect((await tickets.replyAsClient(visitor, id, 'Graag!')).status).toBe('waiting_on_finsera');
  });

  it('leaves the turn alone when we only write a note to ourselves', async () => {
    const { id } = await openOne();
    await tickets.reply(actor, id, { body: 'Vragen aan Sander', internalOnly: true });

    // A ticket that looked answered because somebody left a reminder is worse than one
    // that looks unanswered.
    const { ticket } = await tickets.thread(id);
    expect(ticket.status).toBe('waiting_on_finsera');
  });

  it('closes and reopens only when somebody decides to', async () => {
    const { id } = await openOne();
    expect((await tickets.close(actor, id)).status).toBe('closed');
    await expect(tickets.replyAsClient(visitor, id, 'Toch nog iets')).rejects.toThrow(/afgerond/);
    expect((await tickets.reopen(actor, id)).status).toBe('waiting_on_finsera');
    await expect(tickets.replyAsClient(visitor, id, 'Toch nog iets')).resolves.toBeTruthy();
  });

  // ── what the client may see ──

  it('never shows the client an internal note', async () => {
    const { id } = await openOne();
    await tickets.reply(actor, id, { body: 'Marge is hier krap', internalOnly: true });
    await tickets.reply(actor, id, { body: 'Dat kan, we plannen het in.' });

    const thread = await tickets.threadForClient(visitor, id);
    expect(thread.messages).toHaveLength(2);
    expect(JSON.stringify(thread.messages)).not.toContain('Marge');
    // Internally the note is there, which is the whole point of it being on the thread.
    expect((await tickets.thread(id)).messages).toHaveLength(3);
  });

  it('refuses a client the database rejects an internal note from', async () => {
    const { id } = await openOne();
    // The concept does not exist on their side, and the check constraint says so — this is
    // the floor under the service, not a restatement of it.
    await expect(
      testDb.insert(portalTicketMessages).values({
        id: crypto.randomUUID(),
        ticketId: id,
        authorKind: 'client',
        authorId: visitor.portalUserId,
        body: 'sneaky',
        internalOnly: true,
      }),
    ).rejects.toThrow();
  });

  it('never shows one client another client’s ticket, by any route', async () => {
    const { id } = await openOne();
    // A real id, belonging to somebody else. Guessing one is not the hard part of this.
    await expect(tickets.threadForClient(other.visitor, id)).rejects.toThrow(/Niet gevonden/);
    await expect(tickets.replyAsClient(other.visitor, id, 'hallo')).rejects.toThrow(/Niet gevonden/);
    expect(await tickets.forClient({ clientId: other.clientId })).toEqual([]);
  });

  // ── the rule inherited from portal.requests ──

  it('becomes a task only when somebody deliberately makes it one, and stays open', async () => {
    const { id } = await openOne();
    const { ticket: before } = await tickets.thread(id);
    expect(before.taskId).toBeNull();

    const { taskId } = await tickets.convert(actor, id, { projectId });
    const { ticket } = await tickets.thread(id);
    expect(ticket.taskId).toBe(taskId);
    // The work starting is not the same event as the client being answered.
    expect(ticket.status).toBe('waiting_on_finsera');
    await expect(tickets.convert(actor, id, { projectId })).rejects.toThrow(/already became/);
  });

  it('attributes the client’s words in the task it creates', async () => {
    const { id } = await openOne();
    const { taskId } = await tickets.convert(actor, id, { projectId });
    const { rows } = await testDb.execute<{ description: string }>(
      sql`SELECT description FROM scrum.tasks WHERE id = ${taskId}`,
    );
    // Anyone reading the task — or any assistant summarising it — should be able to tell
    // whose words these are.
    expect(rows[0]?.description).toContain('Verzoek van de klant');
    expect(rows[0]?.description).toContain('Kunt u ook Q3 toevoegen?');
  });

  it('accepts a project id only when it belongs to this client', async () => {
    const theirs = (
      await crm.createProject(actor, {
        clientId: other.clientId, name: 'Not yours', billingModel: 'fixed_fee',
        budgetAmountCents: 100_000,
      })
    ).id;
    await expect(
      tickets.open(visitor, { subject: 'x', body: 'y', projectId: theirs }),
    ).rejects.toThrow(/Onbekend project/);
    await expect(
      tickets.open(visitor, { subject: 'x', body: 'y', projectId }),
    ).resolves.toBeTruthy();
  });

  // ── the input nobody else in the portal accepts ──

  it('bounds what a client can write, in the service and in the database', async () => {
    await expect(tickets.open(visitor, { subject: '', body: 'x' })).rejects.toThrow(/onderwerp/i);
    await expect(tickets.open(visitor, { subject: 'x', body: '' })).rejects.toThrow(/onderwerp/i);
    await expect(
      tickets.open(visitor, { subject: 'x'.repeat(201), body: 'y' }),
    ).rejects.toThrow(/200/);
    await expect(
      tickets.open(visitor, { subject: 'x', body: 'y'.repeat(5001) }),
    ).rejects.toThrow(/5000/);
  });

  it('rate-limits from the rows, so restarting the process does not reset it', async () => {
    for (let i = 0; i < 10; i++) {
      await tickets.open(visitor, { subject: `Vraag ${i}`, body: 'Iets' });
    }
    // A counter in a process is not what you want standing between a client and unbounded
    // writes, so this is counted from the messages themselves.
    await expect(tickets.open(visitor, { subject: 'Elfde', body: 'Iets' })).rejects.toThrow(
      /over een uur/,
    );
  });

  // ── the inbox ──

  it('lists everything unclosed across clients, and drops it on close', async () => {
    const mine = await openOne();
    await tickets.open(other.visitor, { subject: 'Van DocHorse', body: 'Iets anders' });
    expect(await tickets.inbox()).toHaveLength(2);
    expect((await tickets.inbox())[0]).toMatchObject({ client_name: 'Duce' });

    await tickets.close(actor, mine.id);
    expect(await tickets.inbox()).toHaveLength(1);
  });

  it('records every step against the client', async () => {
    const { id } = await openOne();
    await tickets.reply(actor, id, { body: 'Ja hoor' });
    await tickets.close(actor, id);
    const { rows } = await testDb.execute<{ action: string }>(
      sql`SELECT action FROM core.audit_log WHERE action LIKE 'portal.ticket.%' ORDER BY id`,
    );
    expect(rows.map((r) => r.action)).toEqual([
      'portal.ticket.opened',
      'portal.ticket.answered',
      'portal.ticket.closed',
    ]);
  });

  it('assigns a ticket to somebody, and to nobody again', async () => {
    const { id } = await openOne();
    await tickets.assign(actor, id, actor.userId);
    expect((await tickets.thread(id)).ticket.assignedTo).toBe(actor.userId);
    await tickets.assign(actor, id, null);
    expect((await tickets.thread(id)).ticket.assignedTo).toBeNull();
  });

  it('orders a client’s own list by what happened last', async () => {
    const first = await openOne();
    const second = await tickets.open(visitor, { subject: 'Tweede', body: 'Iets' });
    await tickets.reply(actor, first.id, { body: 'Antwoord' });

    const list = (await tickets.forClient(visitor)) as Array<{ id: string; message_count: number }>;
    expect(list[0]?.id).toBe(first.id);
    expect(list[1]?.id).toBe(second.id);
    // The count is what the client can see, so an internal note must not inflate it.
    await tickets.reply(actor, first.id, { body: 'Notitie', internalOnly: true });
    const after = (await tickets.forClient(visitor)) as Array<{ message_count: number }>;
    expect(after[0]?.message_count).toBe(2);
  });

  it('keeps a deleted ticket from leaving orphaned messages', async () => {
    const { id } = await openOne();
    await testDb.delete(portalTickets).where(eq(portalTickets.id, id));
    expect(await testDb.select().from(portalTicketMessages)).toHaveLength(0);
  });
});
