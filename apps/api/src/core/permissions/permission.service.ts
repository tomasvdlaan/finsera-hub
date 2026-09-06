import { Inject, Injectable, ForbiddenException } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { eq, inArray } from 'drizzle-orm';
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
   * Does this entity exist and is this actor entitled to reach it at all?
   *
   * Reachability, not readability — and the distinction is load-bearing. Whether a *record*
   * may be READ is decided by `visibleIds` below, which is what every listing goes through.
   * This one guards the write paths, chiefly linking: a module registers an entity and links
   * it to its project in the same transaction, so an owner must be able to reach a record
   * whose type they may not read in general. Logging your own hours is exactly that, and
   * making this type-aware broke it — the link refused, so the entry could not be created.
   *
   * Still permissive about *which* records: record-level scoping remains the open v0
   * promise, and nothing here narrows a project to its team.
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

  /**
   * Filter a set of entity ids down to those the actor may READ, in one pass.
   *
   * Every listing that reaches entities indirectly comes through here — the activity feed,
   * related records, the assistant's references — and each id is now judged by the
   * `readPermission` its type's module declared, the same rule search has always applied to
   * its own results.
   *
   * It used to answer "which of these exist", which meant a member watched every colleague's
   * timer start and stop in the feed — `running — client work`, under their name — while the
   * API refused them those same hours at the endpoint. The capability was declared and simply
   * never consulted.
   *
   * Type-level, so it cannot say "yours". An entry of your own is hidden here too, and the
   * Time page — which knows about ownership — is where your hours are shown in full.
   */
  async visibleIds(actor: Actor, ids: string[], executor: Executor = this.db): Promise<Set<string>> {
    if (!actor?.userId || ids.length === 0) return new Set();
    // Scoped to the ids asked about. This read every row in `core.entities` to answer a
    // question about a page of twenty, which was survivable only while the table was small.
    const rows = await executor
      .select({ id: entities.id, entityType: entities.entityType })
      .from(entities)
      .where(inArray(entities.id, ids));

    // One capability check per distinct type rather than per row: a feed of forty events is
    // four or five types.
    const byType = new Map<string, boolean>();
    const visible = new Set<string>();
    for (const row of rows) {
      if (!byType.has(row.entityType)) {
        byType.set(row.entityType, await this.mayReadType(actor, row.entityType));
      }
      if (byType.get(row.entityType)) visible.add(row.id);
    }
    return visible;
  }

  /**
   * The capability that governs a type, per its manifest.
   *
   * An undeclared type cannot occur — `RegistryService.register` refuses one — so reaching
   * here means the manifest that owned it is gone, and hiding the orphan is the only answer
   * that is not a guess.
   */
  private async mayReadType(actor: Actor, entityType: string): Promise<boolean> {
    const declared = this.manifests
      .all()
      .flatMap((m) => m.entities)
      .find((e) => e.type === entityType);
    return declared ? await this.can(actor, declared.readPermission) : false;
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

  /**
   * `can`, but it throws.
   *
   * Every module service had written this same three-line private helper — check, throw a
   * ForbiddenException naming the capability. Eight copies of a security check is eight places
   * for one of them to drift into `return` where the others `throw`.
   */
  async require(actor: Actor, capability: string): Promise<void> {
    if (!(await this.can(actor, capability))) {
      throw new ForbiddenException(`Missing capability '${capability}'`);
    }
  }
}
