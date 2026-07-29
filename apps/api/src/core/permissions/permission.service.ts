import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { eq } from 'drizzle-orm';
import { DB, type Database, type Executor } from '../db/db.module.js';
import { entities } from '../db/core.schema.js';
import { ManifestRegistry } from '../manifest/manifest.registry.js';

/**
 * Permissions (Master §12).
 *
 * The POLICY here is deliberately permissive in v0 — record-level access arrives with
 * CRM in Phase 1, once there are clients and projects to scope by. The CALL PATH is
 * complete from day one: every read routes through canSee(), every capability through
 * can(). Tightening later changes this file, not its callers.
 *
 * This is also what makes "the assistant is the user" enforceable — the AI orchestrator
 * calls the same methods with the same Actor, never a privileged service account.
 */
@Injectable()
export class PermissionService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly manifests: ManifestRegistry,
  ) {}

  /**
   * May this actor see this entity?
   *
   * v0: any active user may see any existing entity. Phase 1 replaces the body with
   * "resolve the entity's client/project and check team membership".
   */
  async canSee(actor: Actor, entityId: string, executor: Executor = this.db): Promise<boolean> {
    if (!actor?.userId) return false;
    const [row] = await executor
      .select({ id: entities.id })
      .from(entities)
      .where(eq(entities.id, entityId))
      .limit(1);
    return row !== undefined;
  }

  /** Filter a set of entity ids down to those the actor may see, in one pass. */
  async visibleIds(actor: Actor, ids: string[], executor: Executor = this.db): Promise<Set<string>> {
    if (!actor?.userId || ids.length === 0) return new Set();
    const rows = await executor.select({ id: entities.id }).from(entities);
    const existing = new Set(rows.map((r) => r.id));
    return new Set(ids.filter((id) => existing.has(id)));
  }

  /**
   * Does this actor hold a capability (e.g. 'demo.items.create')?
   *
   * v0: admins hold everything; members hold every capability a module declared. The
   * capability must be declared in some manifest — an undeclared one is a bug, not an
   * implicit deny, so it throws rather than silently returning false.
   */
  async can(actor: Actor, capability: string): Promise<boolean> {
    if (!actor?.userId) return false;

    const declared = this.manifests
      .all()
      .flatMap((m) => m.permissions)
      .find((p) => p.capability === capability);
    if (!declared) {
      throw new Error(
        `Unknown capability '${capability}' — declare it in the owning module's manifest.`,
      );
    }

    if (actor.role === 'admin') return true;
    // A capability may opt out of the members-hold-everything default. Reserved for the
    // few whose blast radius reaches outside the business, such as granting a client a login.
    return actor.role === 'member' && !declared.adminOnly;
  }
}
