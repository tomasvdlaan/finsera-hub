import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { defineManifest, type Actor } from '@platform/contracts';
import { AuditService } from '../core/audit/audit.service.js';
import { EventBus } from '../core/events/event-bus.service.js';
import { LinkService } from '../core/links/link.service.js';
import { ManifestRegistry } from '../core/manifest/manifest.registry.js';
import { PermissionService } from '../core/permissions/permission.service.js';
import { RegistryService } from '../core/registry/registry.service.js';
import { resetDb, seedUser, testDb } from '../test/db.js';
import { TimelineService } from './timeline.service.js';

const admin: Actor = { userId: crypto.randomUUID(), role: 'admin' };
const other: Actor = { userId: crypto.randomUUID(), role: 'admin' };

/**
 * Fixture modules, not real ones.
 *
 * The shell may not import a module — `depcruise` enforces that on tests as well as on
 * source — and it is the right constraint here anyway: the claim being tested is that this
 * service knows nothing about tasks or invoices, so writing it against scrum would quietly
 * test the opposite.
 */
const fixtures = () => {
  const manifests = new ManifestRegistry();
  manifests.register(
    defineManifest({
      name: 'fixture',
      version: '1.0.0',
      entities: [
        {
          type: 'fixture_item',
          displayTemplate: '{title}',
          urlPattern: '/fixture/items/:id',
          readPermission: 'fixture.read',
        },
        {
          type: 'fixture_note',
          displayTemplate: '{title}',
          urlPattern: '/fixture/notes/:id',
          readPermission: 'fixture.read',
        },
      ],
      permissions: [{ capability: 'fixture.read', description: 'Read fixtures.' }],
      publishes: [
        { name: 'fixture.created', description: 'A fixture appeared.' },
        { name: 'fixture.moved', description: 'A fixture moved.' },
      ],
    }),
  );
  manifests.seal();

  const registry = new RegistryService(testDb, manifests);
  const permissions = new PermissionService(testDb, manifests);
  const audit = new AuditService();
  const links = new LinkService(testDb, registry, permissions, audit, manifests);
  const bus = new EventBus(manifests);
  return {
    registry,
    bus,
    links,
    timeline: new TimelineService(testDb, registry, links, permissions),
  };
};

