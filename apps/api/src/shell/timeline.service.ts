import { Inject, Injectable } from '@nestjs/common';
import type { Actor, TimelineEntry } from '@platform/contracts';
import { desc, inArray } from 'drizzle-orm';
import { DB, type Database } from '../core/db/db.module.js';
import { events, users } from '../core/db/core.schema.js';
import { LinkService } from '../core/links/link.service.js';
import { PermissionService } from '../core/permissions/permission.service.js';
import { RegistryService } from '../core/registry/registry.service.js';

/**
 * The activity timeline (Master §13) — the architecture's payoff.
 *
 * "Everything linked to entity X, ordered by time" is a query on the CORE: registry
 * entries, links, and the event log. No module was written to produce this view, and no
 * module needs changing when a new one is added — its entities become timeline-visible
 * the moment they are registered and linked.
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

    const rows = await this.db
      .select({
        eventId: events.id,
        eventName: events.eventName,
        entityId: events.entityId,
        actorId: events.actorId,
        createdAt: events.createdAt,
      })
      .from(events)
      .where(inArray(events.entityId, scope))
      .orderBy(desc(events.createdAt))
      .limit(limit);

    if (rows.length === 0) return [];

    // Batch-resolve subjects and actors: one query each, not one per row.
    const refs = new Map(
      (await this.registry.resolve([...new Set(rows.map((r) => r.entityId))])).map((r) => [r.id, r]),
    );
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((id): id is string => !!id))];
    const actorNames = new Map(
      actorIds.length === 0
        ? []
        : (
            await this.db
              .select({ id: users.id, displayName: users.displayName })
              .from(users)
              .where(inArray(users.id, actorIds))
          ).map((u) => [u.id, u.displayName]),
    );

    return rows
      .filter((r) => refs.has(r.entityId))
      .map((r) => ({
        eventId: r.eventId,
        eventName: r.eventName,
        subject: refs.get(r.entityId)!,
        actor: r.actorId
          ? { id: r.actorId, displayName: actorNames.get(r.actorId) ?? 'Unknown' }
          : null,
        createdAt: r.createdAt.toISOString(),
      }));
  }
}
