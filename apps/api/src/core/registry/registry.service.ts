import { Inject, Injectable } from '@nestjs/common';
import type { EntityRef } from '@platform/contracts';
import { and, asc, desc, ilike, inArray, isNull, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DB, type Database, type Executor, type Tx } from '../db/db.module.js';
import { entities } from '../db/core.schema.js';
import { ManifestRegistry } from '../manifest/manifest.registry.js';

export interface RegisterInput {
  /** Optional: pass when the module already minted an id (it should — see newId()). */
  id?: string;
  entityType: string;
  displayName: string;
  urlPath: string;
}

/**
 * The entity registry — one identity for everything (Master §7).
 *
 * INVARIANT: a module's row and its registry entry share one UUID and are written in the
 * SAME transaction. That is why every write here takes a Tx: a module row without a
 * registry entry would be invisible to links, timelines, search, and the AI layer.
 */
@Injectable()
export class RegistryService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly manifests: ManifestRegistry,
  ) {}

  /**
   * Find anything in the platform by name.
   *
   * One query over every entity there is — clients, projects, notes, documents, invoices,
   * quotes, contracts, tasks, sprints — which is possible only because registration is an
   * invariant rather than a convention. Nothing here knows what a client is; it knows that
   * everything is registered, and that is enough.
   *
   * Takes the types it may return rather than working them out. The registry owns identity,
   * not authorisation, and it has no business asking who is calling — the caller decides what
   * this actor may be told exists, and SearchService is where that decision lives.
   */
  async search(query: string, allowedTypes: string[], limit = 20): Promise<EntityRef[]> {
    const q = query.trim();
    if (q.length < 2 || allowedTypes.length === 0) return [];
    const allowed = allowedTypes;

    const rows = await this.db
      .select()
      .from(entities)
      .where(
        and(
          isNull(entities.deletedAt),
          inArray(entities.entityType, allowed),
          ilike(entities.displayName, `%${q}%`),
        ),
      )
      /*
       * A name that starts with what was typed comes first.
       *
       * Without it "Power BI" ranks below "Migrate the Power BI workspace" purely because one
       * was touched more recently, and a command bar whose first result is never the obvious
       * one stops being used.
       */
      .orderBy(desc(sql`${entities.displayName} ILIKE ${q + '%'}`), asc(entities.displayName))
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      entityType: r.entityType,
      displayName: r.displayName,
      urlPath: r.urlPath,
      deleted: false,
    }));
  }


  /** Mint an id before inserting, so the module row and registry entry can share it. */
  newId(): string {
    return uuidv7();
  }

  /**
   * Register an entity. The owning module is derived from the manifests, so an entity
   * type nobody declared cannot be registered — the registry stays consistent with the
   * declared architecture rather than with whatever a module happened to write.
   */
  async register(tx: Tx, input: RegisterInput): Promise<string> {
    const owningModule = this.manifests.ownerOfEntityType(input.entityType);
    if (!owningModule) {
      throw new Error(
        `Unknown entity type '${input.entityType}' — declare it in the owning module's manifest.`,
      );
    }

    const id = input.id ?? this.newId();
    await tx.insert(entities).values({
      id,
      entityType: input.entityType,
      owningModule,
      displayName: input.displayName,
      urlPath: input.urlPath,
    });
    return id;
  }

  /** Keep the denormalized display fields in step with the module's own row. */
  async updateDisplay(
    tx: Tx,
    id: string,
    patch: { displayName?: string; urlPath?: string },
  ): Promise<void> {
    await tx
      .update(entities)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(entities.id, id));
  }

  /** Soft delete — links to a deleted entity still resolve, and render as deleted. */
  async softDelete(tx: Tx, id: string): Promise<void> {
    await tx.update(entities).set({ deletedAt: new Date() }).where(eq(entities.id, id));
  }

  /** Batch resolve: one query for a page full of links, not one per link. */
  async resolve(ids: string[], executor: Executor = this.db): Promise<EntityRef[]> {
    if (ids.length === 0) return [];
    const rows = await executor.select().from(entities).where(inArray(entities.id, ids));
    return rows.map((r) => ({
      id: r.id,
      entityType: r.entityType,
      displayName: r.displayName,
      urlPath: r.urlPath,
      deleted: r.deletedAt !== null,
    }));
  }

  async resolveOne(id: string, executor: Executor = this.db): Promise<EntityRef | null> {
    const [ref] = await this.resolve([id], executor);
    return ref ?? null;
  }
}
