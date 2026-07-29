import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@platform/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { EmbeddingService } from '../../core/llm/embedding.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { resetDb, seedUser, testDb, truncate } from '../../test/db.js';
import { crmManifest } from '../crm/crm.manifest.js';
import { CrmService } from '../crm/crm.service.js';
import { scrumManifest } from '../scrum/scrum.manifest.js';
import { ScrumService } from '../scrum/scrum.service.js';
import { timeManifest } from '../time/time.manifest.js';
import { TimeService } from '../time/time.service.js';
import { meetingsManifest } from './meetings.manifest.js';
import { MeetingsService } from './meetings.service.js';

const actor: Actor = { userId: crypto.randomUUID(), role: 'admin' };

describe('MeetingsService', () => {
  let crm: CrmService;
  let scrum: ScrumService;
  let meetings: MeetingsService;
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
    scrum = new ScrumService(testDb, registry, permissions, audit, bus, links, crm, time);
    meetings = new MeetingsService(
      testDb, registry, permissions, audit, bus, links,
      new EmbeddingService(), crm, scrum,
    );
    await meetings.ensureReportingViews();

    const client = await crm.createClient(actor, { name: 'DocHorse', status: 'active' });
    clientId = client.id;
    const project = await crm.createProject(actor, {
      clientId,
      name: 'Power BI',
      billingModel: 'time_and_materials',
    });
    projectId = project.id;
  });

  const note = (over: Record<string, unknown> = {}) =>
    meetings.create(actor, {
      title: 'Voortgang Power BI',
      clientId,
      projectId,
      ...over,
    } as Parameters<MeetingsService['create']>[1]);

  // ── notes ──

  it('creates a note linked to its client and project', async () => {
    const created = await note();
    expect(created.title).toBe('Voortgang Power BI');
    expect(created.status).toBe('draft');
    expect(created.meetingDate).toBe(new Date().toISOString().slice(0, 10));

    // It should appear on the client's timeline, which needs a link, not just a column.
    const links = await testDb.execute(
      sql`SELECT link_kind FROM core.links WHERE from_id = ${created.id} AND to_id = ${clientId}`,
    );
    expect(links.rows).toHaveLength(1);
  });

  it('starts from a template, agenda and all', async () => {
    const created = await note({ template: 'kick_off' });
    expect(created.template).toBe('kick_off');
    expect(created.body).toContain('## Scope as agreed');
    expect(created.agenda.length).toBeGreaterThan(0);
    expect(created.agenda[0]!.position).toBe(1);
    expect(created.agenda.every((a) => !a.covered)).toBe(true);
  });

  it('rejects an unknown template rather than silently ignoring it', async () => {
    await expect(note({ template: 'seance' })).rejects.toThrow(/Unknown template/);
  });

  it('publishes meeting_note.created', async () => {
    await note();
    const names = (
      await testDb.execute(sql`SELECT event_name FROM core.events`)
    ).rows.map((r) => (r as { event_name: string }).event_name);
    expect(names).toContain('meeting_note.created');
  });

  it('stays editable after being finalised', async () => {
    const created = await note();
    const finalised = await meetings.finalise(actor, created.id);
    expect(finalised.status).toBe('final');

    // A note records what someone understood, and understanding gets corrected. Unlike an
    // invoice, freezing it would push the correction somewhere worse.
    const corrected = await meetings.update(actor, created.id, {
      body: 'Corrected after checking the numbers.',
    });
    expect(corrected.body).toBe('Corrected after checking the numbers.');
    expect(corrected.status).toBe('final');
  });

  // ── agenda ──

  it('adds agenda items in order and marks them covered', async () => {
    const created = await note();
    await meetings.addAgendaItem(actor, created.id, 'Budget');
    const withTwo = await meetings.addAgendaItem(actor, created.id, 'Timeline');
    expect(withTwo.agenda.map((a) => a.position)).toEqual([1, 2]);

    const covered = await meetings.setAgendaCovered(
      actor,
      created.id,
      withTwo.agenda[0]!.id,
      true,
    );
    expect(covered.agenda[0]!.covered).toBe(true);
    expect(covered.agenda[0]!.coveredAt).not.toBeNull();
    expect(covered.agenda[1]!.covered).toBe(false);
  });

  // ── attendees and consent ──

  it('records consent per attendee, with a timestamp', async () => {
    const created = await note({
      attendees: [{ name: 'Tomas' }, { name: 'Client contact', email: 'them@dochorse.nl' }],
    });
    expect(created.attendees).toHaveLength(2);
    expect(created.everyoneConsented).toBe(false); // nobody has been asked yet

    for (const person of created.attendees) {
      await meetings.setConsent(actor, created.id, person.id, 'granted');
    }
    const consented = await meetings.get(actor, created.id);
    expect(consented.everyoneConsented).toBe(true);
    expect(consented.attendees.every((a) => a.consentAt !== null)).toBe(true);
  });

  it('one refusal is enough to block recording', async () => {
    const created = await note({ attendees: [{ name: 'Tomas' }, { name: 'Sceptic' }] });
    await meetings.setConsent(actor, created.id, created.attendees[0]!.id, 'granted');
    await meetings.setConsent(actor, created.id, created.attendees[1]!.id, 'declined');

    // 6c keys off this: one person declining means the meeting is not recorded.
    expect((await meetings.get(actor, created.id)).everyoneConsented).toBe(false);
  });

  it('a meeting with no attendees recorded is not treated as consented', async () => {
    const created = await note();
    expect(created.everyoneConsented).toBe(false);
  });

  it('audits consent, because "they agreed" needs a record', async () => {
    const created = await note({ attendees: [{ name: 'Tomas' }] });
    await meetings.setConsent(actor, created.id, created.attendees[0]!.id, 'granted');

    const audit = await testDb.execute(
      sql`SELECT action FROM core.audit_log WHERE entity_id = ${created.id}
           AND action = 'meeting_attendee.consent'`,
    );
    expect(audit.rows).toHaveLength(1);
  });

  // ── action points: the seam into SCRUM ──

  it('proposes action points without creating anything', async () => {
    const created = await note();
    const withAction = await meetings.addActionItem(actor, created.id, {
      text: 'Send the updated dataset',
    });

    expect(withAction.actionItems).toHaveLength(1);
    expect(withAction.actionItems[0]!.status).toBe('proposed');
    expect(withAction.actionItems[0]!.taskId).toBeNull();
    // Nothing has reached the board.
    expect(await scrum.listTasks(actor, { projectId })).toHaveLength(0);
  });

  it('accepting an action point creates the task, and only then', async () => {
    const created = await note();
    const withAction = await meetings.addActionItem(actor, created.id, {
      text: 'Send the updated dataset',
    });
    const accepted = await meetings.acceptActionItem(
      actor,
      created.id,
      withAction.actionItems[0]!.id,
    );

    expect(accepted.actionItems[0]!.status).toBe('accepted');
    expect(accepted.actionItems[0]!.taskId).not.toBeNull();

    const tasks = await scrum.listTasks(actor, { projectId });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe('Send the updated dataset');
    // The task says where it came from, so the board is not full of orphan context.
    expect(tasks[0]!.description).toContain('Voortgang Power BI');
  });

  it('records whether a suggestion was typed or came from the model', async () => {
    const created = await note();
    const withBoth = await meetings.addActionItem(actor, created.id, {
      text: 'Model suggested this',
      source: 'ai',
    });
    await meetings.addActionItem(actor, created.id, { text: 'I typed this' });

    const sources = (await meetings.get(actor, created.id)).actionItems.map((a) => a.source);
    expect(sources).toContain('ai');
    expect(sources).toContain('typed');
    expect(withBoth.actionItems[0]!.source).toBe('ai');
  });

  it('refuses to create a task when the note has no project', async () => {
    const created = await note({ projectId: null });
    const withAction = await meetings.addActionItem(actor, created.id, { text: 'Something' });
    await expect(
      meetings.acceptActionItem(actor, created.id, withAction.actionItems[0]!.id),
    ).rejects.toThrow(/link this note to a project/i);
  });

  it('dismisses an action point without touching the board', async () => {
    const created = await note();
    const withAction = await meetings.addActionItem(actor, created.id, { text: 'Not doing this' });
    const dismissed = await meetings.dismissActionItem(
      actor,
      created.id,
      withAction.actionItems[0]!.id,
    );
    expect(dismissed.actionItems[0]!.status).toBe('dismissed');
    expect(await scrum.listTasks(actor, { projectId })).toHaveLength(0);
  });

  // ── search ──

  it('finds a note by words in its body', async () => {
    await note({
      title: 'Voortgang Power BI',
      body: 'We agreed to model the purchasing spend before the workshop.',
    });
    await note({ title: 'Something else', body: 'Unrelated conversation about hosting.' });

    const hits = await meetings.search(actor, 'purchasing spend');
    expect(hits).toHaveLength(1);
    expect(String(hits[0]!.title)).toBe('Voortgang Power BI');
  });

  it('finds a note by words in its title', async () => {
    await note({ title: 'Kick-off Inkoopdashboard', body: 'Notes here.' });
    const hits = await meetings.search(actor, 'Inkoopdashboard');
    expect(hits).toHaveLength(1);
  });

  it('returns nothing for an empty query rather than everything', async () => {
    await note({ body: 'Some content.' });
    expect(await meetings.search(actor, '   ')).toEqual([]);
  });

  // ── listing ──

  it('lists notes newest meeting first, filtered by client', async () => {
    await note({ title: 'Older', meetingDate: '2026-01-15' });
    await note({ title: 'Newer', meetingDate: '2026-07-01' });
    const other = await crm.createClient(actor, { name: 'Someone else', status: 'lead' });
    await note({ title: 'Different client', clientId: other.id, projectId: null });

    const forClient = await meetings.list(actor, { clientId });
    expect(forClient.map((n) => n.title)).toEqual(['Newer', 'Older']);
  });

  // ── who was actually in the room ──

  it('marks an expected person as having turned up', async () => {
    const created = await note({ attendees: [{ name: 'Marieke de Vries' }] });
    const updated = await meetings.recordAttendance(actor, created.id, {
      name: 'Marieke de Vries',
    });

    // One person, not two: the name you typed and the name on the roster are the same
    // human, and duplicating them would make the consent list meaningless.
    expect(updated.attendees).toHaveLength(1);
    expect(updated.attendees[0]!.detectedAt).not.toBeNull();
  });

  it('matches regardless of how it was capitalised or spaced', async () => {
    const created = await note({ attendees: [{ name: '  Jan Bakker ' }] });
    const updated = await meetings.recordAttendance(actor, created.id, { name: 'jan bakker' });
    expect(updated.attendees).toHaveLength(1);
  });

  it('matches on email when the name was written differently', async () => {
    const created = await note({
      attendees: [{ name: 'M. de Vries', email: 'marieke@dochorse.nl' }],
    });
    const updated = await meetings.recordAttendance(actor, created.id, {
      name: 'Marieke de Vries',
      email: 'marieke@dochorse.nl',
    });
    expect(updated.attendees).toHaveLength(1);
  });

  it('adds someone who turned up unexpectedly, without consent', async () => {
    const created = await note({ attendees: [{ name: 'Tomas' }] });
    const updated = await meetings.recordAttendance(actor, created.id, { name: 'Surprise Guest' });

    expect(updated.attendees).toHaveLength(2);
    const guest = updated.attendees.find((a) => a.name === 'Surprise Guest')!;
    expect(guest.detectedAt).not.toBeNull();
    // Being in the room is not agreeing to be recorded.
    expect(guest.consent).toBeNull();
  });

  it('names the gap the consent gate cannot cover', async () => {
    const created = await note({ attendees: [{ name: 'Tomas' }] });
    await meetings.setConsent(actor, created.id, created.attendees[0]!.id, 'granted');
    await meetings.recordAttendance(actor, created.id, { name: 'Tomas' });

    let current = await meetings.get(actor, created.id);
    expect(current.unconsentedPresent).toHaveLength(0);

    // The gate runs before the bot joins, so it cannot cover a late arrival. Rather than
    // pretend otherwise, the gap is reported.
    current = await meetings.recordAttendance(actor, created.id, { name: 'Late Arrival' });
    expect(current.unconsentedPresent.map((p) => p.name)).toEqual(['Late Arrival']);
  });

  it('is idempotent, because a rejoin is not a second person', async () => {
    const created = await note();
    await meetings.recordAttendance(actor, created.id, { name: 'Marieke' });
    const updated = await meetings.recordAttendance(actor, created.id, { name: 'Marieke' });
    expect(updated.attendees).toHaveLength(1);
  });

  it('ignores an empty name', async () => {
    const created = await note();
    const updated = await meetings.recordAttendance(actor, created.id, { name: '   ' });
    expect(updated.attendees).toHaveLength(0);
  });
});
