import { beforeEach, describe, expect, it } from 'vitest';
import { defineManifest, type Actor } from '@platform/contracts';
import { ManifestRegistry } from '../manifest/manifest.registry.js';
import { AuditService } from '../audit/audit.service.js';
import { PermissionService } from '../permissions/permission.service.js';
import { RegistryService } from '../registry/registry.service.js';
import { LinkService } from './link.service.js';
import { auditLog, links } from '../db/core.schema.js';
import { resetDb, seedUser, testDb } from '../../test/db.js';

const actor: Actor = { userId: crypto.randomUUID(), role: 'member' };

function manifests() {
  const m = new ManifestRegistry();
  m.register(
    defineManifest({
      name: 'demo',
      version: '1.0.0',
      entities: [
        { type: 'demo_item', displayTemplate: '{title}', urlPattern: '/demo/items/:id', readPermission: 'demo.items.read' },
        { type: 'demo_secret', displayTemplate: '{title}', urlPattern: '/demo/secrets/:id', readPermission: 'demo.items.read' },
      ],
      permissions: [{ capability: 'demo.items.read', description: 'Read demo items.' }],
      structuralRefs: [
        // Required one way and not the other, so the rule is tested where it fires and
        // where it must not.
        { from: 'demo_item', toType: 'demo_secret', required: true },
        { from: 'demo_secret', toType: 'demo_item', required: false },
      ],
    }),
  );
  m.seal();
  return m;
}

/**
 * v0 permission policy is deliberately permissive, so testing "a link is visible only if
 * both endpoints are" against it would prove nothing. This stub denies specific ids,
 * exercising the RULE in LinkService independently of today's POLICY — which is what
 * has to keep holding when Phase 1 tightens canSee().
 */
class RestrictedPermissions extends PermissionService {
  constructor(
    private readonly hidden: Set<string>,
    m: ManifestRegistry,
  ) {
    super(testDb, m);
  }
  override async canSee(a: Actor, entityId: string): Promise<boolean> {
    if (this.hidden.has(entityId)) return false;
    return super.canSee(a, entityId);
  }
  override async visibleIds(a: Actor, ids: string[]): Promise<Set<string>> {
    const visible = await super.visibleIds(a, ids);
    for (const id of this.hidden) visible.delete(id);
    return visible;
  }
}

function build(hidden = new Set<string>()) {
  const m = manifests();
  const registry = new RegistryService(testDb, m);
  const permissions = new RestrictedPermissions(hidden, m);
  const links = new LinkService(testDb, registry, permissions, new AuditService(), m);
  return { registry, links };
}

async function seed(registry: RegistryService, type = 'demo_item', name = 'thing') {
  const id = registry.newId();
  await testDb.transaction((tx) =>
    registry.register(tx, { id, entityType: type, displayName: name, urlPath: `/demo/${id}` }),
  );
  return id;
}

