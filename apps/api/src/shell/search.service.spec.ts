import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { defineManifest, type Actor } from '@platform/contracts';
import { ManifestRegistry } from '../core/manifest/manifest.registry.js';
import { PermissionService } from '../core/permissions/permission.service.js';
import { RegistryService } from '../core/registry/registry.service.js';
import { resetDb, seedUser, testDb } from '../test/db.js';
import { SearchService } from './search.service.js';

const admin: Actor = { userId: crypto.randomUUID(), role: 'admin' };

/**
 * Fixture modules, not real ones.
 *
 * The shell may not import a module — it composes what modules declare and nothing else, and
 * `depcruise` enforces that on tests as well as on source. Which is just as well here: the
 * point of this service is that it knows nothing about clients or invoices, so a test written
 * against the CRM would be quietly testing the opposite of the claim.
 */
const fixtures = () => {
  const manifests = new ManifestRegistry();
  manifests.register(
    defineManifest({
      name: 'fixture',
      version: '1.0.0',
      entities: [
        { type: 'fixture_item', displayTemplate: '{title}', urlPattern: '/fixture/items/:id', readPermission: 'fixture.read' },
        { type: 'fixture_note', displayTemplate: '{title}', urlPattern: '/fixture/notes/:id', readPermission: 'fixture.notes.read' },
      ],
      permissions: [
        { capability: 'fixture.read', description: 'Read fixture items.' },
        { capability: 'fixture.notes.read', description: 'Read fixture notes.' },
      ],
    }),
  );
  manifests.seal();

  const registry = new RegistryService(testDb, manifests);
  const permissions = new PermissionService(testDb, manifests);
  return { registry, permissions, manifests, search: new SearchService(registry, manifests, permissions) };
};

describe('SearchService', () => {
  let f: ReturnType<typeof fixtures>;

  beforeEach(async () => {
    await resetDb();
    await testDb.execute(sql`DELETE FROM fixture.items`);
    await seedUser(admin.userId, 'admin');
    f = fixtures();
  });

  /** Register something findable, without any module being involved. */
  const seed = async (entityType: string, displayName: string) => {
    const id = f.registry.newId();
    await testDb.transaction(async (tx) => {
      await f.registry.register(tx, { id, entityType, displayName, urlPath: `/fixture/${id}` });
    });
    return id;
  };

  it('finds an entity by part of its name', async () => {
    await seed('fixture_item', 'Vandenberg Logistics');
    const found = await f.search.find(admin, 'vandenberg');

    expect(found).toHaveLength(1);
    expect(found[0]!.displayName).toBe('Vandenberg Logistics');
    // The URL is what the command bar navigates to, so it has to come back with the hit.
    expect(found[0]!.urlPath).toContain('/fixture/');
    expect(found[0]!.entityType).toBe('fixture_item');
  });

  it('matches case-insensitively and in the middle of a name', async () => {
    await seed('fixture_item', 'Gemeente Rotterdam');
    expect(await f.search.find(admin, 'ROTTER')).toHaveLength(1);
  });

  /**
   * One query, every kind of thing.
   *
   * This is the whole reason the search sits on the registry rather than in the modules: it
   * can be written once because registration is an invariant, and nothing in it knows what
   * any of these things are.
   */
  it('returns different kinds of thing together', async () => {
    await seed('fixture_item', 'Northwind data platform');
    await seed('fixture_note', 'Northwind kick-off');

    const found = await f.search.find(admin, 'northwind');
    expect(found.map((r) => r.entityType).sort()).toEqual(['fixture_item', 'fixture_note']);
  });

  /**
   * A name that begins with what was typed comes first.
   *
   * Without it the thing you are looking for can sit below a longer name that merely contains
   * it, and a command bar whose first result is never the obvious one stops being used.
   */
  it('ranks a prefix match above a mere containment', async () => {
    await seed('fixture_item', 'Migrate the Power BI workspace');
    await seed('fixture_item', 'Power BI Consultancy');

    const found = await f.search.find(admin, 'power bi');
    expect(found[0]!.displayName).toBe('Power BI Consultancy');
  });

  it('ignores a query too short to mean anything', async () => {
    await seed('fixture_item', 'Vandenberg Logistics');
    // One letter matches most of the database and is almost always a keystroke in passing.
    expect(await f.search.find(admin, 'v')).toEqual([]);
  });

  it('does not return a deleted entity', async () => {
    const id = await seed('fixture_item', 'Gone Away BV');
    await testDb.transaction(async (tx) => f.registry.softDelete(tx, id));
    expect(await f.search.find(admin, 'Gone Away')).toEqual([]);
  });

  /**
   * What you may not read, you may not be told exists.
   *
   * Every entity in the platform is in one table, so a search over it without this would
   * answer "is there a client called X" for anybody who can reach the endpoint. The leak is
   * small and total: you cannot un-tell someone that a name exists.
   */
  it('returns nothing from a type the actor may not read', async () => {
    await seed('fixture_item', 'Vandenberg Logistics');
    await seed('fixture_note', 'Vandenberg kick-off');

    // Stand in for a future permission model by refusing one capability outright.
    f.permissions.can = async (_actor, capability) => capability !== 'fixture.read';

    const found = await f.search.find(admin, 'vandenberg');
    expect(found.map((r) => r.entityType)).toEqual(['fixture_note']);
  });

  it('returns nothing at all when the actor may read nothing', async () => {
    await seed('fixture_item', 'Vandenberg Logistics');
    f.permissions.can = async () => false;
    expect(await f.search.find(admin, 'vandenberg')).toEqual([]);
  });
});
