import { beforeEach, describe, expect, it } from 'vitest';
import { defineManifest, type Actor } from '@platform/contracts';
import { ManifestRegistry } from '../manifest/manifest.registry.js';
import { PermissionService } from './permission.service.js';
import { RegistryService } from '../registry/registry.service.js';
import { AuditService } from '../audit/audit.service.js';
import { auditLog } from '../db/core.schema.js';
import { resetDb, testDb } from '../../test/db.js';

const admin: Actor = { userId: crypto.randomUUID(), role: 'admin' };
const member: Actor = { userId: crypto.randomUUID(), role: 'member' };

function makeManifests() {
  const manifests = new ManifestRegistry();
  manifests.register(
    defineManifest({
      name: 'demo',
      version: '1.0.0',
      entities: [{ type: 'demo_item', displayTemplate: '{title}', urlPattern: '/demo/items/:id' }],
      permissions: [{ capability: 'demo.items.create', description: 'Create demo items.' }],
    }),
  );
  manifests.seal();
  return manifests;
}

async function seedEntity(registry: RegistryService): Promise<string> {
  const id = registry.newId();
  await testDb.transaction((tx) =>
    registry.register(tx, {
      id,
      entityType: 'demo_item',
      displayName: 'thing',
      urlPath: `/demo/items/${id}`,
    }),
  );
  return id;
}

describe('PermissionService', () => {
  beforeEach(resetDb);

  it('grants sight of an existing entity to an authenticated actor', async () => {
    const manifests = makeManifests();
    const permissions = new PermissionService(testDb, manifests);
    const id = await seedEntity(new RegistryService(testDb, manifests));

    expect(await permissions.canSee(member, id)).toBe(true);
  });

  it('denies an entity that does not exist', async () => {
    const permissions = new PermissionService(testDb, makeManifests());
    expect(await permissions.canSee(member, crypto.randomUUID())).toBe(false);
  });

  it('denies an actor with no identity', async () => {
    const manifests = makeManifests();
    const permissions = new PermissionService(testDb, manifests);
    const id = await seedEntity(new RegistryService(testDb, manifests));

    expect(await permissions.canSee({ userId: '', role: 'member' }, id)).toBe(false);
  });

  it('filters a set of ids down to the visible ones', async () => {
    const manifests = makeManifests();
    const registry = new RegistryService(testDb, manifests);
    const permissions = new PermissionService(testDb, manifests);
    const real = await seedEntity(registry);
    const ghost = crypto.randomUUID();

    const visible = await permissions.visibleIds(member, [real, ghost]);
    expect(visible.has(real)).toBe(true);
    expect(visible.has(ghost)).toBe(false);
  });

  it('grants declared capabilities to both roles in v0', async () => {
    const permissions = new PermissionService(testDb, makeManifests());
    expect(await permissions.can(admin, 'demo.items.create')).toBe(true);
    expect(await permissions.can(member, 'demo.items.create')).toBe(true);
  });

  it('throws on an undeclared capability rather than silently denying', async () => {
    // A typo'd capability is a bug. Implicit deny would hide it until someone reports
    // a mysteriously missing button.
    const permissions = new PermissionService(testDb, makeManifests());
    await expect(permissions.can(admin, 'demo.items.destroy')).rejects.toThrow(
      /Unknown capability/,
    );
  });
});

describe('AuditService', () => {
  beforeEach(resetDb);

  it('records a mutation inside the caller’s transaction', async () => {
    const manifests = makeManifests();
    const registry = new RegistryService(testDb, manifests);
    const audit = new AuditService();
    const id = registry.newId();

    await testDb.transaction(async (tx) => {
      await registry.register(tx, {
        id,
        entityType: 'demo_item',
        displayName: 'audited',
        urlPath: `/demo/items/${id}`,
      });
      await audit.record(tx, {
        actorId: null,
        action: 'demo_item.create',
        entityType: 'demo_item',
        entityId: id,
        detail: { title: 'audited' },
      });
    });

    const rows = await testDb.select().from(auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'demo_item.create',
      entityId: id,
      aiInitiated: false,
    });
  });

  it('rolls back with the change it describes', async () => {
    const audit = new AuditService();
    await expect(
      testDb.transaction(async (tx) => {
        await audit.record(tx, {
          action: 'demo_item.create',
          entityType: 'demo_item',
          entityId: crypto.randomUUID(),
        });
        throw new Error('business rule failed');
      }),
    ).rejects.toThrow('business rule failed');

    // An audit entry for a change that never happened would be worse than no log at all.
    expect(await testDb.select().from(auditLog)).toHaveLength(0);
  });

  it('marks AI-initiated mutations for the audit trail', async () => {
    const audit = new AuditService();
    const conversationId = crypto.randomUUID();
    const entityId = crypto.randomUUID();

    await testDb.transaction((tx) =>
      audit.record(tx, {
        action: 'demo_item.create',
        entityType: 'demo_item',
        entityId,
        aiInitiated: true,
        conversationId,
      }),
    );

    const [row] = await testDb.select().from(auditLog);
    expect(row).toMatchObject({ aiInitiated: true, conversationId });
  });
});
