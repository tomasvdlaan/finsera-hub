import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service.js';
import { DB, type Database } from '../db/db.module.js';
import { comments, users } from '../db/core.schema.js';
import { PermissionService } from '../permissions/permission.service.js';
import { RegistryService } from '../registry/registry.service.js';
import { MentionService, namesIn } from './mention.service.js';

const MAX_BODY = 10_000;

export interface CommentView {
  id: string;
  body: string;
  parentId: string | null;
  authorId: string;
  authorName: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  /** Whether the caller may edit or delete this one — decided here, not in the browser. */
  mine: boolean;
}

/**
 * Discussion on any registry entity.
 *
 * **On permissions.** There is no `core.comments.write` capability, deliberately. Core owns no
 * manifest — the core learns about modules only through theirs — and `PermissionService.can`
 * throws on an undeclared capability rather than denying it, so a new core capability has
 * nowhere legitimate to be declared. The permission model here is therefore the subject's
 * own: if you can see the thing, you can discuss it, and if you cannot see it the thread does
 * not exist as far as you are concerned. That is a real rule rather than a workaround — a
 * comment is not a separate thing to be authorised, it is part of the record it hangs on.
 *
 * **On editing.** Only the author, and only their own. An audit entry records every write, so
 * "who changed what this said" survives the edit.
 */
@Injectable()
export class CommentService {
  private readonly logger = new Logger(CommentService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly registry: RegistryService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly mentions: MentionService,
  ) {}

  /** The thread on one entity, oldest first, with deleted comments kept as tombstones. */
  async listFor(actor: Actor, subjectId: string): Promise<CommentView[]> {
    if (!(await this.permissions.canSee(actor, subjectId))) {
      // Indistinguishable from "no comments", because confirming a thread exists on a record
      // you cannot see is itself a disclosure.
      throw new ForbiddenException('Not available');
    }

    const rows = await this.db
      .select({
        id: comments.id,
        body: comments.body,
        parentId: comments.parentId,
        authorId: comments.authorId,
        authorName: users.displayName,
        createdAt: comments.createdAt,
        editedAt: comments.editedAt,
        deletedAt: comments.deletedAt,
      })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .where(eq(comments.subjectId, subjectId))
      .orderBy(asc(comments.createdAt));

    return rows.map((r) => ({
      id: r.id,
      // A tombstone rather than a gap: a reply whose parent vanished reads as a non-sequitur.
      body: r.deletedAt ? '' : r.body,
      parentId: r.parentId,
      authorId: r.authorId,
      authorName: r.authorName ?? 'Someone',
      createdAt: r.createdAt.toISOString(),
      editedAt: r.editedAt?.toISOString() ?? null,
      deleted: r.deletedAt !== null,
      mine: r.authorId === actor.userId && r.deletedAt === null,
    }));
  }

  async add(
    actor: Actor,
    input: { subjectId: string; body: string; parentId?: string },
  ): Promise<CommentView> {
    const body = (input.body ?? '').trim();
    if (!body) throw new BadRequestException('A comment needs something in it');
    if (body.length > MAX_BODY) {
      throw new BadRequestException(`A comment can be at most ${MAX_BODY} characters`);
    }
    if (!(await this.permissions.canSee(actor, input.subjectId))) {
      throw new ForbiddenException('Not available');
    }

    // The subject must be a real registry row, so a comment cannot be filed against an id
    // that was mistyped or that belongs to something deleted.
    const [subject] = await this.registry.resolve([input.subjectId]);
    if (!subject) throw new NotFoundException('No such record');

    if (input.parentId) {
      const [parent] = await this.db
        .select({ id: comments.id, parentId: comments.parentId, subjectId: comments.subjectId })
        .from(comments)
        .where(eq(comments.id, input.parentId))
        .limit(1);
      if (!parent || parent.subjectId !== input.subjectId) {
        throw new BadRequestException('That reply does not belong to this record');
      }
      // One level. Replying to a reply flattens onto the same parent rather than nesting,
      // because a task discussion that branches is a discussion nobody re-reads.
      if (parent.parentId) input.parentId = parent.parentId;
    }

    const id = uuidv7();
    // Read before the transaction opens: it is a plain lookup, and holding a transaction
    // open across it buys nothing.
    const people = await this.mentions.mentionable();

    await this.db.transaction(async (tx) => {
      await tx.insert(comments).values({
        id,
        subjectId: input.subjectId,
        subjectType: subject.entityType,
        parentId: input.parentId ?? null,
        body,
        authorId: actor.userId,
      });
      /*
       * In the same transaction as the comment.
       *
       * A mention that outlived a rolled-back comment would point at a row that never
       * existed, and the person would open an empty page wondering what they missed.
       */
      await this.mentions.record(tx, {
        commentId: id,
        subjectId: input.subjectId,
        subjectType: subject.entityType,
        authorId: actor.userId,
        userIds: namesIn(body, people),
      });
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'comment.create',
        entityType: subject.entityType,
        entityId: input.subjectId,
        detail: { commentId: id },
      });
    });

    this.logger.log(`Comment on ${subject.entityType} ${input.subjectId}`);
    const thread = await this.listFor(actor, input.subjectId);
    return thread.find((c) => c.id === id)!;
  }

  async edit(actor: Actor, id: string, body: string): Promise<CommentView> {
    const trimmed = (body ?? '').trim();
    if (!trimmed) throw new BadRequestException('A comment needs something in it');

    const existing = await this.own(actor, id);
    const people = await this.mentions.mentionable();

    await this.db.transaction(async (tx) => {
      await tx
        .update(comments)
        .set({ body: trimmed, editedAt: new Date() })
        .where(eq(comments.id, id));
      /*
       * An edit can add a name; it cannot take one back.
       *
       * `mentions_once` swallows the ones already recorded, so fixing a typo notifies
       * nobody twice. Removing a name leaves the mention standing, which is the honest
       * outcome — it was delivered, and an edit is not a recall.
       */
      await this.mentions.record(tx, {
        commentId: id,
        subjectId: existing.subjectId,
        subjectType: existing.subjectType,
        authorId: actor.userId,
        userIds: namesIn(trimmed, people),
      });
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'comment.edit',
        entityType: existing.subjectType,
        entityId: existing.subjectId,
        detail: { commentId: id },
      });
    });

    const thread = await this.listFor(actor, existing.subjectId);
    return thread.find((c) => c.id === id)!;
  }

  async remove(actor: Actor, id: string): Promise<{ id: string; deleted: true }> {
    const existing = await this.own(actor, id);
    await this.db.transaction(async (tx) => {
      // Soft-deleted so replies keep their parent, and blanked so "deleted" means deleted
      // rather than "hidden in the UI and still in the table".
      await tx
        .update(comments)
        .set({ deletedAt: new Date(), body: '' })
        .where(eq(comments.id, id));
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'comment.delete',
        entityType: existing.subjectType,
        entityId: existing.subjectId,
        detail: { commentId: id },
      });
    });
    return { id, deleted: true };
  }

  /** Yours, and not already deleted. Anything else is refused identically. */
  private async own(actor: Actor, id: string) {
    const [row] = await this.db
      .select()
      .from(comments)
      .where(and(eq(comments.id, id), isNull(comments.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('No such comment');
    if (row.authorId !== actor.userId) {
      // Not Forbidden-with-detail: whether a comment exists that belongs to someone else is
      // not information this endpoint should hand out.
      throw new NotFoundException('No such comment');
    }
    return row;
  }
}