describe('LinkService', () => {
  beforeEach(async () => {
    await resetDb();
    await seedUser(actor.userId);
  });

  it('links two entities with a semantic kind', async () => {
    const { registry, links: svc } = build();
    const meeting = await seed(registry, 'demo_item', 'Kickoff meeting');
    const client = await seed(registry, 'demo_item', 'De Chocolaterie');

    const link = await svc.create(actor, { fromId: meeting, toId: client, kind: 'about' });

    expect(link).toMatchObject({ kind: 'about' });
    expect(link.from.displayName).toBe('Kickoff meeting');
    expect(link.to.displayName).toBe('De Chocolaterie');
  });

  it('reads links in both directions', async () => {
    const { registry, links: svc } = build();
    const a = await seed(registry, 'demo_item', 'A');
    const b = await seed(registry, 'demo_item', 'B');
    await svc.create(actor, { fromId: a, toId: b, kind: 'about' });

    // Stored one-directional, queried both ways — B must see its link to A.
    expect(await svc.listFor(actor, a)).toHaveLength(1);
    expect(await svc.listFor(actor, b)).toHaveLength(1);
  });

  it('deduplicates rather than stacking identical links', async () => {
    const { registry, links: svc } = build();
    const a = await seed(registry);
    const b = await seed(registry);

    const first = await svc.create(actor, { fromId: a, toId: b });
    const second = await svc.create(actor, { fromId: a, toId: b });

    // Postgres treats NULL kinds as distinct in a UNIQUE index, so this is enforced
    // in code — without it, clicking "link" twice would create two rows.
    expect(second.id).toBe(first.id);
    expect(await testDb.select().from(links)).toHaveLength(1);
  });

  it('allows the same pair under different kinds', async () => {
    const { registry, links: svc } = build();
    const a = await seed(registry);
    const b = await seed(registry);

    await svc.create(actor, { fromId: a, toId: b, kind: 'about' });
    await svc.create(actor, { fromId: a, toId: b, kind: 'discussed' });

    expect(await testDb.select().from(links)).toHaveLength(2);
  });

  it('refuses to link an entity to itself', async () => {
    const { registry, links: svc } = build();
    const a = await seed(registry);
    await expect(svc.create(actor, { fromId: a, toId: a })).rejects.toThrow();
  });

  it('refuses to link an entity that is not registered', async () => {
    const { registry, links: svc } = build();
    const a = await seed(registry);
    await expect(svc.create(actor, { fromId: a, toId: crypto.randomUUID() })).rejects.toThrow();
  });

  // ── the rule that prevents data leaks (Master §15.6) ──

  it('refuses to CREATE a link when an endpoint is invisible', async () => {
    const secret = crypto.randomUUID();
    const { registry, links: svc } = build(new Set([secret]));
    const visible = await seed(registry);
    // register the secret so it exists, but keep it hidden from this actor
    await testDb.transaction((tx) =>
      registry.register(tx, {
        id: secret,
        entityType: 'demo_secret',
        displayName: 'Finance-only contract',
        urlPath: `/demo/secrets/${secret}`,
      }),
    );

    await expect(svc.create(actor, { fromId: visible, toId: secret })).rejects.toThrow(
      /Cannot link/,
    );
  });

  it('hides a link whose other endpoint is invisible', async () => {
    const { registry, links: svc } = build();
    const meeting = await seed(registry, 'demo_item', 'Meeting');
    const secret = await seed(registry, 'demo_secret', 'Finance-only contract');
    await svc.create(actor, { fromId: meeting, toId: secret, kind: 'discussed' });

    // Same data, an actor who may not see the contract: the link must vanish entirely.
    // Leaking its existence would disclose that the contract exists and is related.
    const { links: restricted } = build(new Set([secret]));
    expect(await restricted.listFor(actor, meeting)).toHaveLength(0);
  });

  it('returns nothing for an entity the actor cannot see', async () => {
    const { registry, links: svc } = build();
    const a = await seed(registry);
    const b = await seed(registry);
    await svc.create(actor, { fromId: a, toId: b });

    const { links: restricted } = build(new Set([a]));
    expect(await restricted.listFor(actor, a)).toEqual([]);
  });

  it('refuses to REMOVE a link when an endpoint is invisible', async () => {
    const { registry, links: svc } = build();
    const a = await seed(registry);
    const b = await seed(registry);
    const link = await svc.create(actor, { fromId: a, toId: b });

    const { links: restricted } = build(new Set([b]));
    await expect(restricted.remove(actor, link.id)).rejects.toThrow(/Cannot remove/);
    expect(await testDb.select().from(links)).toHaveLength(1);
  });

  it('refuses to remove a reference a manifest declares required', async () => {
    const { registry, links } = build();
    const item = await seed(registry, 'demo_item', 'A task');
    const secret = await seed(registry, 'demo_secret', 'Its project');
    const link = await links.create(actor, { fromId: item, toId: secret, kind: 'belongs_to' });

    // Required means structural. Removing it dropped the child out of its parent's and its
    // client's timelines silently, and nothing could restore it — the link picker offers
    // only optional kinds, so the relationship was unrecreatable through the UI.
    await expect(links.remove(actor, link.id)).rejects.toThrow(/cannot be removed/);
    expect(await links.listFor(actor, item)).toHaveLength(1);
  });

  it('still removes a reference declared optional', async () => {
    const { registry, links } = build();
    const item = await seed(registry, 'demo_item', 'A task');
    const secret = await seed(registry, 'demo_secret', 'Its project');
    // The same pair declared the other way round is optional — so the guard has to read the
    // direction, not merely notice that a declaration exists for these two types.
    const link = await links.create(actor, { fromId: secret, toId: item, kind: 'mentions' });

    await links.remove(actor, link.id);
    expect(await links.listFor(actor, item)).toHaveLength(0);
  });


  it('audits creation and removal', async () => {
    const { registry, links: svc } = build();
    const a = await seed(registry);
    const b = await seed(registry);

    const link = await svc.create(actor, { fromId: a, toId: b, kind: 'about' });
    await svc.remove(actor, link.id);

    const actions = (await testDb.select().from(auditLog)).map((r) => r.action).sort();
    expect(actions).toEqual(['link.create', 'link.delete']);
    expect(await testDb.select().from(links)).toHaveLength(0);
  });

  it('exposes linked ids for the timeline, permission-filtered', async () => {
    const { registry, links: svc } = build();
    const hub = await seed(registry, 'demo_item', 'Project');
    const visible = await seed(registry, 'demo_item', 'Task');
    const secret = await seed(registry, 'demo_secret', 'Contract');
    await svc.create(actor, { fromId: hub, toId: visible });
    await svc.create(actor, { fromId: hub, toId: secret });

    const { links: restricted } = build(new Set([secret]));
    expect(await restricted.linkedIds(actor, hub)).toEqual([visible]);
  });
});
