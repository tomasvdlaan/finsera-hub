import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineManifest, notificationSettingsSchema, type Actor } from '@platform/contracts';
import { eq } from 'drizzle-orm';
import { notificationDeliveries, pushDevices } from '../db/core.schema.js';
import { ManifestRegistry } from '../manifest/manifest.registry.js';
import { PermissionService } from '../permissions/permission.service.js';
import { RegistryService } from '../registry/registry.service.js';
import { resetDb, seedUser, testDb } from '../../test/db.js';
import { NotificationService, type NotifyInput } from './notification.service.js';
import { PushRouter } from './push-router.js';
import type { PushService } from './push.service.js';
import { nextWorkingStart, withinWorkingHours } from './working-hours.js';

const tomas: Actor = { userId: crypto.randomUUID(), role: 'admin' };
const marijn: Actor = { userId: crypto.randomUUID(), role: 'member' };

/** Tuesday 13 October 2026, 10:00 in Amsterdam (08:00 UTC, summer time). */
const TUESDAY_10 = new Date('2026-10-13T08:00:00Z');
/** The same Tuesday, 22:00 in Amsterdam. */
const TUESDAY_22 = new Date('2026-10-13T20:00:00Z');

describe('working hours', () => {
  const s = notificationSettingsSchema.parse({});

  it('reads the clock in the person’s zone, not the server’s', () => {
    expect(withinWorkingHours(s, TUESDAY_10)).toBe(true);
    expect(withinWorkingHours(s, TUESDAY_22)).toBe(false);
  });

  it('finds the next morning, and skips the weekend', () => {
    expect(nextWorkingStart(s, TUESDAY_22)!.toISOString()).toBe('2026-10-14T06:30:00.000Z');
    const fridayEvening = new Date('2026-10-16T19:00:00Z');
    expect(nextWorkingStart(s, fridayEvening)!.toISOString()).toBe('2026-10-19T06:30:00.000Z');
  });

  it('has no next window for somebody with no working days', () => {
    expect(nextWorkingStart({ ...s, workDays: [] }, TUESDAY_22)).toBeNull();
  });
});

/**
 * Whether something may interrupt. Each test is one rule from the brief, because every one of
 * them is a way notifications become something people switch off.
 */
