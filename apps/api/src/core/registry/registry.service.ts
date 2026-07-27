import { Inject, Injectable } from '@nestjs/common';
import type { EntityRef } from '@platform/contracts';
import { inArray, eq } from 'drizzle-orm';
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
