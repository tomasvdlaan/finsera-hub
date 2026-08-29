import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { DB, type Database } from '../../core/db/db.module.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { UserService } from '../../core/auth/user.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { EmbeddingService } from '../../core/llm/embedding.service.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { chunkText } from '../../core/text/chunk.js';
import { CrmService } from '../crm/crm.service.js';
import { RETRO_LABEL, ScrumService } from '../scrum/scrum.service.js';
import { headingsOf, markdownToDoc } from '@platform/note-doc';
import { appendMarkdown, replaceSectionMarkdown } from './doc/note-edit.js';
import { NoteDocService } from './doc/note-doc.service.js';
import {
  TEMPLATES,
  bodyFor,
  retroBody,
  reviewBody,
  standupBody,
  type Template,
  type TemplateName,
} from './templates.js';
import {
  actionItems,
  agendaItems,
  attendees,
  noteChunks,
  notes,
  transcripts,
} from './meetings.schema.js';

/**
 * The only HTML a note body renders — see @platform/note-doc's parser, which is the authority.
 *
 * Kept in step with it by the round-trip tests there and the write tests here: a shape this
 * allows but the parser refuses would be stored as visible angle brackets.
 */
const COLOUR_TAGS =
  /<span style="color:#[0-9a-f]{3}(?:[0-9a-f]{3})?">|<mark style="background-color:#[0-9a-f]{3}(?:[0-9a-f]{3})?">|<\/span>|<\/mark>/gi;

export interface CreateNoteInput {
  title: string;
  clientId?: string | null;
  projectId?: string | null;
  /** The sprint this ceremony is about. Fills projectId in when one is not given. */
  sprintId?: string | null;
  meetingDate?: string;
  template?: TemplateName;
  body?: string;
  agenda?: string[];
  attendees?: Array<{ name: string; email?: string; contactId?: string }>;
}

/**
 * Meeting Notes (Phase 6b).
 *
 * The body is Markdown and the structure around it — agenda, attendees, action points —
 * is real rows, because Phase 6c needs to reason about them individually.
 *
 * Action points never become tasks on their own. They are proposed, and accepting one is
 * a decision you make; the same rule applies whether you typed it or a model suggested it.
 */
