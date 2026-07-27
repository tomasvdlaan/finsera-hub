import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Actor, Link } from '@platform/contracts';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service.js';
import { DB, type Database, type Executor } from '../db/db.module.js';
import { links } from '../db/core.schema.js';
import { PermissionService } from '../permissions/permission.service.js';
import { RegistryService } from '../registry/registry.service.js';

export interface CreateLinkInput {
  fromId: string;
  toId: string;
  kind?: string;
}

/**
 * Contextual links (Master §8.2) — any entity to any entity, with an optional semantic
 * kind. Because both ends are registry ids, linking a future entity type to existing
 * ones needs zero changes to existing modules.
 *
 * THE RULE (Master §15.6): a link is visible only if BOTH endpoints are. Linking is
 * exactly where data leaks would happen — seeing "meeting X relates to contract Y" is a
 * disclosure even when contract Y itself is unreadable. Every method here enforces it.
 */
@Injectable()
export class LinkService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly registry: RegistryService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
  ) {}

  async create(actor: Actor, input: CreateLinkInput): Promise<Link> {
    if (input.fromId === input.toId) {
      throw new NotFoundException('An entity cannot be linked to itself');
    }

    const [from, to] = await Promise.all([
      this.registry.resolveOne(input.fromId),
      this.registry.resolveOne(input.toId),
    ]);
    if (!from || !to) throw new NotFoundException('Both entities must exist in the registry');

    // Both ends, before writing — you may not link what you may not see.
    const [canSeeFrom, canSeeTo] = await Promise.all([
      this.permissions.canSee(actor, input.fromId),
      this.permissions.canSee(actor, input.toId),
    ]);
    if (!canSeeFrom || !canSeeTo) throw new ForbiddenException('Cannot link these entities');

    // Postgres treats NULLs as distinct in a UNIQUE constraint, so (a, b, NULL) can be
    // inserted repeatedly. Deduplicate explicitly rather than relying on the index.
    const kind = input.kind ?? null;
    const existing = await this.db.query.links.findFirst({
      where: and(
        eq(links.fromId, input.fromId),
        eq(links.toId, input.toId),
        kind === null ? isNull(links.linkKind) : eq(links.linkKind, kind),
      ),
    });
    if (existing) {
      return {
        id: existing.id,
        from,
        to,
        kind: existing.linkKind,
        createdAt: existing.createdAt.toISOString(),
      };
    }

    const id = uuidv7();
    const createdAt = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(links)
        .values({
          id,
          fromType: from.entityType,
          fromId: input.fromId,
          toType: to.entityType,
          toId: input.toId,
          linkKind: kind,
          createdBy: actor.userId,
        })
        .returning({ createdAt: links.createdAt });

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'link.create',
        entityType: from.entityType,
        entityId: input.fromId,
        detail: { toId: input.toId, toType: to.entityType, kind },
      });

      return row!.createdAt;
    });

    return { id, from, to, kind, createdAt: createdAt.toISOString() };
  }

  async remove(actor: Actor, linkId: string): Promise<void> {
    const link = await this.db.query.links.findFirst({ where: eq(links.id, linkId) });
    if (!link) throw new NotFoundException('Link not found');

    const [canSeeFrom, canSeeTo] = await Promise.all([
      this.permissions.canSee(actor, link.fromId),
      this.permissions.canSee(actor, link.toId),
    ]);
    if (!canSeeFrom || !canSeeTo) throw new ForbiddenException('Cannot remove this link');

    await this.db.transaction(async (tx) => {
      await tx.delete(links).where(eq(links.id, linkId));
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'link.delete',
        entityType: link.fromType,
        entityId: link.fromId,
        detail: { toId: link.toId, kind: link.linkKind },
      });
    });
  }

  /**
   * All links touching an entity, in either direction, filtered to those whose OTHER
   * end the actor may also see. Links are stored one-directional and read both ways.
   */
  async listFor(actor: Actor, entityId: string, executor: Executor = this.db): Promise<Link[]> {
    if (!(await this.permissions.canSee(actor, entityId, executor))) return [];

    const rows = await executor
      .select()
      .from(links)
      .where(or(eq(links.fromId, entityId), eq(links.toId, entityId)));
    if (rows.length === 0) return [];

    const otherIds = rows.map((r) => (r.fromId === entityId ? r.toId : r.fromId));
    const visible = await this.permissions.visibleIds(actor, otherIds, executor);

    const refIds = [...new Set([entityId, ...otherIds.filter((id) => visible.has(id))])];
    const refs = new Map((await this.registry.resolve(refIds, executor)).map((r) => [r.id, r]));

    return rows
      .filter((r) => visible.has(r.fromId === entityId ? r.toId : r.fromId))
      .map((r) => ({
        id: r.id,
        from: refs.get(r.fromId)!,
        to: refs.get(r.toId)!,
        kind: r.linkKind,
        createdAt: r.createdAt.toISOString(),
      }));
  }

  /** Ids linked to an entity, for the timeline query. Permission-filtered like listFor. */
  async linkedIds(actor: Actor, entityId: string, executor: Executor = this.db): Promise<string[]> {
    const found = await this.listFor(actor, entityId, executor);
    return found.map((l) => (l.from.id === entityId ? l.to.id : l.from.id));
  }

  /** Internal: raw links for a set of ids, no permission filtering. Core use only. */
  async rawLinksFor(entityIds: string[], executor: Executor = this.db) {
    if (entityIds.length === 0) return [];
    return executor
      .select()
      .from(links)
      .where(or(inArray(links.fromId, entityIds), inArray(links.toId, entityIds)));
  }
}
