import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
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
import { ScrumService } from '../scrum/scrum.service.js';
import { TEMPLATES, type TemplateName } from './templates.js';
import {
  actionItems,
  agendaItems,
  attendees,
  noteChunks,
  notes,
  transcripts,
} from './meetings.schema.js';

export interface CreateNoteInput {
  title: string;
  clientId?: string | null;
  projectId?: string | null;
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
  ) {}

  // ── notes ──────────────────────────────────────────────────

  async create(actor: Actor, input: CreateNoteInput, origin: { aiInitiated?: boolean } = {}) {
    await this.require(actor, 'meetings.write');
    if (!input.title?.trim()) throw new BadRequestException('A note needs a title');

    const template = input.template ? TEMPLATES[input.template] : undefined;
    if (input.template && !template) {
      throw new BadRequestException(`Unknown template '${input.template}'`);
    }
    if (input.clientId) await this.crm.getClient(actor, input.clientId);

    const meetingDate = input.meetingDate ?? new Date().toISOString().slice(0, 10);
    const body = input.body ?? template?.body ?? '';
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
        projectId: input.projectId ?? null,
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
      if (input.projectId) {
        await this.links.createWithin(tx, actor, {
          fromId: id,
          toId: input.projectId,
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

  async update(actor: Actor, id: string, patch: Partial<CreateNoteInput> & { status?: string }) {
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

    // Re-index only when the text actually changed; embedding is the expensive part.
    if (patch.body !== undefined && patch.body !== before.body) {
      await this.index(id).catch(() => undefined);
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

    return this.db
      .select()
      .from(notes)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(notes.meetingDate), desc(notes.createdAt));
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
    if (!note.projectId) {
      throw new BadRequestException(
        'Link this note to a project before turning action points into tasks',
      );
    }

    const task = await this.scrum.createTask(actor, {
      projectId: note.projectId,
      title: item.text,
      description: `From the meeting note "${note.title}" (${note.meetingDate}).`,
      assigneeId: item.assigneeId ?? undefined,
      dueOn: item.dueOn ?? undefined,
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
      ? await this.embeddings.embedBatch(pieces.map((p) => p.content))
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
        const [vector] = await this.embeddings.embedBatch([q]);
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