@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly registry: RegistryService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly links: LinkService,
    private readonly embeddings: EmbeddingService,
    private readonly crm: CrmService,
    private readonly scrum: ScrumService,
    private readonly users: UserService,
    private readonly docs: NoteDocService,
  ) {}

  // ── notes ──────────────────────────────────────────────────

  /**
   * The body a note opens with.
   *
   * Seeded once, at creation, and never afterwards: past this point the note-doc authority
   * owns the body, and a later write would fight whatever is being typed into it.
   *
   * Degrades to exactly what the template said on its own — a stand-up with no project has no
   * board to read, and an empty round-the-table is a worse outcome than an error only if you
   * think the ceremony is about the note.
   */
  private async seedBody(
    actor: Actor,
    template: Template,
    attendees: Array<{ name: string }>,
    projectId: string | null,
    sprintId: string | null,
  ): Promise<string> {
    if (!projectId) return bodyFor(template, attendees);
    try {
      if (template === TEMPLATES.sprint_review && sprintId) {
        return reviewBody(template, await this.scrum.sprintCards(actor, sprintId));
      }
      if (template === TEMPLATES.retrospective) {
        return retroBody(template, { actions: await this.scrum.retroActions(actor, projectId) });
      }
      if (template !== TEMPLATES.daily_standup) return bodyFor(template, attendees);

      // Since the last stand-up on this project, falling back to yesterday when it is the
      // first — "what happened since we last spoke" is the question, not "what happened today".
      const [previous] = await this.db
        .select({ createdAt: notes.createdAt })
        .from(notes)
        .where(and(eq(notes.projectId, projectId), eq(notes.template, 'daily_standup')))
        .orderBy(desc(notes.createdAt))
        .limit(1);
      const since = previous?.createdAt ?? new Date(Date.now() - 86_400_000);
      const digest = await this.scrum.standupDigest(actor, projectId, since, sprintId);
      return standupBody(template, attendees, digest);
    } catch {
      // The note matters more than the digest. A board that cannot be read gives you the
      // headings you would have had anyway rather than a failed ceremony.
      return bodyFor(template, attendees);
    }
  }

  async create(actor: Actor, input: CreateNoteInput, origin: { aiInitiated?: boolean } = {}) {
    await this.require(actor, 'meetings.write');
    if (!input.title?.trim()) throw new BadRequestException('A note needs a title');

    const template = input.template ? TEMPLATES[input.template] : undefined;
    if (input.template && !template) {
      throw new BadRequestException(`Unknown template '${input.template}'`);
    }
    if (input.clientId) await this.crm.getClient(actor, input.clientId);

    /*
     * A sprint implies its project, so saying which sprint is enough.
     *
     * Every ceremony note in the database had a null project, because the button that starts
     * one never sent it — and a note with no project cannot become a task, cannot reach a
     * timeline and cannot find a board. Deriving the project from the sprint means the one
     * field anybody would actually pick carries the rest.
     */
    const sprint = input.sprintId ? await this.scrum.getSprint(actor, input.sprintId) : null;
    const projectId = input.projectId ?? sprint?.projectId ?? null;
    if (projectId && !sprint) await this.crm.getProject(actor, projectId);

    const meetingDate = input.meetingDate ?? new Date().toISOString().slice(0, 10);
    // A stand-up gets a block per person, which needs the attendees the note is created with.
    const body =
      input.body ??
      (template
        ? await this.seedBody(actor, template, input.attendees ?? [], projectId, sprint?.id ?? null)
        : '');
    const agenda = input.agenda ?? template?.agenda ?? [];

    const id = this.registry.newId();
    await this.db.transaction(async (tx) => {
      await this.registry.register(tx, {
        id,
        entityType: 'meeting_note',
        displayName: input.title.trim(),
        urlPath: `/meetings/${id}`,
      });

      await tx.insert(notes).values({
        id,
        title: input.title.trim(),
        clientId: input.clientId ?? null,
        projectId,
        sprintId: sprint?.id ?? null,
        meetingDate,
        body,
        template: input.template ?? null,
        createdBy: actor.userId,
      });

      if (agenda.length > 0) {
        await tx.insert(agendaItems).values(
          agenda.map((title, i) => ({
            id: this.registry.newId(),
            noteId: id,
            position: i + 1,
            title,
          })),
        );
      }

      if (input.attendees?.length) {
        await tx.insert(attendees).values(
          input.attendees.map((a) => ({
            id: this.registry.newId(),
            noteId: id,
            name: a.name,
            email: a.email ?? null,
            contactId: a.contactId ?? null,
          })),
        );
      }

      // Contextual links, so the note surfaces on the client's and project's timeline.
      if (input.clientId) {
        await this.links.createWithin(tx, actor, {
          fromId: id,
          toId: input.clientId,
          kind: 'met_with',
        });
      }
      if (projectId) {
        await this.links.createWithin(tx, actor, {
          fromId: id,
          toId: projectId,
          kind: 'about',
        });
      }
      if (sprint) {
        await this.links.createWithin(tx, actor, {
          fromId: id,
          toId: sprint.id,
          kind: 'about',
        });
      }

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'meeting_note.create',
        entityType: 'meeting_note',
        entityId: id,
        detail: { clientId: input.clientId ?? null, template: input.template ?? null },
        aiInitiated: origin.aiInitiated ?? false,
      });

      await this.events.publish(tx, {
        name: 'meeting_note.created',
        entityType: 'meeting_note',
        entityId: id,
        actorId: actor.userId,
        payload: { title: input.title.trim(), clientId: input.clientId ?? null, meetingDate },
      });
    });

    await this.index(id).catch(() => undefined);
    return this.get(actor, id);
  }

  /**
   * Change a note.
   *
   * `fromDocument` is set only by the document authority flushing its own copy. It is the
   * difference between "this text is already what everyone is looking at, write it down" and
   * "replace the body with this" — and without it the two fight. A body written straight to
   * the table while somebody has the note open is overwritten a second later by the
   * authority's next flush, silently, which is precisely the class of bug the authority
   * exists to end. So an ordinary body update is pushed into the open document instead, and
   * reaches every editor as a change like any other.
   */
  /**
   * Attach a note to a sprint after the fact.
   *
   * Its own method rather than a field on the patch, because it does more than set a column:
   * the note picks up the sprint's project if it had none, and gets a link so it appears on
   * the sprint's timeline. A planning note uses this the moment it creates the sprint it was
   * about — which is the point at which the ceremony stops being a document.
   */
  async linkToSprint(actor: Actor, noteId: string, sprintId: string) {
    await this.require(actor, 'meetings.write');
    const note = await this.raw(noteId);
    const sprint = await this.scrum.getSprint(actor, sprintId);

    await this.db.transaction(async (tx) => {
      await tx
        .update(notes)
        .set({
          sprintId: sprint.id,
          projectId: note.projectId ?? sprint.projectId,
          updatedAt: new Date(),
        })
        .where(eq(notes.id, noteId));

      await this.links.createWithin(tx, actor, { fromId: noteId, toId: sprint.id, kind: 'about' });
      if (!note.projectId) {
        await this.links.createWithin(tx, actor, {
          fromId: noteId,
          toId: sprint.projectId,
          kind: 'about',
        });
      }
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'meeting_note.link_sprint',
        entityType: 'meeting_note',
        entityId: noteId,
        detail: { sprintId: sprint.id },
      });
    });

    return this.get(actor, noteId);
  }

  async update(
    actor: Actor,
    id: string,
    patch: Partial<CreateNoteInput> & { status?: string },
    origin: { fromDocument?: boolean } = {},
  ) {
    await this.require(actor, 'meetings.write');
    const before = await this.raw(id);

    await this.db.transaction(async (tx) => {
      await tx
        .update(notes)
        .set({
          title: patch.title?.trim() ?? before.title,
          body: patch.body === undefined ? before.body : patch.body,
          clientId: patch.clientId === undefined ? before.clientId : patch.clientId,
          projectId: patch.projectId === undefined ? before.projectId : patch.projectId,
          meetingDate: patch.meetingDate ?? before.meetingDate,
          updatedAt: new Date(),
        })
        .where(eq(notes.id, id));

      if (patch.title && patch.title.trim() !== before.title) {
        await this.registry.updateDisplay(tx, id, { displayName: patch.title.trim() });
      }
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'meeting_note.update',
        entityType: 'meeting_note',
        entityId: id,
      });
    });

    if (patch.body !== undefined && patch.body !== before.body) {
      // Re-index only when the text actually changed; embedding is the expensive part.
      await this.index(id).catch(() => undefined);
      if (!origin.fromDocument) await this.docs.replace(id, actor, patch.body);
    }
    return this.get(actor, id);
  }

  /**
   * Finalise: the note is done.
   *
   * Deliberately NOT immutable, unlike an invoice or a signed contract. A meeting note is
   * a record of what someone understood, and understanding gets corrected — freezing it
   * would mean the correction lives somewhere worse. Finalising is a signal, not a lock.
   */
  async finalise(actor: Actor, id: string) {
    await this.require(actor, 'meetings.write');
    const note = await this.raw(id);
    if (note.finalisedAt) return this.get(actor, id);

    await this.db.transaction(async (tx) => {
      await tx
        .update(notes)
        .set({ status: 'final', finalisedAt: new Date(), updatedAt: new Date() })
        .where(eq(notes.id, id));
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'meeting_note.finalise',
        entityType: 'meeting_note',
        entityId: id,
      });
      await this.events.publish(tx, {
        name: 'meeting_note.finalised',
        entityType: 'meeting_note',
        entityId: id,
        actorId: actor.userId,
        payload: { title: note.title, clientId: note.clientId },
      });
    });
    return this.get(actor, id);
  }

  async remove(actor: Actor, id: string) {
    await this.require(actor, 'meetings.write');
    await this.raw(id);
    await this.db.transaction(async (tx) => {
      await tx.delete(notes).where(eq(notes.id, id));
      await this.registry.softDelete(tx, id);
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'meeting_note.delete',
        entityType: 'meeting_note',
        entityId: id,
      });
    });
  }

  async list(actor: Actor, filter: { clientId?: string; projectId?: string } = {}) {
    await this.require(actor, 'meetings.read');
    const where = [
      filter.clientId ? eq(notes.clientId, filter.clientId) : undefined,
      filter.projectId ? eq(notes.projectId, filter.projectId) : undefined,
    ].filter(Boolean);

    const rows = await this.db
      .select()
      .from(notes)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(notes.meetingDate), desc(notes.createdAt));

    if (rows.length === 0) return [];

    /*
     * What each meeting produced and who was in it — two grouped queries, merged here.
     *
     * Not one query with two joins: grouping a note by both tables multiplies one against
     * the other, so a meeting with four attendees reports four times its action points, and
     * does it plausibly enough that nobody checks. Not a request per row from the browser
     * either, on a page whose whole purpose is showing many meetings at once.
     *
     * Two round trips, fixed, however long the list is.
     */
    const ids = rows.map((n) => n.id);

    const counted = await this.db
      .select({
        noteId: actionItems.noteId,
        total: sql<number>`count(*)::int`,
        open: sql<number>`count(*) FILTER (WHERE ${actionItems.status} = 'proposed')::int`,
      })
      .from(actionItems)
      .where(inArray(actionItems.noteId, ids))
      .groupBy(actionItems.noteId);

    const present = await this.db
      .select({ noteId: attendees.noteId, name: attendees.name })
      .from(attendees)
      .where(inArray(attendees.noteId, ids))
      // Ordered so the same meeting draws the same avatars in the same order every load.
      .orderBy(asc(attendees.name), asc(attendees.id));

    const byNote = new Map(counted.map((c) => [c.noteId, c]));
    const faces = new Map<string, string[]>();
    for (const p of present) {
      const list = faces.get(p.noteId);
      if (list) list.push(p.name);
      else faces.set(p.noteId, [p.name]);
    }

    return rows.map((n) => ({
      ...n,
      /** Everything the meeting produced, decided or not. */
      actionsTotal: byNote.get(n.id)?.total ?? 0,
      /** Still waiting on a decision — the count the hub leads with. */
      actionsOpen: byNote.get(n.id)?.open ?? 0,
      // Names, not a count, because the row shows faces and a count cannot be a face.
      attendeeNames: faces.get(n.id) ?? [],
    }));
  }


  /**
   * Every action point still waiting for a decision, across every meeting.
   *
   * The thing a meetings page should open with and could not answer. A commitment made out
   * loud and never accepted or dismissed is the most expensive kind of nothing in this
   * platform: it is recorded, so it feels handled, and it is not on any board, so no screen
   * has ever counted it. `action_item_undecided` notices the same rows and turns them into an
   * insight after three days; this is the list itself, from the moment it exists.
   *
   * Oldest meeting first — the ones that have been waiting longest are the ones to answer.
   */
  async openActions(actor: Actor) {
    await this.require(actor, 'meetings.read');
    const rows = await this.db
      .select({
        id: actionItems.id,
        text: actionItems.text,
        source: actionItems.source,
        assigneeId: actionItems.assigneeId,
        dueOn: actionItems.dueOn,
        noteId: notes.id,
        noteTitle: notes.title,
        meetingDate: notes.meetingDate,
        clientId: notes.clientId,
        projectId: notes.projectId,
      })
      .from(actionItems)
      .innerJoin(notes, eq(actionItems.noteId, notes.id))
      .where(eq(actionItems.status, 'proposed'))
      .orderBy(asc(notes.meetingDate), asc(actionItems.createdAt));
    return rows;
  }

  async get(actor: Actor, id: string) {
    await this.require(actor, 'meetings.read');
    const note = await this.raw(id);
    const [agenda, people, actions] = await Promise.all([
      this.db.select().from(agendaItems).where(eq(agendaItems.noteId, id)).orderBy(asc(agendaItems.position)),
      this.db.select().from(attendees).where(eq(attendees.noteId, id)).orderBy(asc(attendees.name)),
      this.db.select().from(actionItems).where(eq(actionItems.noteId, id)).orderBy(asc(actionItems.createdAt)),
    ]);
    return {
      ...note,
      agenda,
      attendees: people,
      actionItems: actions,
      /** 6c refuses to record unless this is true — surfaced here so the UI can say why. */
      everyoneConsented: people.length > 0 && people.every((p) => p.consent === 'granted'),
      /**
       * People the bot saw in the call who were never asked.
       *
       * The consent gate runs before the bot joins, so it cannot cover somebody who
       * arrives afterwards. Rather than pretend otherwise, that gap is named.
       */
      unconsentedPresent: people.filter((p) => p.detectedAt && p.consent !== 'granted'),
    };
  }

  // ── agenda ─────────────────────────────────────────────────

  async addAgendaItem(actor: Actor, noteId: string, title: string) {
    await this.require(actor, 'meetings.write');
    await this.raw(noteId);
    const [row] = await this.db
      .select({ max: sql<number>`COALESCE(MAX(${agendaItems.position}), 0)` })
      .from(agendaItems)
      .where(eq(agendaItems.noteId, noteId));

    await this.db.insert(agendaItems).values({
      id: this.registry.newId(),
      noteId,
      position: Number(row?.max ?? 0) + 1,
      title,
    });
    return this.get(actor, noteId);
  }

  async setAgendaCovered(actor: Actor, noteId: string, itemId: string, covered: boolean) {
    await this.require(actor, 'meetings.write');
    await this.db
      .update(agendaItems)
      .set({ covered, coveredAt: covered ? new Date() : null })
      .where(and(eq(agendaItems.id, itemId), eq(agendaItems.noteId, noteId)));
    return this.get(actor, noteId);
  }

  async removeAgendaItem(actor: Actor, noteId: string, itemId: string) {
    await this.require(actor, 'meetings.write');
    await this.db
      .delete(agendaItems)
      .where(and(eq(agendaItems.id, itemId), eq(agendaItems.noteId, noteId)));
    return this.get(actor, noteId);
  }

  // ── attendees and consent ──────────────────────────────────

  async addAttendee(
    actor: Actor,
    noteId: string,
    person: { name: string; email?: string; contactId?: string },
  ) {
    await this.require(actor, 'meetings.write');
    await this.raw(noteId);
    await this.db.insert(attendees).values({
      id: this.registry.newId(),
      noteId,
      name: person.name,
      email: person.email ?? null,
      contactId: person.contactId ?? null,
    });
    return this.get(actor, noteId);
  }

  /**
   * Record that someone was actually in the meeting.
   *
   * Called as people join, from the roster the bot sees. Matches an existing attendee by
   * name so the person you typed beforehand and the person who turned up are one row
   * rather than two — and where they do not match, a new row appears with no consent,
   * which is precisely the thing worth noticing.
   *
   * Never sets consent. Being present is not agreeing.
   */
  async recordAttendance(
    actor: Actor,
    noteId: string,
    person: { name: string; email?: string | null },
  ) {
    await this.require(actor, 'meetings.write');
    const name = person.name.trim();
    if (!name) return this.get(actor, noteId);

    const existing = await this.db
      .select()
      .from(attendees)
      .where(eq(attendees.noteId, noteId));

    const match = existing.find(
      (a) =>
        a.name.trim().toLowerCase() === name.toLowerCase() ||
        (person.email && a.email && a.email.toLowerCase() === person.email.toLowerCase()),
    );

    if (match) {
      if (match.detectedAt) return this.get(actor, noteId); // already seen
      await this.db
        .update(attendees)
        .set({ detectedAt: new Date(), email: match.email ?? person.email ?? null })
        .where(eq(attendees.id, match.id));
      return this.get(actor, noteId);
    }

    await this.db.transaction(async (tx) => {
      await tx.insert(attendees).values({
        id: this.registry.newId(),
        noteId,
        name,
        email: person.email ?? null,
        detectedAt: new Date(),
      });
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'meeting_attendee.detected',
        entityType: 'meeting_note',
        entityId: noteId,
        detail: { name },
      });
    });

    this.logger.log(`Detected an unlisted attendee on ${noteId}: ${name}`);
    return this.get(actor, noteId);
  }

  /**
   * Record what an attendee said about being recorded.
   *
   * Audited, because consent is the kind of claim that has to be defensible later — "they
   * agreed" is worth nothing without a record of when it was captured and by whom.
   */
  async setConsent(actor: Actor, noteId: string, attendeeId: string, consent: 'granted' | 'declined') {
    await this.require(actor, 'meetings.write');
    await this.db.transaction(async (tx) => {
      await tx
        .update(attendees)
        .set({ consent, consentAt: new Date() })
        .where(and(eq(attendees.id, attendeeId), eq(attendees.noteId, noteId)));
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'meeting_attendee.consent',
        entityType: 'meeting_note',
        entityId: noteId,
        detail: { attendeeId, consent },
      });
    });
    return this.get(actor, noteId);
  }

  async removeAttendee(actor: Actor, noteId: string, attendeeId: string) {
    await this.require(actor, 'meetings.write');
    await this.db
      .delete(attendees)
      .where(and(eq(attendees.id, attendeeId), eq(attendees.noteId, noteId)));
    return this.get(actor, noteId);
  }

  // ── action points ──────────────────────────────────────────

  async addActionItem(
    actor: Actor,
    noteId: string,
    item: { text: string; assigneeId?: string; dueOn?: string; source?: 'typed' | 'ai' },
  ) {
    await this.require(actor, 'meetings.write');
    await this.raw(noteId);
    if (!item.text?.trim()) throw new BadRequestException('An action point needs text');

    const id = this.registry.newId();
    await this.db.insert(actionItems).values({
      id,
      noteId,
      text: item.text.trim(),
      assigneeId: item.assigneeId ?? null,
      dueOn: item.dueOn ?? null,
      source: item.source ?? 'typed',
    });
    return this.get(actor, noteId);
  }

  /**
   * Accept an action point: it becomes a real task on the board.
   *
   * The one place this module writes into another. Done through ScrumService, so SCRUM's
   * own rules apply — and only on an explicit decision, never automatically.
   */
  async acceptActionItem(actor: Actor, noteId: string, itemId: string) {
    await this.require(actor, 'meetings.write');
    const note = await this.raw(noteId);
    const [item] = await this.db
      .select()
      .from(actionItems)
      .where(and(eq(actionItems.id, itemId), eq(actionItems.noteId, noteId)))
      .limit(1);
    if (!item) throw new NotFoundException('Action point not found');
    if (item.status === 'accepted') return this.get(actor, noteId);
    /*
     * A meeting with no project still produces work.
     *
     * This used to refuse, on the reasoning that a task belongs to a project — which is true
     * of the schema and false of the meeting. A stand-up raises "renew the certificate" and
     * the answer was to go and link a project that does not exist, or lose the commitment.
     * So a note with no project sends its tasks to the internal project, made on first use.
     *
     * It is not a silent reassignment: the note keeps no project, and the card says which
     * board it landed on.
     */
    const projectId = note.projectId ?? (await this.crm.internalProject(actor)).id;

    /*
     * Work raised inside a sprint belongs to that sprint.
     *
     * Every action point ever accepted landed in the backlog, because no sprint was passed —
     * so a commitment made out loud during a sprint arrived somewhere nobody was looking at.
     *
     * Not when the sprint has closed, though: a completed sprint's summary is frozen at the
     * moment it closed, and attaching a card afterwards would leave the record disagreeing
     * with the board about what was in it. Those go to the backlog, which is the truth.
     */
    const sprint = note.sprintId ? await this.scrum.getSprint(actor, note.sprintId) : null;
    const sprintId = sprint && sprint.state !== 'completed' ? sprint.id : undefined;

    /*
     * A retrospective produces commitments, not features.
     *
     * Marked so the next retrospective can open by asking whether they happened — which is the
     * only mechanism in SCRUM that changes how a team works, and which was impossible while a
     * retro action was indistinguishable from any other card. A chore because that is what it
     * is: work that improves how the work is done.
     */
    const fromRetro = note.template === 'retrospective';

    const task = await this.scrum.createTask(actor, {
      projectId,
      title: item.text,
      description: `From the meeting note "${note.title}" (${note.meetingDate}).`,
      assigneeId: item.assigneeId ?? undefined,
      dueOn: item.dueOn ?? undefined,
      sprintId,
      type: fromRetro ? 'chore' : undefined,
      labels: fromRetro ? [RETRO_LABEL] : undefined,
    });

    await this.db.transaction(async (tx) => {
      await tx
        .update(actionItems)
        .set({ status: 'accepted', taskId: task.id })
        .where(eq(actionItems.id, itemId));
      await this.links.createWithin(tx, actor, {
        fromId: noteId,
        toId: task.id,
        kind: 'produced_task',
      });
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'action_item.accept',
        entityType: 'meeting_note',
        entityId: noteId,
        detail: { itemId, taskId: task.id, source: item.source },
      });
    });

    return this.get(actor, noteId);
  }

  /**
   * Set who owns an action point and when it is due, before it becomes a task.
   *
   * Both columns have existed since the module was written, and `acceptActionItem` has
   * always passed them into `createTask` — but nothing could ever write them, so every
   * task made from a meeting arrived unowned and undated. This is the missing half.
   *
   * Refused once accepted. At that point the task is the record and editing the action
   * point would change nothing that anyone reads, which is worse than refusing: it would
   * look like it worked.
   */
  async updateActionItem(
    actor: Actor,
    noteId: string,
    itemId: string,
    patch: { assigneeId?: string | null; dueOn?: string | null },
  ) {
    await this.require(actor, 'meetings.write');
    await this.raw(noteId);

    const [item] = await this.db
      .select()
      .from(actionItems)
      .where(and(eq(actionItems.id, itemId), eq(actionItems.noteId, noteId)))
      .limit(1);
    if (!item) throw new NotFoundException('Action point not found');
    if (item.status === 'accepted') {
      throw new BadRequestException(
        'This action point is already a task — change the assignee and due date there',
      );
    }

    // A named assignee has to exist and still be here, or accepting the point later fails
    // at task creation with an error about a user rather than about this.
    if (patch.assigneeId) {
      const assignable = await this.users.listAssignable();
      if (!assignable.some((u) => u.id === patch.assigneeId)) {
        throw new BadRequestException('That person cannot be assigned work');
      }
    }

    await this.db
      .update(actionItems)
      .set({
        assigneeId: patch.assigneeId === undefined ? item.assigneeId : patch.assigneeId,
        dueOn: patch.dueOn === undefined ? item.dueOn : patch.dueOn,
      })
      .where(eq(actionItems.id, itemId));

    return this.get(actor, noteId);
  }

  async dismissActionItem(actor: Actor, noteId: string, itemId: string) {
    await this.require(actor, 'meetings.write');
    await this.db
      .update(actionItems)
      .set({ status: 'dismissed' })
      .where(and(eq(actionItems.id, itemId), eq(actionItems.noteId, noteId)));
    return this.get(actor, noteId);
  }

  /**
   * Record what a live session cost, once it has ended.
   *
   * Only the cost and the fact it happened — the audio itself was never written
   * anywhere, and the transcript arrives through the ordinary body update.
   */
  async recordTranscription(
    actor: Actor,
    id: string,
    result: { tokens: number; costCents: number; durationSeconds: number },
  ) {
    await this.require(actor, 'meetings.write');
    const before = await this.raw(id);
    await this.db.transaction(async (tx) => {
      await tx
        .update(notes)
        .set({
          transcribedAt: new Date(),
          // Added to, not replaced. These are the note's totals, and a second recording
          // used to overwrite the first — so a meeting recorded twice reported only what
          // the last attempt cost, which read as the whole meeting being cheap.
          transcriptTokens: (before.transcriptTokens ?? 0) + result.tokens,
          transcriptCostCents: (before.transcriptCostCents ?? 0) + result.costCents,
          updatedAt: new Date(),
        })
        .where(eq(notes.id, id));
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'meeting_note.transcribed',
        entityType: 'meeting_note',
        entityId: id,
        detail: result,
        aiInitiated: true,
      });
    });
    return this.get(actor, id);
  }

  /**
   * When the meeting actually ran, as opposed to the day it was filed under.
   *
   * `meetingDate` is a date somebody typed; these two are wall-clock times taken from the
   * recording. The columns and their CHECK constraint have existed since the module was
   * written and nothing wrote them, so no screen could say whether a note filed under
   * Tuesday was a nine o'clock stand-up or an evening that overran.
   *
   * The start is stamped once and the end every time: a note recorded twice spans from the
   * first recording to the last, which is the honest reading of "when was this meeting".
   */
  async stampSession(actor: Actor, noteId: string, at: { startedAt?: Date; endedAt?: Date }) {
    await this.require(actor, 'meetings.write');
    const before = await this.raw(noteId);
    await this.db
      .update(notes)
      .set({
        startedAt: before.startedAt ?? at.startedAt ?? null,
        endedAt: at.endedAt ?? before.endedAt ?? null,
        updatedAt: new Date(),
      })
      .where(eq(notes.id, noteId));
  }

  /**
   * How the agent should behave in this meeting, and remembering it.
   *
   * Read without `meetings.write`, because looking at a note tells you this whether you may
   * change it or not, and a panel that cannot render its own controls for a reader is worse
   * than one that renders them disabled.
   */
  async agentSettings(actor: Actor, noteId: string): Promise<unknown> {
    await this.require(actor, 'meetings.read');
    const note = await this.raw(noteId);
    return note.agentSettings ?? null;
  }

  /**
   * Store it, whole.
   *
   * Replaced rather than merged: the caller holds the complete settings object — it read them
   * at the start of the session — and a partial write here would need a merge policy that the
   * runner already has and would then have twice.
   */
  async saveAgentSettings(actor: Actor, noteId: string, settings: unknown): Promise<void> {
    await this.require(actor, 'meetings.write');
    await this.raw(noteId);
    await this.db
      .update(notes)
      .set({ agentSettings: settings, updatedAt: new Date() })
      .where(eq(notes.id, noteId));
  }

  /**
   * Write something into a note, on request.
   *
   * The assistant could read notes and propose action points and could not add a sentence to
   * one — so asking it to take a note got a polite refusal, which was true and useless. The
   * body being Markdown is justified by a model being able to work with it; this is the part
   * that lets it.
   *
   * Two shapes, and the difference is how much can go wrong. Appending cannot destroy
   * anything. Replacing a section rewrites exactly that section and cannot reach a word
   * outside it. There is no "rewrite the note" — a note body has no history, so an overwrite
   * is unrecoverable and would be silent.
   */
  async writeIntoNote(
    actor: Actor,
    input: { noteId: string; markdown: string; section?: string | null },
    origin: { aiInitiated?: boolean } = {},
  ) {
    await this.require(actor, 'meetings.write');
    // Confirms the note exists before anything is written, and gives a 404 rather than an
    // authority holding a document for a note id nobody has.
    await this.raw(input.noteId);

    const markdown = (input.markdown ?? '').trim();
    if (!markdown) throw new BadRequestException('There is nothing to write');

    /*
     * Refuse the HTML the note cannot render, and only that.
     *
     * The parser accepts exactly two tags, both carrying a hex colour, because Markdown has
     * no colour of its own — see @platform/note-doc. Everything else arrives as literal angle
     * brackets in the middle of a sentence, which is what happened the first time somebody
     * asked the assistant for coloured text: it reached for `<span style="color:red">`, and
     * the note ended up reading `Needs <span style="color:red">urgent review</span>.`
     *
     * Telling the model is better than silently keeping it. It gets one clear error naming
     * the shape that works, which it can act on; the alternative is a note that looks broken
     * with no indication anywhere of why.
     */
    const rejected = markdown.replace(COLOUR_TAGS, '');
    if (/<\/?[a-z][^>]*>/i.test(rejected)) {
      throw new BadRequestException(
        'Notes are Markdown and only two HTML tags are rendered: ' +
          '<span style="color:#rrggbb"> and <mark style="background-color:#rrggbb">. ' +
          'Anything else would appear as literal angle brackets. Markdown has no underline.',
      );
    }

    /*
     * Through the document authority, not by rewriting the body.
     *
     * This is the change that makes the assistant safe to use during a meeting. It used to
     * read the whole body, run a regular expression over it and write the whole thing back —
     * so anyone typing in the same second lost what they had written, silently. Now it
     * produces a change bounded to the end of the note or to one section, which merges with
     * live typing instead of overwriting it.
     */
    const { markdown: body } = await this.docs.edit(input.noteId, actor, (tr) => {
      if (input.section) replaceSectionMarkdown(tr, input.section, markdown);
      else appendMarkdown(tr, markdown);
    });

    await this.db.transaction(async (tx) => {
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'meeting_note.written',
        entityType: 'meeting_note',
        entityId: input.noteId,
        // Audited with the text, because this is the platform writing prose into a record a
        // person will later read as their own.
        detail: { section: input.section ?? null, markdown },
        aiInitiated: origin.aiInitiated ?? false,
      });
    });

    return {
      noteId: input.noteId,
      section: input.section ?? null,
      headings: headingsOf(markdownToDoc(body)),
    };
  }

  /**
   * What the assistant needs to write into the right place: the note's own shape.
   *
   * Read through the authority rather than from the table, so it reflects what is on screen
   * this second rather than what was last flushed. Asking the assistant to write under a
   * heading somebody added ten keystrokes ago should not fail because the body has not been
   * saved yet.
   */
  async noteOutline(actor: Actor, noteId: string) {
    await this.require(actor, 'meetings.read');
    const note = await this.raw(noteId);
    const body = await this.docs.markdown(noteId);
    return { noteId, title: note.title, headings: headingsOf(markdownToDoc(body)), body };
  }

  // ── transcripts ────────────────────────────────────────────

  /**
   * Save what was said, as its own record.
   *
   * It used to be appended to `notes.body`, which is the text that gets chunked, embedded
   * and searched. A transcript is thousands of words of speech and it drowned out the note
   * it was attached to: asking the assistant what was decided returned the moment somebody
   * nearly decided it. Here it is stored, readable, and out of the index.
   */
  async saveTranscript(
    actor: Actor,
    noteId: string,
    session: {
      startedAt: Date;
      durationSeconds: number;
      provider?: string;
      lines: unknown[];
      tokens: number;
      costCents: number;
    },
  ) {
    await this.require(actor, 'meetings.write');
    await this.raw(noteId);
    if (session.lines.length === 0) return null;

    const id = this.registry.newId();
    await this.db.insert(transcripts).values({
      id,
      noteId,
      startedAt: session.startedAt,
      durationSeconds: session.durationSeconds,
      provider: session.provider ?? 'browser',
      lines: session.lines,
      tokens: session.tokens,
      costCents: session.costCents,
    });
    return { id };
  }

  /**
   * Every recording of a note, oldest first.
   *
   * Its own endpoint rather than part of the note, because a note payload is fetched on
   * every render and a transcript is the largest thing the module stores. You ask for it
   * when you want to read it.
   */
  async listTranscripts(actor: Actor, noteId: string) {
    await this.require(actor, 'meetings.read');
    await this.raw(noteId);
    return this.db
      .select()
      .from(transcripts)
      .where(eq(transcripts.noteId, noteId))
      .orderBy(asc(transcripts.startedAt));
  }

  // ── search ─────────────────────────────────────────────────

  /** Re-embed a note on request. Permission-checked; index() itself is internal. */
  async reindex(actor: Actor, noteId: string): Promise<number> {
    await this.require(actor, 'meetings.write');
    return this.index(noteId);
  }

  /** Chunk and embed a note's body. Replaces whatever was indexed before. */
  async index(noteId: string): Promise<number> {
    const note = await this.raw(noteId);
    const pieces = chunkText(`${note.title}\n\n${note.body}`);
    await this.db.delete(noteChunks).where(eq(noteChunks.noteId, noteId));
    if (pieces.length === 0) return 0;

    const vectors = EmbeddingService.isConfigured()
      ? await this.embeddings.embedBatch(pieces.map((p) => p.content), { module: 'meetings', feature: 'index' })
      : [];

    await this.db.insert(noteChunks).values(
      pieces.map((piece, i) => ({
        id: this.registry.newId(),
        noteId,
        ordinal: piece.ordinal,
        content: piece.content,
        embedding: vectors[i] ?? null,
      })),
    );
    return pieces.length;
  }

  /**
   * Keyword search over notes, with semantic search layered on when embeddings exist.
   *
   * Degrades to keyword-only if the embedding call fails — the same position Documents
   * took, for the same reason: a search that returns something beats one that errors.
   */
  async search(actor: Actor, query: string, limit = 10) {
    await this.require(actor, 'meetings.read');
    const q = query.trim();
    if (!q) return [];

    const keyword = await this.db.execute(sql`
      SELECT n.id, n.title, n.meeting_date, n.client_id,
             ts_headline('english', n.body, plainto_tsquery('english', ${q}),
                         'MaxFragments=1,MaxWords=30,MinWords=10') AS snippet,
             ts_rank(to_tsvector('english', n.title || ' ' || n.body),
                     plainto_tsquery('english', ${q})) AS score
        FROM meetings.notes n
       WHERE to_tsvector('english', n.title || ' ' || n.body) @@ plainto_tsquery('english', ${q})
       ORDER BY score DESC
       LIMIT ${limit}
    `);

    const hits = new Map<string, Record<string, unknown>>();
    for (const row of keyword.rows as Array<Record<string, unknown>>) {
      hits.set(String(row.id), { ...row, match: 'keyword' });
    }

    if (EmbeddingService.isConfigured()) {
      try {
        const [vector] = await this.embeddings.embedBatch([q], { module: 'meetings', feature: 'search' });
        if (vector) {
          const semantic = await this.db.execute(sql`
            SELECT n.id, n.title, n.meeting_date, n.client_id,
                   LEFT(c.content, 200) AS snippet,
                   1 - (c.embedding <=> ${`[${vector.join(',')}]`}::vector) AS score
              FROM meetings.note_chunks c
              JOIN meetings.notes n ON n.id = c.note_id
             WHERE c.embedding IS NOT NULL
             ORDER BY c.embedding <=> ${`[${vector.join(',')}]`}::vector
             LIMIT ${limit}
          `);
          for (const row of semantic.rows as Array<Record<string, unknown>>) {
            if (!hits.has(String(row.id))) hits.set(String(row.id), { ...row, match: 'semantic' });
          }
        }
      } catch (error) {
        this.logger.warn(`Semantic note search unavailable: ${(error as Error).message}`);
      }
    }

    return [...hits.values()].slice(0, limit);
  }

  // ── internals ──────────────────────────────────────────────

  private async raw(id: string) {
    const [row] = await this.db.select().from(notes).where(eq(notes.id, id)).limit(1);
    if (!row) throw new NotFoundException('Meeting note not found');
    return row;
  }

  /**
   * The stored body, with no permission check.
   *
   * For the document authority, which hydrates a note before it has an actor to attribute the
   * read to — by which point the socket that asked for it has already been authorised for
   * both reading and writing. Not an endpoint, and not for anything that faces a request.
   */
  async bodyOf(id: string): Promise<string> {
    return (await this.raw(id)).body;
  }

  /**
   * May this actor change note bodies?
   *
   * Public because the collaborative document socket has to answer it at the moment somebody
   * connects, not when their first edit is eventually written. The body is flushed by the
   * authority long after the keystroke, so a permission failure there would surface as a note
   * that quietly stops saving rather than as a refused connection.
   */
  async assertCanWrite(actor: Actor): Promise<void> {
    await this.require(actor, 'meetings.write');
  }

  private async require(actor: Actor, capability: string): Promise<void> {
    if (!(await this.permissions.can(actor, capability))) {
      throw new BadRequestException(`Missing capability ${capability}`);
    }
  }

  async ensureReportingViews(): Promise<void> {
    await this.db.execute(sql`DROP VIEW IF EXISTS meetings.v_notes CASCADE`);
    await this.db.execute(sql`
      CREATE VIEW meetings.v_notes AS
      SELECT n.id, n.title, n.client_id, n.project_id, n.meeting_date, n.status,
             n.template, n.transcribed_at, n.transcript_cost_cents,
             (SELECT count(*) FROM meetings.action_items a WHERE a.note_id = n.id) AS action_count,
             (SELECT count(*) FROM meetings.action_items a
               WHERE a.note_id = n.id AND a.status = 'accepted') AS accepted_action_count,
             n.finalised_at, n.created_at
        FROM meetings.notes n
    `);
    await this.db.execute(sql`
      CREATE INDEX IF NOT EXISTS notes_fts_idx ON meetings.notes
        USING GIN (to_tsvector('english', title || ' ' || body))
    `);
  }
}
