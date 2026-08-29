import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { and, asc, desc, eq, inArray, lte, ne, sql } from 'drizzle-orm';
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
import { visibleNotes } from './visibility.js';
import { RETRO_LABEL, ScrumService } from '../scrum/scrum.service.js';
import { headingsOf, markdownToDoc } from '@platform/note-doc';
import { appendMarkdown, replaceSectionMarkdown } from './doc/note-edit.js';
import { NoteDocService } from './doc/note-doc.service.js';
import {
  TEMPLATES,
  bodyFor,
  carriedBody,
  retroBody,
  reviewBody,
  standupBody,
  type Commitment,
  type Template,
  type TemplateName,
} from './templates.js';
import {
  actionItems,
  agendaItems,
  attendees,
  noteChunks,
  noteViewers,
  notes,
  transcripts,
} from './meetings.schema.js';
import { users } from '../../core/db/core.schema.js';

/**
 * The only HTML a note body renders — see @platform/note-doc's parser, which is the authority.
 *
 * Kept in step with it by the round-trip tests there and the write tests here: a shape this
 * allows but the parser refuses would be stored as visible angle brackets.
 */
const COLOUR_TAGS =
  /<span style="color:#[0-9a-f]{3}(?:[0-9a-f]{3})?">|<mark style="background-color:#[0-9a-f]{3}(?:[0-9a-f]{3})?">|<\/span>|<\/mark>/gi;

/**
 * The agenda item a meeting gets when earlier ones left something owed.
 *
 * Named as a question the room can answer rather than as a heading, and first on the list: the
 * two minutes at the top are the only ones in which last time's promises still get discussed.
 */
