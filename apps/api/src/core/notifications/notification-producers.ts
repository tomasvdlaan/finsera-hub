import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module.js';
import { entities, users } from '../db/core.schema.js';
import { EventHandlerRegistry, type EventContext } from '../events/event-handler.registry.js';
import { NotificationService } from './notification.service.js';

/**
 * Events in, notifications out. One handler per subscription the core manifest declares.
 *
 * Every handler is idempotent the same way: the dedupe key is derived from the event or the
 * mention it is about, so the bus delivering it twice writes one row. Titles are built from
 * the registry's display name and the actor's name — the lock-screen sentence: who, what,
 * which, and nothing from inside the record.
 */
@Injectable()
export class NotificationProducers implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly handlers: EventHandlerRegistry,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    this.handlers.bind('core', 'notifyMentioned', (ctx) => this.mentioned(ctx));
    this.handlers.bind('core', 'notifyTaskAssigned', (ctx) => this.taskAssigned(ctx));
  }

  /** Somebody was named in a comment. One notification per person named. */
  async mentioned(ctx: EventContext): Promise<void> {
    const named = (ctx.payload.mentions ?? []) as Array<{ id: string; userId: string }>;
    if (named.length === 0) return;
    const [actor, subject] = await Promise.all([this.nameOf(ctx.actorId), this.subjectName(ctx.entityId)]);

    for (const m of named) {
      await this.notifications.notify({
        personId: m.userId,
        category: 'mention',
        tier: 'now',
        title:
          m.userId === ctx.actorId
            ? `Your reminder on ${subject}`
            : `${actor ?? 'Somebody'} mentioned you on ${subject}`,
        // The same keys the migration used for mentions that were already waiting.
        groupKey: `comments:${ctx.entityId}`,
        dedupeKey: `mention:${m.id}`,
        subjectId: ctx.entityId,
        subjectType: ctx.entityType,
        actorId: ctx.actorId,
      });
    }
  }

  /** A task was given to somebody — on creation or later. */
  async taskAssigned(ctx: EventContext): Promise<void> {
    const assigneeId = ctx.payload.assigneeId as string | null | undefined;
    if (!assigneeId) return;
    const [actor, task] = await Promise.all([this.nameOf(ctx.actorId), this.subjectName(ctx.entityId)]);

    await this.notifications.notify({
      personId: assigneeId,
      category: 'task',
      tier: 'now',
      title: actor ? `${actor} assigned you ${task}` : `You were assigned ${task}`,
      groupKey: `task:${ctx.entityId}`,
      dedupeKey: `task.assigned:${ctx.eventId}`,
      subjectId: ctx.entityId,
      subjectType: ctx.entityType,
      actorId: ctx.actorId,
    });
  }

  private async nameOf(userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const [row] = await this.db
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.name ?? null;
  }

  /** The record's name as the registry holds it — quoted, so a title reads as one. */
  private async subjectName(entityId: string): Promise<string> {
    const [row] = await this.db
      .select({ name: entities.displayName })
      .from(entities)
      .where(inArray(entities.id, [entityId]))
      .limit(1);
    return row ? `“${row.name}”` : 'a record';
  }
}
