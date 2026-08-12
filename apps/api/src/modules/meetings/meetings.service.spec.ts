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
import { UserService } from '../../core/auth/user.service.js';
import { NoteDocService } from './doc/note-doc.service.js';
import { MeetingsService } from './meetings.service.js';

const actor: Actor = { userId: crypto.randomUUID(), role: 'admin' };

describe('MeetingsService', () => {
  let crm: CrmService;
  let scrum: ScrumService;
  let meetings: MeetingsService;
  let docs: NoteDocService;
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

  // ── what the hub lists ──

  it('counts action points and attendees per note without multiplying one by the other', async () => {
    const created = await note();
    // Two of each, which is the arrangement that catches the bug: a join-and-group-by over
    // both tables reports four action points here, and looks entirely plausible doing it.
    await meetings.addAttendee(actor, created.id, { name: 'Ada Lovelace' });
    await meetings.addAttendee(actor, created.id, { name: 'Bob' });
    const first = await meetings.addActionItem(actor, created.id, { text: 'Send the dataset' });
    await meetings.addActionItem(actor, created.id, { text: 'Book the migration window' });
    await meetings.dismissActionItem(actor, created.id, first.actionItems[0]!.id);

    const [row] = await meetings.list(actor);

    expect(row!.actionsTotal).toBe(2);
    // Dismissed is decided, so it is no longer open.
    expect(row!.actionsOpen).toBe(1);
    expect(row!.attendeeNames).toEqual(['Ada Lovelace', 'Bob']);
  });

  it('reports a meeting nobody attended as empty rather than as a null', async () => {
    // The list renders an avatar stack straight from this; a null would throw on .length,
    // and a note created outside a room legitimately has neither attendees nor actions.
    await note();
    const [row] = await meetings.list(actor);

    expect(row!.attendeeNames).toEqual([]);
    expect(row!.actionsTotal).toBe(0);
    expect(row!.actionsOpen).toBe(0);
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

  it('carries the owner and due date it was given onto the task', async () => {
    const created = await note();
    const withAction = await meetings.addActionItem(actor, created.id, { text: 'Send it' });
    const itemId = withAction.actionItems[0]!.id;

    await meetings.updateActionItem(actor, created.id, itemId, {
      assigneeId: actor.userId,
      dueOn: '2026-08-14',
    });
    await meetings.acceptActionItem(actor, created.id, itemId);

    // The point of setting them: they were always passed into createTask and never set.
    const [task] = await scrum.listTasks(actor, { projectId });
    expect(task!.dueOn).toBe('2026-08-14');
    expect(task!.assigneeId).toBe(actor.userId);
  });

  it('refuses to reassign an action point that is already a task', async () => {
    const created = await note();
    const withAction = await meetings.addActionItem(actor, created.id, { text: 'Send it' });
    const itemId = withAction.actionItems[0]!.id;
    await meetings.acceptActionItem(actor, created.id, itemId);

    // Silently accepting this would edit a row nothing reads while the task went unchanged.
    await expect(
      meetings.updateActionItem(actor, created.id, itemId, { dueOn: '2026-08-14' }),
    ).rejects.toThrow(/already a task/i);
  });

  it('refuses an assignee who cannot be assigned work', async () => {
    const created = await note();
    const withAction = await meetings.addActionItem(actor, created.id, { text: 'Send it' });
    await expect(
      meetings.updateActionItem(actor, created.id, withAction.actionItems[0]!.id, {
        assigneeId: '019fa41a-0000-7000-8000-000000000000',
      }),
    ).rejects.toThrow(/cannot be assigned/i);
  });

  it('clears an owner and a due date that were set by mistake', async () => {
    const created = await note();
    const withAction = await meetings.addActionItem(actor, created.id, { text: 'Send it' });
    const itemId = withAction.actionItems[0]!.id;

    await meetings.updateActionItem(actor, created.id, itemId, {
      assigneeId: actor.userId,
      dueOn: '2026-08-14',
    });
    const cleared = await meetings.updateActionItem(actor, created.id, itemId, {
      assigneeId: null,
      dueOn: null,
    });

    expect(cleared.actionItems[0]!.assigneeId).toBeNull();
    expect(cleared.actionItems[0]!.dueOn).toBeNull();
  });

  // ── transcripts, which are no longer part of the note ──

  it('keeps a transcript out of the note it belongs to', async () => {
    const created = await note();
    await meetings.saveTranscript(actor, created.id, {
      startedAt: new Date('2026-07-29T14:35:00Z'),
      durationSeconds: 90,
      provider: 'recall',
      lines: [{ id: 'l1', at: 5, text: 'We need supplier drill-down', speaker: 'Anna' }],
      tokens: 100,
      costCents: 3,
    });

    const [saved] = await meetings.listTranscripts(actor, created.id);
    expect(saved!.lines).toHaveLength(1);
    // The point of the whole exercise: the body is what gets indexed and searched.
    expect((await meetings.get(actor, created.id)).body).not.toContain('supplier drill-down');
  });

  it('keeps each recording of the same meeting separate', async () => {
    const created = await note();
    for (const [minute, text] of [['14:35', 'the first meeting'], ['16:10', 'the second']] as const) {
      await meetings.saveTranscript(actor, created.id, {
        startedAt: new Date(`2026-07-29T${minute}:00Z`),
        durationSeconds: 60,
        lines: [{ id: `l-${minute}`, at: 1, text }],
        tokens: 10,
        costCents: 1,
      });
    }

    const all = await meetings.listTranscripts(actor, created.id);
    expect(all).toHaveLength(2);
    // Oldest first, so reading them in order reads the day in order.
    expect(JSON.stringify(all[0]!.lines)).toContain('the first meeting');
  });

  it('does not store an empty transcript', async () => {
    const created = await note();
    const result = await meetings.saveTranscript(actor, created.id, {
      startedAt: new Date(),
      durationSeconds: 0,
      lines: [],
      tokens: 0,
      costCents: 0,
    });

    expect(result).toBeNull();
    expect(await meetings.listTranscripts(actor, created.id)).toHaveLength(0);
  });

  it('adds up what a second recording cost instead of replacing it', async () => {
    const created = await note();
    await meetings.recordTranscription(actor, created.id, {
      tokens: 1000,
      costCents: 4,
      durationSeconds: 60,
    });
    const after = await meetings.recordTranscription(actor, created.id, {
      tokens: 500,
      costCents: 3,
      durationSeconds: 30,
    });

    // These are the note's totals. Overwriting made a twice-recorded meeting look cheap.
    expect(after.transcriptTokens).toBe(1500);
    expect(after.transcriptCostCents).toBe(7);
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


  describe('what the assistant may write into a note', () => {
    /**
     * Asked for coloured text, the assistant reached for `<span style="color:red">`.
     *
     * Notes are parsed with `html: false` — deliberately, since bodies are partly written from
     * meeting transcripts — so the tag was not rendered. It was stored as text, and the note
     * read `Needs <span style="color:red">urgent review</span>.` with nothing to explain why.
     *
     * Markdown has no colour and no underline. Refusing with a message that names the
     * alternative is the only outcome the model can act on; keeping the tags is a note that
     * looks broken, and dropping them silently is worse.
     */
    it('accepts colour in the one shape the note can store', async () => {
      const created = await note();
      await meetings.writeIntoNote(actor, {
        noteId: created.id,
        markdown: 'Needs <span style="color:#d33">urgent review</span>.',
      });
      await docs.flush(created.id);
      expect((await meetings.get(actor, created.id)).body).toContain(
        '<span style="color:#d33">urgent review</span>',
      );
    });

    it('refuses a colour spelling the parser would not read back', async () => {
      // `red` is valid CSS and is still refused — the note stores one closed shape, and
      // anything else would come back as literal angle brackets in the sentence.
      const created = await note();
      await expect(
        meetings.writeIntoNote(actor, {
          noteId: created.id,
          markdown: 'Needs <span style="color:red">urgent review</span>.',
        }),
      ).rejects.toThrow(/only two HTML tags/);
      expect((await meetings.get(actor, created.id)).body).not.toContain('<span');
    });

    it('refuses anything smuggled in beside a valid colour', async () => {
      const created = await note();
      await expect(
        meetings.writeIntoNote(actor, {
          noteId: created.id,
          markdown: '<span style="color:#d33">ok</span> then <img src=x onerror=alert(1)>',
        }),
      ).rejects.toThrow(/only two HTML tags/);
    });

    it('accepts the formatting the note can actually carry', async () => {
      const created = await note();
      await meetings.writeIntoNote(actor, {
        noteId: created.id,
        markdown: '## Risks\n\n- ==Urgent review== of the **retention policy**',
      });

      // The authority writes the body out a second after the last change, so anything
      // reading the table rather than the document has to ask for it first.
      await docs.flush(created.id);
      const after = await meetings.get(actor, created.id);
      expect(after.body).toContain('==Urgent review==');
      expect(after.body).toContain('**retention policy**');
    });

    it('does not mistake a comparison or an arrow for a tag', async () => {
      // `<` is ordinary prose. Only something shaped like a tag is refused.
      const created = await note();
      await meetings.writeIntoNote(actor, {
        noteId: created.id,
        markdown: 'Budget < 5000 and margin > 20% => proceed.',
      });
      await docs.flush(created.id);
      expect((await meetings.get(actor, created.id)).body).toContain('Budget < 5000');
    });
  });
});

/**
 * A ceremony that touches the board.
 *
 * Five ceremony notes existed in the database with a null project — and therefore no board, no
 * timeline and no way to become work — because the button that starts one never sent it.
 */
describe('MeetingsService ceremonies and sprints', () => {
  let crm: CrmService;
  let scrum: ScrumService;
  let meetings: MeetingsService;
  let projectId: string;
  let sprintId: string;

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE meetings.note_chunks, meetings.action_items, meetings.attendees,
                   meetings.agenda_items, meetings.notes, scrum.tasks, scrum.sprints,
                   scrum.boards, crm.projects, crm.contacts, crm.clients CASCADE`);
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
    const docs = new NoteDocService();
    meetings = new MeetingsService(
      testDb, registry, permissions, audit, bus, links,
      new EmbeddingService(), crm, scrum, new UserService(testDb), docs,
    );

    const client = await crm.createClient(actor, { name: 'DocHorse', status: 'active' });
    const project = await crm.createProject(actor, {
      clientId: client.id,
      name: 'Power BI',
      billingModel: 'time_and_materials',
    });
    projectId = project.id;
    await scrum.getBoard(actor, projectId);
    const sprint = await scrum.createSprint(actor, {
      projectId,
      name: 'Sprint 1',
      startsOn: '2026-08-03',
      endsOn: '2026-08-14',
    });
    sprintId = sprint.id;
  });

  it('takes the project from the sprint, so naming one is enough', async () => {
    const note = await meetings.create(actor, {
      title: 'Daily stand-up',
      template: 'daily_standup',
      sprintId,
    });
    expect(note.sprintId).toBe(sprintId);
    expect(note.projectId).toBe(projectId);
  });

  it('puts the ceremony on the sprint it was about', async () => {
    const note = await meetings.create(actor, { title: 'Retro', template: 'retrospective', sprintId });
    const { rows } = await testDb.execute<{ to_id: string }>(sql`
      SELECT to_id FROM core.links WHERE from_id = ${note.id}
    `);
    expect(rows.map((r) => r.to_id)).toContain(sprintId);
  });

  it('lands an accepted action point in the running sprint', async () => {
    // Every one of these used to go to the backlog, so a commitment made out loud during a
    // sprint arrived somewhere nobody was looking.
    await scrum.startSprint(actor, sprintId);
    const note = await meetings.create(actor, { title: 'Stand-up', template: 'daily_standup', sprintId });
    const withItem = await meetings.addActionItem(actor, note.id, { text: 'Chase the credentials' });
    const item = withItem.actionItems.at(-1)!;

    await meetings.acceptActionItem(actor, note.id, item.id);
    const tasks = await scrum.listTasks(actor, { projectId });
    expect(tasks.find((t) => t.title === 'Chase the credentials')?.sprintId).toBe(sprintId);
  });

  it('opens a stand-up already knowing what moved and what is stuck', async () => {
    /*
     * The whole point of the stage.
     *
     * Three stand-ups were held and every body was still the empty headings it was seeded
     * with — not laziness, but because the note was asking for a transcription of what the
     * board already knew.
     */
    await scrum.startSprint(actor, sprintId);
    const shipped = await scrum.createTask(actor, { projectId, title: 'Model the spend dataset' });
    await scrum.moveTask(actor, shipped.id, { status: 'in_progress' });
    const stuck = await scrum.createTask(actor, { projectId, title: 'Supplier page' });
    await scrum.blockTask(actor, stuck.id, { reason: 'waiting on credentials' });

    const note = await meetings.create(actor, {
      title: 'Daily stand-up',
      template: 'daily_standup',
      sprintId,
      attendees: [{ name: 'Test User' }],
    });

    // Yesterday, filled in from the transitions rather than from anybody's memory.
    expect(note.body).toMatch(/### Test User[\s\S]*Model the spend dataset/);
    // Today left blank: the only thing a stand-up is actually for.
    expect(note.body).toContain('- Today: ');
    // The blocker, with its reason, under its own heading.
    expect(note.body).toContain('waiting on credentials');
    expect(note.body).not.toContain('_Nothing is recorded as blocked._');
  });

  it('gives a block to somebody who worked but was not added to the note', async () => {
    // The board knew what they did. Listing only attendees would have dropped it silently.
    await scrum.startSprint(actor, sprintId);
    const t = await scrum.createTask(actor, { projectId, title: 'Overnight fix' });
    await scrum.moveTask(actor, t.id, { status: 'in_progress' });

    const note = await meetings.create(actor, {
      title: 'Stand-up',
      template: 'daily_standup',
      sprintId,
      attendees: [{ name: 'Somebody Else' }],
    });
    expect(note.body).toContain('### Somebody Else');
    expect(note.body).toMatch(/### Test User[\s\S]*Overnight fix/);
  });

  it('falls back to the plain template when there is no board to read', async () => {
    // A stand-up with no project is still a stand-up. An error here would mean the ceremony
    // depended on the digest, and it is the other way round.
    const note = await meetings.create(actor, {
      title: 'Loose stand-up',
      template: 'daily_standup',
      attendees: [{ name: 'Test User' }],
    });
    expect(note.projectId).toBeNull();
    expect(note.body).toContain('### Test User');
    expect(note.body).toContain('## Round the table');
  });

  it('opens a review on what the sprint actually contained', async () => {
    await scrum.startSprint(actor, sprintId);
    const landed = await scrum.createTask(actor, { projectId, title: 'Spend dataset', sprintId });
    await scrum.createTask(actor, { projectId, title: 'Supplier page', sprintId });
    await scrum.moveTask(actor, landed.id, { status: 'done' });

    const note = await meetings.create(actor, {
      title: 'Sprint review',
      template: 'sprint_review',
      sprintId,
    });
    expect(note.body).toMatch(/## Finished\n\n- Spend dataset/);
    expect(note.body).toMatch(/## Not finished\n\n- Supplier page/);
    // Feedback stays blank: it is the part a review is actually for.
    expect(note.body).toMatch(/## Feedback\n/);
  });

  it('opens a retrospective on whether the last one changed anything', async () => {
    /*
     * The habit that makes retrospectives worth holding, and the one thing the platform could
     * not support: retro actions were ordinary backlog cards, so nothing could ask after them.
     */
    await scrum.startSprint(actor, sprintId);
    const first = await meetings.create(actor, {
      title: 'Retro',
      template: 'retrospective',
      sprintId,
    });
    const withItem = await meetings.addActionItem(actor, first.id, {
      text: 'Write estimates down before starting',
    });
    await meetings.acceptActionItem(actor, first.id, withItem.actionItems.at(-1)!.id);

    const next = await meetings.create(actor, {
      title: 'Retro two',
      template: 'retrospective',
      sprintId,
    });
    expect(next.body).toContain('## Last time we said we would');
    expect(next.body).toContain('- [ ] Write estimates down before starting');
  });

  it('ticks a retro action off once it is done', async () => {
    await scrum.startSprint(actor, sprintId);
    const retro = await meetings.create(actor, { title: 'Retro', template: 'retrospective', sprintId });
    const withItem = await meetings.addActionItem(actor, retro.id, { text: 'Cap WIP at two' });
    const accepted = await meetings.acceptActionItem(actor, retro.id, withItem.actionItems.at(-1)!.id);
    const taskId = accepted.actionItems.at(-1)!.taskId!;
    await scrum.moveTask(actor, taskId, { status: 'done' });

    const next = await meetings.create(actor, { title: 'Retro two', template: 'retrospective', sprintId });
    expect(next.body).toContain('- [x] Cap WIP at two');
  });

  it('sends it to the backlog instead when that sprint has already closed', async () => {
    // A completed sprint's summary is frozen. Attaching a card afterwards would leave the
    // record and the board disagreeing about what was in it.
    await scrum.startSprint(actor, sprintId);
    const note = await meetings.create(actor, { title: 'Retro', template: 'retrospective', sprintId });
    await scrum.completeSprint(actor, sprintId);

    const withItem = await meetings.addActionItem(actor, note.id, { text: 'Write the runbook' });
    const item = withItem.actionItems.at(-1)!;
    await meetings.acceptActionItem(actor, note.id, item.id);

    const tasks = await scrum.listTasks(actor, { projectId });
    expect(tasks.find((t) => t.title === 'Write the runbook')?.sprintId).toBeNull();
  });
});
