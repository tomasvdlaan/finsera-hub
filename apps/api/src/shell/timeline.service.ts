import { Inject, Injectable } from '@nestjs/common';
import type { Actor, TimelineEntry } from '@platform/contracts';
import { and, desc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';
import { DB, type Database } from '../core/db/db.module.js';
import { events, users } from '../core/db/core.schema.js';
import { LinkService } from '../core/links/link.service.js';
import { PermissionService } from '../core/permissions/permission.service.js';
import { RegistryService } from '../core/registry/registry.service.js';

/** A timeline row that also carries what the event said. */
export interface ActivityEntry extends TimelineEntry {
  /**
   * The event's own payload.
   *
   * Left out of `TimelineEntry` because a UI renders the event name and the subject and has
   * no use for the rest. A reader that has to *explain* what happened does: "moved" is not an
   * answer, "moved from review back to in progress" is, and only the payload knows that.
   */
  detail: Record<string, unknown>;
  entityType: string;
}

export interface RecentQuery {
  /** ISO instant. Everything at or after it. */
  since?: string;
  until?: string;
  /** Registry entity type — 'task', 'invoice', 'note'. */
  entityType?: string;
  /** Only what this person did. */
  actorId?: string;
  /** An exact event name, e.g. 'task.completed'. */
  eventName?: string;
  limit?: number;
}

/**
 * The activity timeline (Master §13) — the architecture's payoff.
 *
 * "Everything linked to entity X, ordered by time" is a query on the CORE: registry
 * entries, links, and the event log. No module was written to produce this view, and no
 * module needs changing when a new one is added — its entities become timeline-visible
 * the moment they are registered and linked.
 *
 * `recent` is the same query with time as its axis instead of an entity. The log has been
 * accumulating since the platform was written and the only way to read it back was to
 * already know which record you cared about — exactly backwards for the question people
 * actually ask, which is "what happened while I was away".
 */
@Injectable()
export class TimelineService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly registry: RegistryService,
    private readonly links: LinkService,
    private readonly permissions: PermissionService,
  ) {}

  async for(actor: Actor, entityId: string, limit = 50): Promise<TimelineEntry[]> {
    if (!(await this.permissions.canSee(actor, entityId))) return [];

    // The subject plus everything linked to it that this actor may see. The link
    // service has already applied the both-endpoints rule.
    const linked = await this.links.linkedIds(actor, entityId);
    const scope = [...new Set([entityId, ...linked])];

    return this.assemble(actor, [inArray(events.entityId, scope)], limit);
  }

  /**
   * What has happened lately, across everything this actor may see.
   *
   * Deliberately not "everything that happened": every row is filtered through `visibleIds`
   * before it is returned, so the feed can never become a way to learn about a record you
   * could not otherwise open. The v0 policy makes that filter nearly a no-op, and it is
   * written anyway — the call path being complete from the start is the whole reason
   * tightening it later will be one file rather than twenty.
   *
   * Newest first, and the limit is applied in SQL, so a quiet week costs the same as a busy
   * one. Capped at 200 regardless of what is asked for: this feeds a language model, and a
   * thousand rows of "task.moved" is tokens spent to say nothing.
   */
  async recent(actor: Actor, query: RecentQuery = {}): Promise<ActivityEntry[]> {
    if (!actor?.userId) return [];

    const where: SQL[] = [];
    if (query.since) where.push(gte(events.createdAt, new Date(query.since)));
    if (query.until) where.push(lte(events.createdAt, new Date(query.until)));
    // Filtered in SQL rather than after resolving, because the event row already carries its
    // own entity type — the registry lookup is for names, not for deciding what to fetch.
    if (query.entityType) where.push(eq(events.entityType, query.entityType));
    if (query.actorId) where.push(eq(events.actorId, query.actorId));
    if (query.eventName) where.push(eq(events.eventName, query.eventName));

    return this.assemble(actor, where, Math.min(query.limit ?? 50, 200));
  }

  /**
   * Rows into readable entries: resolve the subjects, name the actors, drop what this person
   * may not see.
   *
   * Shared by both queries because the difference between them is one WHERE clause, and two
   * copies of this would drift the moment either grew a field.
   */
  private async assemble(actor: Actor, where: SQL[], limit: number): Promise<ActivityEntry[]> {
    const rows = await this.db
      .select({
        eventId: events.id,
        eventName: events.eventName,
        entityId: events.entityId,
        entityType: events.entityType,
        actorId: events.actorId,
        payload: events.payload,
        createdAt: events.createdAt,
      })
      .from(events)
      .where(where.length > 0 ? and(...where) : undefined)
      .orderBy(desc(events.createdAt))
      .limit(limit);

    if (rows.length === 0) return [];

    // Batch-resolve subjects and actors: one query each, not one per row.
    const subjectIds = [...new Set(rows.map((r) => r.entityId))];
    const [refs, visible, actorNames] = await Promise.all([
      this.registry.resolve(subjectIds).then((list) => new Map(list.map((r) => [r.id, r]))),
      this.permissions.visibleIds(actor, subjectIds),
      this.namesOf([...new Set(rows.map((r) => r.actorId).filter((id): id is string => !!id))]),
    ]);

    return rows
      // Both conditions matter and they are not the same thing: `refs` drops an event whose
      // subject has left the registry, `visible` drops one this person may not open.
      .filter((r) => refs.has(r.entityId) && visible.has(r.entityId))
      .map((r) => ({
        eventId: r.eventId,
        eventName: r.eventName,
        entityType: r.entityType,
        subject: refs.get(r.entityId)!,
        actor: r.actorId
          ? { id: r.actorId, displayName: actorNames.get(r.actorId) ?? 'Unknown' }
          : null,
        detail: (r.payload ?? {}) as Record<string, unknown>,
        createdAt: r.createdAt.toISOString(),
      }));
  }

  private async namesOf(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, ids));
    return new Map(rows.map((u) => [u.id, u.displayName]));
  }
}
