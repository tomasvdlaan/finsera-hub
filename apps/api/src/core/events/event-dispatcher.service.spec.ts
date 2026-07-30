import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineManifest } from '@platform/contracts';
import { eq } from 'drizzle-orm';
import { ManifestRegistry } from '../manifest/manifest.registry.js';
import { EventBus } from './event-bus.service.js';
import { EventDispatcher } from './event-dispatcher.service.js';
import { EventHandlerRegistry } from './event-handler.registry.js';
import { eventDeliveries, events } from '../db/core.schema.js';
import { resetDb, testDb } from '../../test/db.js';

function manifests() {
  const m = new ManifestRegistry();
  m.register(
    defineManifest({
      name: 'demo',
      version: '1.0.0',
      entities: [{ type: 'demo_item', displayTemplate: '{t}', urlPattern: '/demo/:id', readPermission: 'demo.items.read' }],
      permissions: [{ capability: 'demo.items.read', description: 'Read demo items.' }],
      publishes: [{ name: 'demo_item.created', description: 'created' }],
      subscribes: [{ event: 'demo_item.created', handler: 'onItemCreated' }],
    }),
  );
  m.register(
    defineManifest({
      name: 'watcher',
      version: '1.0.0',
      subscribes: [{ event: 'demo_item.created', handler: 'onAnyItem' }],
    }),
  );
  m.seal();
  return m;
}

function build() {
  const m = manifests();
  const handlers = new EventHandlerRegistry();
  const bus = new EventBus(m);
  const dispatcher = new EventDispatcher(testDb, bus, m, handlers);
  return { bus, dispatcher, handlers };
}

const publish = (bus: EventBus, entityId = crypto.randomUUID()) =>
  testDb.transaction((tx) =>
    bus.publish(tx, {
      name: 'demo_item.created',
      entityType: 'demo_item',
      entityId,
      payload: { title: 'hello' },
    }),
  );

describe('EventBus', () => {
  beforeEach(resetDb);

  it('writes the event inside the caller’s transaction', async () => {
    const { bus } = build();
    await publish(bus);
    expect(await testDb.select().from(events)).toHaveLength(1);
  });

  it('discards the event when the transaction rolls back', async () => {
    const { bus } = build();
    await expect(
      testDb.transaction(async (tx) => {
        await bus.publish(tx, {
          name: 'demo_item.created',
          entityType: 'demo_item',
          entityId: crypto.randomUUID(),
        });
        throw new Error('business rule failed');
      }),
    ).rejects.toThrow();

    // An event announcing a change that never happened would corrupt every subscriber.
    expect(await testDb.select().from(events)).toHaveLength(0);
  });

  it('refuses an event no manifest declares', async () => {
    const { bus } = build();
    await expect(
      testDb.transaction((tx) =>
        bus.publish(tx, {
          name: 'ghost.happened',
          entityType: 'demo_item',
          entityId: crypto.randomUUID(),
        }),
      ),
    ).rejects.toThrow(/Undeclared event/);
  });
});

