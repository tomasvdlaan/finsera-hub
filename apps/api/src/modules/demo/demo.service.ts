import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { desc, eq } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { DB, type Database } from '../../core/db/db.module.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import type { EventContext } from '../../core/events/event-handler.registry.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { items } from './demo.schema.js';

/**
 * The demo module's internal API — THROWAWAY, deleted after gate G0.
 *
 * This is the reference implementation Phase 1 (CRM) copies. Note the shape of create():
 * mint the id, then register + insert + audit + publish in ONE transaction. Every module
 * follows this pattern.
 */
@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly registry: RegistryService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  async createItem(actor: Actor, input: { title: string; note?: string }) {
    if (!(await this.permissions.can(actor, 'demo.items.create'))) {
      throw new NotFoundException('Not permitted');
    }

    const id = this.registry.newId();

    await this.db.transaction(async (tx) => {
      await this.registry.register(tx, {
        id,
        entityType: 'demo_item',
        displayName: input.title,
        urlPath: `/demo/items/${id}`,
      });

      await tx.insert(items).values({
        id,
        title: input.title,
        note: input.note ?? null,
        createdBy: actor.userId,
      });

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'demo_item.create',
        entityType: 'demo_item',
        entityId: id,
        detail: { title: input.title },
      });

      await this.events.publish(tx, {
        name: 'demo_item.created',
        entityType: 'demo_item',
        entityId: id,
        actorId: actor.userId,
        payload: { title: input.title },
      });
    });

    return { id, title: input.title };
  }

  async listItems(actor: Actor, limit = 10) {
    if (!(await this.permissions.can(actor, 'demo.items.read'))) return { items: [] };
    const rows = await this.db.select().from(items).orderBy(desc(items.createdAt)).limit(limit);
    return { items: rows.map((r) => ({ id: r.id, title: r.title })) };
  }

  async getItem(actor: Actor, id: string) {
    if (!(await this.permissions.canSee(actor, id))) throw new NotFoundException();
    const [row] = await this.db.select().from(items).where(eq(items.id, id));
    if (!row) throw new NotFoundException();
    return row;
  }

  /**
   * Subscriber for its own event (declared in the manifest).
   *
   * Idempotent by construction — it only writes an audit row keyed to the event, which
   * is what at-least-once delivery demands of every handler.
   */
  async onItemCreated(ctx: EventContext): Promise<void> {
    await this.db.transaction((tx) =>
      this.audit.record(tx, {
        actorId: null, // the dispatcher acts as the system, not as a user
        action: 'demo_item.reacted',
        entityType: ctx.entityType,
        entityId: ctx.entityId,
        detail: { eventId: ctx.eventId, handledBy: 'demo.onItemCreated' },
      }),
    );
    this.logger.log(`Reacted to ${ctx.eventName} for ${ctx.entityId}`);
  }
}