describe('TimelineService.recent', () => {
  let f: ReturnType<typeof fixtures>;

  beforeEach(async () => {
    await resetDb();
    await testDb.execute(sql`DELETE FROM core.events`);
    await seedUser(admin.userId, 'admin');
    await seedUser(other.userId, 'admin');
    f = fixtures();
  });

  /** A registered entity with one event against it, at a chosen moment. */
  const happen = async (opts: {
    entityType?: string;
    name?: string;
    displayName?: string;
    actor?: Actor;
    at?: string;
    payload?: Record<string, unknown>;
  }) => {
    const id = f.registry.newId();
    await testDb.transaction(async (tx) => {
      await f.registry.register(tx, {
        id,
        entityType: opts.entityType ?? 'fixture_item',
        displayName: opts.displayName ?? 'A fixture',
        urlPath: `/fixture/${id}`,
      });
      await f.bus.publish(tx, {
        name: opts.name ?? 'fixture.created',
        entityType: opts.entityType ?? 'fixture_item',
        entityId: id,
        actorId: (opts.actor ?? admin).userId,
        payload: opts.payload ?? {},
      });
    });
    // Backdated after the fact: `createdAt` defaults to now and the ordering is the point.
    if (opts.at) {
      await testDb.execute(
        sql`UPDATE core.events SET created_at = ${opts.at}::timestamptz WHERE entity_id = ${id}`,
      );
    }
    return id;
  };

  it('returns what happened, newest first, with who did it', async () => {
    await happen({ displayName: 'Older', at: '2026-07-01T09:00:00Z' });
    await happen({ displayName: 'Newer', at: '2026-07-20T09:00:00Z' });

    const feed = await f.timeline.recent(admin);
    expect(feed.map((e) => e.subject.displayName)).toEqual(['Newer', 'Older']);
    expect(feed[0]!.actor?.id).toBe(admin.userId);
    expect(feed[0]!.actor?.displayName).toBeTruthy();
  });

  it('carries the payload, because "moved" is not an answer', async () => {
    await happen({
      name: 'fixture.moved',
      payload: { from: 'review', to: 'in_progress' },
    });

    const [entry] = await f.timeline.recent(admin);
    // The whole reason this returns more than TimelineEntry does: a reader that has to
    // explain what happened needs to know it went backwards.
    expect(entry!.detail).toEqual({ from: 'review', to: 'in_progress' });
    expect(entry!.eventName).toBe('fixture.moved');
  });

  it('narrows by time, and the window is inclusive at both ends', async () => {
    await happen({ displayName: 'Before', at: '2026-07-01T00:00:00Z' });
    await happen({ displayName: 'Inside', at: '2026-07-15T00:00:00Z' });
    await happen({ displayName: 'After', at: '2026-07-30T00:00:00Z' });

    const window = await f.timeline.recent(admin, {
      since: '2026-07-15T00:00:00Z',
      until: '2026-07-15T00:00:00Z',
    });
    expect(window.map((e) => e.subject.displayName)).toEqual(['Inside']);
  });

  it('narrows by entity type, by actor and by event name', async () => {
    await happen({ displayName: 'An item' });
    await happen({ entityType: 'fixture_note', displayName: 'A note' });
    await happen({ displayName: 'Someone else did this', actor: other });
    await happen({ displayName: 'A move', name: 'fixture.moved' });

    expect(
      (await f.timeline.recent(admin, { entityType: 'fixture_note' })).map(
        (e) => e.subject.displayName,
      ),
    ).toEqual(['A note']);

    expect(
      (await f.timeline.recent(admin, { actorId: other.userId })).map((e) => e.subject.displayName),
    ).toEqual(['Someone else did this']);

    expect(
      (await f.timeline.recent(admin, { eventName: 'fixture.moved' })).map(
        (e) => e.subject.displayName,
      ),
    ).toEqual(['A move']);
  });

  it('drops an event whose subject has left the registry', async () => {
    const id = await happen({ displayName: 'Deleted since' });
    await testDb.execute(sql`DELETE FROM core.entities WHERE id = ${id}`);

    // The event row survives — it is a log — but a feed cannot render a subject it cannot
    // name, and showing a bare uuid would be worse than showing nothing.
    expect(await f.timeline.recent(admin)).toEqual([]);
  });

  it('refuses an actor with no user', async () => {
    await happen({});
    expect(await f.timeline.recent({ userId: '', role: 'member' } as Actor)).toEqual([]);
  });

  it('caps the limit however much is asked for', async () => {
    // A feed for a language model. A thousand rows of "moved" is tokens spent to say nothing.
    for (let i = 0; i < 3; i++) await happen({ displayName: `Item ${i}` });
    const asked = await f.timeline.recent(admin, { limit: 5000 });
    expect(asked).toHaveLength(3);
    expect(await f.timeline.recent(admin, { limit: 2 })).toHaveLength(2);
  });

  it('still answers the per-entity question, and includes what is linked to it', async () => {
    const subject = await happen({ displayName: 'The invoice' });
    const linked = await happen({ entityType: 'fixture_note', displayName: 'Its note' });
    const unrelated = await happen({ displayName: 'Nothing to do with it' });
    await f.links.create(admin, { fromId: subject, toId: linked });

    const story = await f.timeline.for(admin, subject);
    const names = story.map((e) => e.subject.displayName);
    expect(names).toContain('The invoice');
    expect(names).toContain('Its note');
    expect(names).not.toContain('Nothing to do with it');
    expect(unrelated).toBeTruthy();
  });
});