describe('EventDispatcher', () => {
  beforeEach(resetDb);

  it('fans out to every declared subscriber', async () => {
    const { bus, dispatcher, handlers } = build();
    const demo = vi.fn();
    const watcher = vi.fn();
    handlers.bind('demo', 'onItemCreated', demo);
    handlers.bind('watcher', 'onAnyItem', watcher);

    await publish(bus);
    await dispatcher.drain();

    expect(demo).toHaveBeenCalledOnce();
    expect(watcher).toHaveBeenCalledOnce();
    const rows = await testDb.select().from(eventDeliveries);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'done')).toBe(true);
  });

  it('passes the event context through to the handler', async () => {
    const { bus, dispatcher, handlers } = build();
    const entityId = crypto.randomUUID();
    let seen: unknown;
    handlers.bind('demo', 'onItemCreated', (ctx) => {
      seen = ctx;
    });
    handlers.bind('watcher', 'onAnyItem', () => {});

    await publish(bus, entityId);
    await dispatcher.drain();

    expect(seen).toMatchObject({
      eventName: 'demo_item.created',
      entityType: 'demo_item',
      entityId,
      payload: { title: 'hello' },
    });
  });

  it('does not redeliver an event it already handled', async () => {
    const { bus, dispatcher, handlers } = build();
    const demo = vi.fn();
    handlers.bind('demo', 'onItemCreated', demo);
    handlers.bind('watcher', 'onAnyItem', () => {});

    await publish(bus);
    await dispatcher.drain();
    await dispatcher.drain();
    await dispatcher.drain();

    expect(demo).toHaveBeenCalledOnce();
  });

  it('isolates a failing subscriber from a healthy one', async () => {
    const { bus, dispatcher, handlers } = build();
    const healthy = vi.fn();
    handlers.bind('demo', 'onItemCreated', () => {
      throw new Error('boom');
    });
    handlers.bind('watcher', 'onAnyItem', healthy);

    await publish(bus);
    await dispatcher.drain();

    // One module's bug must not stop another module from seeing the event.
    expect(healthy).toHaveBeenCalledOnce();
    const rows = await testDb.select().from(eventDeliveries);
    expect(rows.find((r) => r.subscriber === 'watcher.onAnyItem')!.status).toBe('done');
    expect(rows.find((r) => r.subscriber === 'demo.onItemCreated')!.status).toBe('failed');
  });

  it('retries a failure and dead-letters after 5 attempts', async () => {
    const { bus, dispatcher, handlers } = build();
    const flaky = vi.fn(() => {
      throw new Error('still broken');
    });
    handlers.bind('demo', 'onItemCreated', flaky);
    handlers.bind('watcher', 'onAnyItem', () => {});

    await publish(bus);
    for (let i = 0; i < 6; i++) await dispatcher.drain();

    expect(flaky).toHaveBeenCalledTimes(5);
    const [row] = await testDb
      .select()
      .from(eventDeliveries)
      .where(eq(eventDeliveries.subscriber, 'demo.onItemCreated'));
    expect(row).toMatchObject({ status: 'dead', attempts: 5 });
    expect(row!.lastError).toContain('still broken');
    expect(await dispatcher.deadLetters()).toHaveLength(1);
  });

  it('recovers a transient failure on a later cycle', async () => {
    const { bus, dispatcher, handlers } = build();
    let calls = 0;
    handlers.bind('demo', 'onItemCreated', () => {
      if (++calls === 1) throw new Error('transient');
    });
    handlers.bind('watcher', 'onAnyItem', () => {});

    await publish(bus);
    await dispatcher.drain();
    await dispatcher.drain();

    const [row] = await testDb
      .select()
      .from(eventDeliveries)
      .where(eq(eventDeliveries.subscriber, 'demo.onItemCreated'));
    expect(row!.status).toBe('done');
  });

  it('replays dead letters after the cause is fixed', async () => {
    const { bus, dispatcher, handlers } = build();
    let broken = true;
    handlers.bind('demo', 'onItemCreated', () => {
      if (broken) throw new Error('broken');
    });
    handlers.bind('watcher', 'onAnyItem', () => {});

    const eventId = await publish(bus);
    for (let i = 0; i < 6; i++) await dispatcher.drain();
    expect((await dispatcher.deadLetters())).toHaveLength(1);

    broken = false;
    expect(await dispatcher.replay([eventId])).toBe(1);
    await dispatcher.drain();

    const [row] = await testDb
      .select()
      .from(eventDeliveries)
      .where(eq(eventDeliveries.subscriber, 'demo.onItemCreated'));
    expect(row!.status).toBe('done');
    expect(await dispatcher.deadLetters()).toHaveLength(0);
  });

  it('dead-letters a subscriber declared in a manifest but never bound', async () => {
    const { bus, dispatcher, handlers } = build();
    handlers.bind('demo', 'onItemCreated', () => {});
    // watcher.onAnyItem intentionally not bound — a wiring bug should be visible

    await publish(bus);
    for (let i = 0; i < 6; i++) await dispatcher.drain();

    const [row] = await testDb
      .select()
      .from(eventDeliveries)
      .where(eq(eventDeliveries.subscriber, 'watcher.onAnyItem'));
    expect(row).toMatchObject({ status: 'dead' });
    expect(row!.lastError).toContain('handler not bound');
  });

  it('delivers events published before a subscriber existed', async () => {
    // Fan-out happens at dispatch time, not publish time, so a module added later
    // still receives events already in the log.
    const { bus, dispatcher, handlers } = build();
    await publish(bus);

    handlers.bind('demo', 'onItemCreated', () => {});
    const late = vi.fn();
    handlers.bind('watcher', 'onAnyItem', late);
    await dispatcher.drain();

    expect(late).toHaveBeenCalledOnce();
  });
});