describe('push router', () => {
  let notifications: NotificationService;
  let router: PushRouter;
  let push: { enabled: boolean; publicKey: string; hasDevices: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
  let item: string;

  const write = (over: Partial<NotifyInput> = {}) =>
    notifications.notify({
      personId: marijn.userId,
      category: 'task',
      tier: 'now',
      title: 'Tomas assigned you “Rework the roles”',
      groupKey: `task:${item}`,
      dedupeKey: crypto.randomUUID(),
      subjectId: item,
      subjectType: 'demo_item',
      actorId: tomas.userId,
      ...over,
    });

  beforeEach(async () => {
    await resetDb();
    await seedUser(tomas.userId, 'admin', 'Tomas');
    await seedUser(marijn.userId, 'member', 'Marijn Jansen');
    const m = new ManifestRegistry();
    m.register(
      defineManifest({
        name: 'demo',
        version: '1.0.0',
        entities: [{ type: 'demo_item', displayTemplate: '{t}', urlPattern: '/demo/:id', readPermission: 'demo.items.read' }],
        permissions: [{ capability: 'demo.items.read', description: 'Read demo items.' }],
      }),
    );
    m.seal();
    const registry = new RegistryService(testDb, m);
    item = registry.newId();
    await testDb.transaction((tx) =>
      registry.register(tx, { id: item, entityType: 'demo_item', displayName: 'Rework the roles', urlPath: `/demo/${item}` }),
    );
    notifications = new NotificationService(testDb, new PermissionService(testDb, m));
    push = {
      enabled: true,
      publicKey: 'test-key',
      hasDevices: vi.fn(async () => true),
      send: vi.fn(async () => ({ delivered: true })),
    };
    // Not wired through onCreated: each test decides when routing happens.
    router = new PushRouter(testDb, notifications, push as unknown as PushService);
  });

  it('sends a now-tier notification inside working hours, to its subject', async () => {
    const n = await write();
    expect(await router.decide(n!, TUESDAY_10)).toEqual({ status: 'send' });
  });

  it('never pushes the quieter tiers', async () => {
    const n = await write({ tier: 'today' });
    expect(await router.decide(n!, TUESDAY_10)).toEqual({ status: 'skipped', reason: 'tier today' });
  });

  it('never pushes your own reminder', async () => {
    const n = await write({ personId: marijn.userId, actorId: marijn.userId, category: 'mention' });
    expect(await router.decide(n!, TUESDAY_10)).toEqual({ status: 'skipped', reason: 'own act' });
  });

  it('respects a category switched off', async () => {
    const s = await notifications.settings(marijn.userId);
    await notifications.saveSettings(marijn, { ...s, push: { task: false } });
    const n = await write();
    expect(await router.decide(n!, TUESDAY_10)).toEqual({ status: 'skipped', reason: 'category off' });
  });

  it('holds a push outside working hours until the next morning', async () => {
    const n = await write();
    const d = await router.decide(n!, TUESDAY_22);
    expect(d.status).toBe('held');
    expect(d.status === 'held' && d.until.toISOString()).toBe('2026-10-14T06:30:00.000Z');
  });

  it('pushes one thing once per quarter hour, however many occurrences', async () => {
    const first = await write();
    await router.route(first!); // sent (the real clock decides; make the test independent of it)
    await testDb
      .update(notificationDeliveries)
      .set({ status: 'sent', sentAt: new Date() })
      .where(eq(notificationDeliveries.notificationId, first!.id));

    const second = await write();
    expect(await router.decide(second!, new Date())).toEqual({ status: 'skipped', reason: 'collapsed' });
  });

  it('releases what was held as one push per person, and drops what was read meanwhile', async () => {
    const a = await write({ groupKey: 'a' });
    const b = await write({ groupKey: 'b' });
    const c = await write({ groupKey: 'c' });
    for (const n of [a, b, c]) {
      await testDb.insert(notificationDeliveries).values({
        id: crypto.randomUUID(),
        notificationId: n!.id,
        channel: 'push',
        status: 'held',
        scheduledFor: new Date(Date.now() - 60_000),
      });
    }
    await notifications.markRead(marijn, [c!.id]); // read in the app overnight

    await router.releaseHeld(new Date());

    expect(push.send).toHaveBeenCalledOnce();
    expect(push.send.mock.calls[0]![1].title).toBe('2 things for you while you were away');
    const rows = await testDb.select().from(notificationDeliveries);
    expect(rows.filter((r) => r.status === 'sent')).toHaveLength(2);
    expect(rows.find((r) => r.notificationId === c!.id)!.status).toBe('skipped');
  });

  describe('the morning brief', () => {
    /** Wednesday 14 October 2026, 08:32 in Amsterdam — two minutes into the default day. */
    const MORNING = new Date('2026-10-14T06:32:00Z');

    beforeEach(async () => {
      await testDb.insert(pushDevices).values({
        id: crypto.randomUUID(),
        personId: marijn.userId,
        endpoint: 'https://push.example/marijn',
        p256dh: 'k',
        auth: 'a',
        label: 'iPhone · app',
      });
    });

    it('sends one line at the start of the day when several things wait', async () => {
      await write({ groupKey: 'a', tier: 'today' });
      await write({ groupKey: 'b', tier: 'today' });
      expect(await router.sendBriefs(MORNING)).toBe(1);
      expect(push.send.mock.calls.at(-1)![1].title).toBe('2 things for you today');
      // Not itself one of the things: the brief does not appear in For you or the badge.
      expect(await notifications.count(marijn)).toBe(2);
    });

    it('sends it once a day, and not at all when nothing waits', async () => {
      expect(await router.sendBriefs(MORNING)).toBe(0);
      await write({ groupKey: 'a', tier: 'today' });
      expect(await router.sendBriefs(MORNING)).toBe(1);
      expect(await router.sendBriefs(new Date(MORNING.getTime() + 3 * 60_000))).toBe(0);
    });

    it('waits for the start of the day', async () => {
      await write({ groupKey: 'a', tier: 'today' });
      expect(await router.sendBriefs(new Date('2026-10-14T05:00:00Z'))).toBe(0);
      expect(await router.sendBriefs(new Date('2026-10-14T09:00:00Z'))).toBe(0);
    });
  });

  it('marks a notification read when it is opened from a push — but only its owner’s', async () => {
    const n = await write();
    await router.opened(tomas.userId, n!.id);
    expect(await notifications.count(marijn)).toBe(1);
    await router.opened(marijn.userId, n!.id);
    expect(await notifications.count(marijn)).toBe(0);
  });
});