const CARRIED_AGENDA_ITEM = 'What we said we would do';

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
    let body =
      input.body ??
      (template
        ? await this.seedBody(actor, template, input.attendees ?? [], projectId, sprint?.id ?? null)
        : '');
    let agenda = input.agenda ?? template?.agenda ?? [];

    /*
     * What the last meetings about this work left owed, on the note and on the agenda.
     *
     * Seeded here rather than in `seedBody` because it is not a property of the ceremony: a blank
     * meeting about a project inherits the same debts a check-in does, and a note with a client
     * but no project has a ledger too — `seedBody` returns early on those.
     *
     * A retrospective is skipped: `retroBody` already opens it with the last retro's promises,
     * and two "last time" blocks one under the other read as a bug rather than as thoroughness.
     *
     * Creation only. Past this point the note-doc authority owns the body and a later write
     * would fight whatever is being typed into it.
     */
    if (input.body === undefined && input.template !== 'retrospective') {
      try {
        const owed = await this.openBefore(actor, {
          id: null,
          projectId,
          clientId: input.clientId ?? null,
          meetingDate,
        });
        if (owed.length > 0) {
          body = carriedBody(body, owed);
          // First, ahead of the ceremony's own items. A meeting that opens on last time's
          // promises is the one mechanism that stops them being quietly dropped, and an agenda
          // item is what lets the room mark it covered and the agent notice when it was not.
          if (input.agenda === undefined) agenda = [CARRIED_AGENDA_ITEM, ...agenda];
        }
      } catch {
        // Same bargain as the digests above: the note matters more than the ledger.
      }
    }

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
    const note = await this.raw(actor, noteId);
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
    const before = await this.raw(actor, id);

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
   *
   * It does ask about undecided action points first. Calling a meeting done while the things it
   * agreed to sit in `proposed` is how a commitment becomes the most expensive kind of nothing
   * in this platform: recorded, so it feels handled, and on no board, so nothing counts it.
   * `action_item_undecided` notices three days later on a different screen; this asks at the one
   * moment somebody is still looking at the meeting.
   *
   * A question, not a gate — `force` goes through. A meeting genuinely can end without deciding,
   * and refusing outright would be the workflow automation the SCRUM brief rules out; it would
   * also just teach people to leave notes in draft forever, which is worse than an unsettled
   * final note because nothing looks at drafts either.
   */
  async finalise(actor: Actor, id: string, { force = false }: { force?: boolean } = {}) {
    await this.require(actor, 'meetings.write');
    const note = await this.raw(actor, id);
    if (note.finalisedAt) return this.get(actor, id);

    if (!force) {
      const [undecided] = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(actionItems)
        .where(and(eq(actionItems.noteId, id), eq(actionItems.status, 'proposed')));
      const open = undecided?.count ?? 0;
      if (open > 0) {
        throw new BadRequestException(
          `${open} action point${open === 1 ? ' is' : 's are'} still undecided — accept ${open === 1 ? 'it' : 'them'} onto the board, dismiss ${open === 1 ? 'it' : 'them'}, or finalise anyway`,
        );
      }
    }

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
    await this.raw(actor, id);
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
      // First, and not optional. A filter the caller chose narrows the list; this one decides
      // what the list is allowed to contain, so it is applied whether or not one was passed.
      visibleNotes(actor, await this.memberships(actor)),
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
      .where(
        and(
          // The ledger reads across every meeting, so it is the read most likely to surface a
          // note the actor cannot open — an action point quoting a line from a salary review.
          visibleNotes(actor, await this.memberships(actor)),
          eq(actionItems.status, 'proposed'),
          // An item carried into a later meeting is being asked about there. Counting it here
          // as well would report one commitment as two, and the newer copy is the live one.
          sql`NOT EXISTS (
            SELECT 1 FROM ${actionItems} AS later
             WHERE later.carried_from = ${actionItems.id}
          )`,
        ),
      )
      .orderBy(asc(notes.meetingDate), asc(actionItems.createdAt));
    return rows;
  }

  /**
   * What is still owed on this work, from the meetings before this one.
   *
   * The question a recurring meeting opens with and nothing could answer. The page used to
   * approximate it in the browser from `/meetings/open-actions`, which could only see action
   * points nobody had decided on — so a commitment that WAS accepted, became a card and then sat
   * on the board untouched for a month never came back up in the conversation that would have
   * noticed. That is the group a follow-up meeting exists for, and it was the invisible one.
   *
   * Both kinds are returned, and told apart, because they need different things: an undecided
   * one needs a decision here, and an undone one is already work and needs nothing from this
   * note but to be said out loud.
   *
   * "The same work" is the project, falling back to the client — which is as close to "the same
   * recurring meeting" as the record gets. Not the template: a promise made at a kick-off is
   * still owed at the check-in that follows it, and a ledger that only looked at meetings of the
   * same ceremony would drop exactly the commitments that cross between them.
   *
   * Only earlier meetings. A note dated after this one is not a leftover, it is a plan.
   */
  private async openBefore(
    actor: Actor,
    note: {
      /** Null while the note is being created — there is no self to exclude yet. */
      id: string | null;
      projectId: string | null;
      clientId: string | null;
      meetingDate: string;
    },
  ): Promise<Commitment[]> {
    const scope = note.projectId
      ? eq(notes.projectId, note.projectId)
      : note.clientId
        ? eq(notes.clientId, note.clientId)
        : null;
    // A note attached to nothing has no siblings, and every meeting in the database would be a
    // wrong answer rather than an empty one.
    if (!scope) return [];

    const rows = await this.db
      .select({
        id: actionItems.id,
        text: actionItems.text,
        assigneeId: actionItems.assigneeId,
        dueOn: actionItems.dueOn,
        status: actionItems.status,
        taskId: actionItems.taskId,
        noteId: notes.id,
        noteTitle: notes.title,
        meetingDate: notes.meetingDate,
      })
      .from(actionItems)
      .innerJoin(notes, eq(actionItems.noteId, notes.id))
      .where(
        and(
          // Same rule as everywhere else. This ledger quotes the text of commitments made in
          // other meetings, so an unscoped read here would carry a line out of a note the
          // reader cannot open — the leak being through the quotation rather than the note.
          visibleNotes(actor, await this.memberships(actor)),
          scope,
          note.id ? ne(notes.id, note.id) : undefined,
          lte(notes.meetingDate, note.meetingDate),
          inArray(actionItems.status, ['proposed', 'accepted']),
          /*
           * Not already carried somewhere.
           *
           * Carrying leaves the ancestor where it is rather than inventing a fourth status, so
           * its own history stays readable — which means every read of the ledger has to skip
           * an item that has a descendant, or the same commitment is listed twice: once as
           * itself and once as the copy.
           */
          sql`NOT EXISTS (
            SELECT 1 FROM ${actionItems} AS later
             WHERE later.carried_from = ${actionItems.id}
          )`,
        ),
      )
      .orderBy(asc(notes.meetingDate), asc(actionItems.createdAt));

    if (rows.length === 0) return [];

    /*
     * Which of the accepted ones are actually finished, asked of the board.
     *
     * One call, with every id at once — a request per action point on a page that exists to show
     * several would be the same mistake `list` documents. An id the board does not know about
     * is treated as done: the card was deleted, and asking about work that no longer exists is
     * worse than staying quiet.
     */
    const accepted = rows.filter((r) => r.status === 'accepted' && r.taskId);
    const states = accepted.length
      ? await this.scrum.taskStates(actor, accepted.map((r) => r.taskId!))
      : [];
    const doneById = new Map(states.map((t) => [t.id, t.done]));

    return rows
      .filter((r) => r.status === 'proposed' || !(doneById.get(r.taskId!) ?? true))
      .map((r) => ({
        id: r.id,
        text: r.text,
        assigneeId: r.assigneeId,
        dueOn: r.dueOn,
        noteId: r.noteId,
        noteTitle: r.noteTitle,
        meetingDate: r.meetingDate,
        state: r.status === 'proposed' ? ('undecided' as const) : ('undone' as const),
        taskId: r.taskId,
      }));
  }

  async get(actor: Actor, id: string) {
    await this.require(actor, 'meetings.read');
    const note = await this.raw(actor, id);
    const [agenda, people, actions, openBefore] = await Promise.all([
      this.db.select().from(agendaItems).where(eq(agendaItems.noteId, id)).orderBy(asc(agendaItems.position)),
      this.db.select().from(attendees).where(eq(attendees.noteId, id)).orderBy(asc(attendees.name)),
      this.db.select().from(actionItems).where(eq(actionItems.noteId, id)).orderBy(asc(actionItems.createdAt)),
      // Composed here rather than behind its own endpoint: the page needs it on every load, and
      // every mutation below already returns this shape, so carrying one forward refreshes the
      // list it was carried out of without the browser asking twice.
      this.openBefore(actor, note).catch(() => [] as Commitment[]),
    ]);
    return {
      ...note,
      agenda,
      attendees: people,
      actionItems: actions,
      /** Still owed from earlier meetings about this work — see `openBefore`. */
      openBefore,
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
    await this.raw(actor, noteId);
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
    await this.raw(actor, noteId);
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
    await this.raw(actor, noteId);
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
    const note = await this.raw(actor, noteId);
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
    await this.raw(actor, noteId);

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

  /**
   * Carry a commitment from an earlier meeting onto this one.
   *
   * The whole point of the ledger: the thing said a fortnight ago and not done is asked about
   * again, here, where somebody can answer it — as a real action point that can be assigned,
   * dated, accepted onto the board or dismissed, rather than a line of text to read past.
   *
   * A copy rather than a move. The original meeting's record of what it produced does not change
   * because a later meeting picked the thread up; `carriedFrom` is what ties the two together,
   * and it is what stops the ancestor being counted a second time everywhere it is still open.
   *
   * Only an UNDECIDED one. An accepted commitment is already a card on the board, and carrying
   * it would create a second action point that could be accepted into a second task — the same
   * work, twice, on the same board. Those appear on the ledger with a link to the card, which is
   * the honest thing to do with work that is already tracked.
   */
  async carryActionItem(actor: Actor, noteId: string, itemId: string) {
    await this.require(actor, 'meetings.write');
    const note = await this.raw(actor, noteId);

    const [origin] = await this.db
      .select()
      .from(actionItems)
      .where(eq(actionItems.id, itemId))
      .limit(1);
    if (!origin) throw new NotFoundException('Action point not found');
    if (origin.noteId === noteId) {
      throw new BadRequestException('That action point is already on this meeting');
    }
    if (origin.status !== 'proposed') {
      throw new BadRequestException(
        origin.status === 'accepted'
          ? 'That one is already a task — it is tracked on the board, not here'
          : 'That action point was dismissed',
      );
    }

    const [already] = await this.db
      .select({ id: actionItems.id })
      .from(actionItems)
      .where(and(eq(actionItems.noteId, noteId), eq(actionItems.carriedFrom, itemId)))
      .limit(1);
    // Idempotent: two clicks, or two people in the same room, produce one copy rather than two
    // identical commitments that then have to be dismissed separately.
    if (already) return this.get(actor, noteId);

    const id = this.registry.newId();
    await this.db.transaction(async (tx) => {
      await tx.insert(actionItems).values({
        id,
        noteId,
        text: origin.text,
        assigneeId: origin.assigneeId,
        dueOn: origin.dueOn,
        // Kept, not reset to 'typed'. Where a commitment originally came from is a fact about
        // it, and a suggestion laundered into a typed one by being carried would hide that.
        source: origin.source,
        carriedFrom: itemId,
      });
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'action_item.carry',
        entityType: 'meeting_note',
        entityId: noteId,
        detail: { itemId: id, carriedFrom: itemId, fromNoteId: origin.noteId, title: note.title },
      });
    });

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
    const before = await this.raw(actor, id);
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
    const before = await this.raw(actor, noteId);
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
    const note = await this.raw(actor, noteId);
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
    await this.raw(actor, noteId);
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
    await this.raw(actor, input.noteId);

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
    const note = await this.raw(actor, noteId);
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
    await this.raw(actor, noteId);
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
    await this.raw(actor, noteId);
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

  /**
   * Chunk and embed a note's body. Replaces whatever was indexed before.
   *
   * Unchecked, and has to be: indexing runs for whoever wrote the note, over notes nobody in
   * particular is asking for. What keeps the index from leaking is `search`, which applies
   * the visibility predicate to the chunks it matches.
   */
  async index(noteId: string): Promise<number> {
    const note = await this.unchecked(noteId);
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

    /*
     * The visibility predicate, in a hand-written query.
     *
     * The table is not aliased any more, and that is the reason: `visibleNotes` builds its
     * condition against the `notes` table object, so it renders fully-qualified column names
     * that an alias would put out of scope. Spelling the rule out a second time in SQL to fit
     * an alias would be two definitions of who may read a meeting, and the day they disagree
     * the search is the one that leaks.
     */
    const visible = visibleNotes(actor, await this.memberships(actor));

    const keyword = await this.db.execute(sql`
      SELECT meetings.notes.id, meetings.notes.title, meetings.notes.meeting_date,
             meetings.notes.client_id,
             ts_headline('english', meetings.notes.body, plainto_tsquery('english', ${q}),
                         'MaxFragments=1,MaxWords=30,MinWords=10') AS snippet,
             ts_rank(to_tsvector('english', meetings.notes.title || ' ' || meetings.notes.body),
                     plainto_tsquery('english', ${q})) AS score
        FROM meetings.notes
       WHERE to_tsvector('english', meetings.notes.title || ' ' || meetings.notes.body)
             @@ plainto_tsquery('english', ${q})
         AND ${visible}
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
          /* The index is built over every note — see `index` — so this is where the chunks
             of a note the actor may not read are kept out of the results. */
          const semantic = await this.db.execute(sql`
            SELECT meetings.notes.id, meetings.notes.title, meetings.notes.meeting_date,
                   meetings.notes.client_id,
                   LEFT(c.content, 200) AS snippet,
                   1 - (c.embedding <=> ${`[${vector.join(',')}]`}::vector) AS score
              FROM meetings.note_chunks c
              JOIN meetings.notes ON meetings.notes.id = c.note_id
             WHERE c.embedding IS NOT NULL
               AND ${visible}
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

  // ── who may see this ───────────────────────────────────────

  /**
   * Take a note out of project scoping, or put it back.
   *
   * Its own method rather than a field on `update`, because `update` is also what the
   * collaborative document calls when it flushes a body. An access change arriving down the
   * same path as a keystroke is one merge away from being made by accident, and it is the one
   * change on this record where an accident is expensive.
   *
   * Anyone who can already see the note may restrict it. Deliberately not admin-only: the
   * person who needs to close a note is the person writing it, at the moment they realise
   * what it is about, and a policy that makes them ask somebody first is a policy that gets
   * answered by not writing it down.
   */
  async setRestricted(actor: Actor, id: string, restricted: boolean) {
    await this.require(actor, 'meetings.write');
    await this.raw(actor, id);

    await this.db.transaction(async (tx) => {
      await tx.update(notes).set({ restricted, updatedAt: new Date() }).where(eq(notes.id, id));
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: restricted ? 'meeting_note.restrict' : 'meeting_note.unrestrict',
        entityType: 'meeting_note',
        entityId: id,
      });
    });
    return this.get(actor, id);
  }

  /** Who has been granted access, with names. The author is not listed — they always hold it. */
  async listViewers(actor: Actor, id: string) {
    await this.require(actor, 'meetings.read');
    await this.raw(actor, id);
    return this.db
      .select({
        userId: noteViewers.userId,
        addedAt: noteViewers.addedAt,
        addedBy: noteViewers.addedBy,
        displayName: users.displayName,
        email: users.email,
      })
      .from(noteViewers)
      .innerJoin(users, eq(users.id, noteViewers.userId))
      .where(eq(noteViewers.noteId, id))
      .orderBy(asc(users.displayName));
  }

  /**
   * Let somebody in.
   *
   * Idempotent, so granting twice is somebody clicking twice rather than an error. Recorded
   * with who granted it: the question asked after the fact is never "who can see this" but
   * "how did they come to", and only the second one needs a column.
   */
  async addViewer(actor: Actor, id: string, userId: string) {
    await this.require(actor, 'meetings.write');
    await this.raw(actor, id);

    await this.db.transaction(async (tx) => {
      await tx
        .insert(noteViewers)
        .values({ noteId: id, userId, addedBy: actor.userId })
        .onConflictDoNothing();
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'meeting_note.viewer_added',
        entityType: 'meeting_note',
        entityId: id,
        detail: { userId },
      });
    });
    return this.listViewers(actor, id);
  }

  /**
   * Take access away.
   *
   * The author cannot be removed, because they are not in this table at all — their access is
   * the note's own `created_by`. Removing the last viewer therefore leaves a note only its
   * writer can open, which is a coherent state and not an accident to guard against.
   */
  async removeViewer(actor: Actor, id: string, userId: string) {
    await this.require(actor, 'meetings.write');
    await this.raw(actor, id);

    await this.db.transaction(async (tx) => {
      await tx
        .delete(noteViewers)
        .where(and(eq(noteViewers.noteId, id), eq(noteViewers.userId, userId)));
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'meeting_note.viewer_removed',
        entityType: 'meeting_note',
        entityId: id,
        detail: { userId },
      });
    });
    return this.listViewers(actor, id);
  }

  // ── internals ──────────────────────────────────────────────

  /**
   * The projects this actor is on, for the visibility predicate.
   *
   * Resolved per call rather than cached: a membership added a moment ago should take effect
   * on the next request, and a cache here would be a stale authorisation decision, which is
   * the one kind of staleness never worth the round trip it saves.
   */
  private memberships(actor: Actor): Promise<string[]> {
    return this.crm.projectIdsFor(actor.userId);
  }

  /**
   * The note, if this actor may see it.
   *
   * Every actor-facing path that loads one note by id goes through here, which is the reason
   * it is a single method: the alternative is twenty-one call sites each remembering to
   * check, and the one that forgets is not a visible bug — it is a note being served to
   * somebody it was hidden from, silently, for as long as nobody looks.
   *
   * The filter is in the query. A note this actor may not see is `NotFoundException`, the
   * same answer as a note that does not exist — see `visibleNotes` for why that is the right
   * answer rather than a Forbidden.
   */
  private async raw(actor: Actor, id: string) {
    const [row] = await this.db
      .select()
      .from(notes)
      .where(and(eq(notes.id, id), visibleNotes(actor, await this.memberships(actor))))
      .limit(1);
    if (!row) throw new NotFoundException('Meeting note not found');
    return row;
  }

  /**
   * The note, with no visibility check at all.
   *
   * For the two callers that have no actor to check against: the document authority, which
   * hydrates a body for a socket that was authorised when it connected, and the search
   * indexer, which runs over every note by design and whose output is filtered on the way out
   * instead. Not reachable from a request, and it must stay that way.
   */
  private async unchecked(id: string) {
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
    return (await this.unchecked(id)).body;
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
