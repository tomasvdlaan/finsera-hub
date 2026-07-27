import { beforeEach, describe, expect, it } from 'vitest';
import { defineManifest } from '@platform/contracts';
import { eq } from 'drizzle-orm';
import { pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { ManifestRegistry } from '../manifest/manifest.registry.js';
import { RegistryService } from './registry.service.js';
import { entities } from '../db/core.schema.js';
import { resetDb, testDb } from '../../test/db.js';

// A stand-in module table, mirroring how a real module stores its own rows.
const fixture = pgSchema('demo');
const fixtureItems = fixture.table('items', {
  id: uuid('id').primaryKey(),
  title: text('title').notNull(),
  createdBy: uuid('created_by').notNull(),
});

function makeRegistry() {
  const manifests = new ManifestRegistry();
  manifests.register(
    defineManifest({
      name: 'demo',
      version: '1.0.0',
      entities: [{ type: 'demo_item', displayTemplate: '{title}', urlPattern: '/demo/items/:id' }],
    }),
  );
  manifests.seal();
  return new RegistryService(testDb, manifests);
}

describe('RegistryService', () => {
  beforeEach(async () => {
    await resetDb();
    await testDb.execute(sql`DELETE FROM demo.items`);
  });

  it('registers an entity and resolves it', async () => {
    const registry = makeRegistry();
    const id = registry.newId();

    await testDb.transaction(async (tx) => {
      await registry.register(tx, {
        id,
        entityType: 'demo_item',
        displayName: 'Build dashboard',
        urlPath: `/demo/items/${id}`,
      });
    });

    const ref = await registry.resolveOne(id);
    expect(ref).toMatchObject({
      id,
      entityType: 'demo_item',
      displayName: 'Build dashboard',
      deleted: false,
    });
  });

  it('derives the owning module from the manifest', async () => {
    const registry = makeRegistry();
    const id = registry.newId();
    await testDb.transaction((tx) =>
      registry.register(tx, {
        id,
        entityType: 'demo_item',
        displayName: 'x',
        urlPath: `/demo/items/${id}`,
      }),
    );

    const [row] = await testDb.select().from(entities).where(eq(entities.id, id));
    expect(row!.owningModule).toBe('demo');
  });

  it('refuses an entity type no manifest declares', async () => {
    const registry = makeRegistry();
    await expect(
      testDb.transaction((tx) =>
        registry.register(tx, {
          entityType: 'ghost_type',
          displayName: 'x',
          urlPath: '/ghost',
        }),
      ),
    ).rejects.toThrow(/Unknown entity type/);
  });

  /**
   * THE core invariant: a module row and its registry entry commit together, or not at
   * all. If this ever fails, entities become invisible to links, timelines, and search.
   */
  it('rolls the registry entry back when the module row fails', async () => {
    const registry = makeRegistry();
    const id = registry.newId();

    await expect(
      testDb.transaction(async (tx) => {
        await registry.register(tx, {
          id,
          entityType: 'demo_item',
          displayName: 'doomed',
          urlPath: `/demo/items/${id}`,
        });
        // created_by is NOT NULL — this insert fails and must take the registry with it
        await tx.insert(fixtureItems).values({ id, title: 'doomed', createdBy: null as never });
      }),
    ).rejects.toThrow();

    expect(await registry.resolveOne(id)).toBeNull();
    const items = await testDb.select().from(fixtureItems).where(eq(fixtureItems.id, id));
    expect(items).toHaveLength(0);
  });

  it('commits the module row and registry entry together', async () => {
    const registry = makeRegistry();
    const id = registry.newId();
    const actor = crypto.randomUUID();

    await testDb.transaction(async (tx) => {
      await registry.register(tx, {
        id,
        entityType: 'demo_item',
        displayName: 'kept',
        urlPath: `/demo/items/${id}`,
      });
      await tx.insert(fixtureItems).values({ id, title: 'kept', createdBy: actor });
    });

    expect(await registry.resolveOne(id)).not.toBeNull();
    const [item] = await testDb.select().from(fixtureItems).where(eq(fixtureItems.id, id));
    expect(item!.title).toBe('kept');
  });

  it('updates display fields and soft-deletes', async () => {
    const registry = makeRegistry();
    const id = registry.newId();
    await testDb.transaction((tx) =>
      registry.register(tx, {
        id,
        entityType: 'demo_item',
        displayName: 'before',
        urlPath: `/demo/items/${id}`,
      }),
    );

    await testDb.transaction((tx) => registry.updateDisplay(tx, id, { displayName: 'after' }));
    expect((await registry.resolveOne(id))?.displayName).toBe('after');

    await testDb.transaction((tx) => registry.softDelete(tx, id));
    const ref = await registry.resolveOne(id);
    expect(ref?.deleted).toBe(true); // still resolvable — links must not dangle
  });

  it('resolves a batch in one query', async () => {
    const registry = makeRegistry();
    const ids = await Promise.all(
      ['a', 'b', 'c'].map(async (name) => {
        const id = registry.newId();
        await testDb.transaction((tx) =>
          registry.register(tx, {
            id,
            entityType: 'demo_item',
            displayName: name,
            urlPath: `/demo/items/${id}`,
          }),
        );
        return id;
      }),
    );

    const refs = await registry.resolve(ids);
    expect(refs.map((r) => r.displayName).sort()).toEqual(['a', 'b', 'c']);
    expect(await registry.resolve([])).toEqual([]);
  });
});
