import { beforeEach, describe, expect, it } from 'vitest';
import { defineManifest, type Actor } from '@platform/contracts';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { CommentService } from '../comments/comment.service.js';
import { MentionService } from '../comments/mention.service.js';
import { mentions, notifications, users } from '../db/core.schema.js';
import { EventHandlerRegistry } from '../events/event-handler.registry.js';
import { ManifestRegistry } from '../manifest/manifest.registry.js';
import { PermissionService } from '../permissions/permission.service.js';
import { RegistryService } from '../registry/registry.service.js';
import { resetDb, seedUser, testDb } from '../../test/db.js';
import { NotificationProducers } from './notification-producers.js';
import { NotificationService, type NotifyInput } from './notification.service.js';

const tomas: Actor = { userId: crypto.randomUUID(), role: 'admin' };
const marijn: Actor = { userId: crypto.randomUUID(), role: 'member' };

function manifests() {
  const m = new ManifestRegistry();
  m.register(
    defineManifest({
      name: 'demo',
      version: '1.0.0',
      entities: [
        { type: 'demo_item', displayTemplate: '{t}', urlPattern: '/demo/:id', readPermission: 'demo.items.read' },
        { type: 'secret_item', displayTemplate: '{t}', urlPattern: '/secret/:id', readPermission: 'demo.secrets.read' },
      ],
      permissions: [
        { capability: 'demo.items.read', description: 'Read demo items.' },
        { capability: 'demo.secrets.read', description: 'Read secrets.', adminOnly: true },
      ],
    }),
  );
  m.seal();
  return m;
}

/**
 * Being told. What is worth testing is not that a row appears — it is every way a notification
 * stops being trustworthy: telling somebody twice, telling them about their own act, telling
 * them about something they cannot open, and a count that disagrees with the list.
 */
describe('notifications', () => {
  let service: NotificationService;
  let registry: RegistryService;
  let item: string;
  let secret: string;

  const note = (over: Partial<NotifyInput> = {}): NotifyInput => ({
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
    const m = manifests();
    registry = new RegistryService(testDb, m);
    service = new NotificationService(testDb, new PermissionService(testDb, m));
    item = registry.newId();
    secret = registry.newId();
    await testDb.transaction(async (tx) => {
      await registry.register(tx, { id: item, entityType: 'demo_item', displayName: 'Rework the roles', urlPath: `/demo/${item}` });
      await registry.register(tx, { id: secret, entityType: 'secret_item', displayName: 'Salaries', urlPath: `/secret/${secret}` });
    });
  });

  it('writes one notification per occurrence, however often it is delivered', async () => {
    const once = note({ dedupeKey: 'task.assigned:evt-1' });
    expect(await service.notify(once)).not.toBeNull();
    // The bus is at-least-once: the same event again must not tell anybody twice.
    expect(await service.notify(once)).toBeNull();
    expect(await testDb.select().from(notifications)).toHaveLength(1);
  });

  it('never tells somebody about their own act', async () => {
    expect(await service.notify(note({ personId: tomas.userId, actorId: tomas.userId }))).toBeNull();
  });

  it('keeps a reminder you wrote to yourself', async () => {
    // A deliberate self-mention is how the Inbox has always held a note-to-self.
    const self = note({ personId: tomas.userId, actorId: tomas.userId, category: 'mention' });
    expect(await service.notify(self)).not.toBeNull();
  });

  it('tells an inactive account nothing', async () => {
    await testDb.update(users).set({ isActive: false }).where(eq(users.id, marijn.userId));
    expect(await service.notify(note())).toBeNull();
  });

  it('never tells somebody about a record they could not open', async () => {
    // The title alone would say what it is.
    expect(await service.notify(note({ subjectId: secret, subjectType: 'secret_item' }))).toBeNull();
    // An admin may see it, so an admin may be told.
    const toAdmin = note({ personId: tomas.userId, actorId: marijn.userId, subjectId: secret, subjectType: 'secret_item' });
    expect(await service.notify(toAdmin)).not.toBeNull();
  });

  it('shows a busy thread as one entry, and counts things rather than occurrences', async () => {
    for (let i = 0; i < 3; i++) await service.notify(note({ category: 'comment', groupKey: `comments:${item}` }));
    await service.notify(note());

    const list = await service.list(marijn);
    expect(list).toHaveLength(2);
    expect(list.find((n) => n.category === 'comment')!.count).toBe(3);
    expect(list[0]!.url).toBe(`/demo/${item}`);
    expect(list[0]!.actorName).toBe('Tomas');
    // The badge agrees with the list: two things, not four.
    expect(await service.count(marijn)).toBe(2);
  });

  it('reads a whole group from one entry, and only the reader’s own', async () => {
    for (let i = 0; i < 3; i++) await service.notify(note({ groupKey: `comments:${item}` }));
    const [entry] = await service.list(marijn);

    // Somebody else cannot read Marijn's.
    expect(await service.markRead(tomas, [entry!.id])).toEqual({ read: 0 });
    expect(await service.markRead(marijn, [entry!.id])).toEqual({ read: 3 });
    expect(await service.count(marijn)).toBe(0);
    // Read entries stay listed for a while, as read.
    expect((await service.list(marijn))[0]!.read).toBe(true);
  });

  it('clears a notification when its cause goes away, without reading it', async () => {
    const insightId = crypto.randomUUID();
    await service.notify(note({ insightId }));
    expect(await service.clear({ insightId })).toBe(1);
    expect(await service.list(marijn)).toHaveLength(0);
    expect(await service.count(marijn)).toBe(0);
    // An unscoped clear is refused rather than clearing everybody's.
    expect(await service.clear({})).toBe(0);
  });

  it('fills settings with defaults, and refuses nonsense', async () => {
    const s = await service.settings(marijn.userId);
    expect(s.timeZone).toBe('Europe/Amsterdam');
    expect(s.workStart).toBe('08:30');
    expect(s.push.mention).toBe(true);
    expect(s.push.comment).toBe(false);

    const saved = await service.saveSettings(marijn, { ...s, workStart: '07:45', push: { comment: true } });
    expect(saved.workStart).toBe('07:45');
    expect(saved.push.comment).toBe(true);
    expect(saved.push.mention).toBe(true); // defaults survive a partial save

    await expect(service.saveSettings(marijn, { workStart: '25:00' })).rejects.toThrow(/workStart/);
  });

  describe('from events', () => {
    let producers: NotificationProducers;
    let comments: CommentService;

    beforeEach(() => {
      producers = new NotificationProducers(testDb, new EventHandlerRegistry(), service);
      const m = manifests();
      comments = new CommentService(testDb, registry, new PermissionService(testDb, m), new AuditService(testDb), new MentionService(testDb));
    });

    it('tells the person named in a comment, and reading it reads the mention', async () => {
      await comments.add(tomas, { subjectId: item, body: 'Can you look at this @Marijn Jansen?' });
      const [mention] = await testDb.select().from(mentions);

      await producers.mentioned({
        eventId: crypto.randomUUID(),
        eventName: 'comment.mentioned',
        entityType: 'demo_item',
        entityId: item,
        actorId: tomas.userId,
        payload: { commentId: mention!.commentId, mentions: [{ id: mention!.id, userId: marijn.userId }] },
      });

      const [entry] = await service.list(marijn);
      expect(entry!.title).toBe('Tomas mentioned you on “Rework the roles”');
      expect(entry!.category).toBe('mention');

      await service.markRead(marijn, [entry!.id]);
      const [after] = await testDb.select().from(mentions).where(eq(mentions.id, mention!.id));
      expect(after!.readAt).not.toBeNull();
    });

    it('tells the assignee, once per assignment event', async () => {
      const ctx = {
        eventId: crypto.randomUUID(),
        eventName: 'task.assigned',
        entityType: 'demo_item',
        entityId: item,
        actorId: tomas.userId,
        payload: { assigneeId: marijn.userId },
      };
      await producers.taskAssigned(ctx);
      await producers.taskAssigned(ctx); // redelivered

      const list = await service.list(marijn);
      expect(list).toHaveLength(1);
      expect(list[0]!.title).toBe('Tomas assigned you “Rework the roles”');
    });

    it('does not tell you that you assigned yourself', async () => {
      await producers.taskAssigned({
        eventId: crypto.randomUUID(),
        eventName: 'task.assigned',
        entityType: 'demo_item',
        entityId: item,
        actorId: marijn.userId,
        payload: { assigneeId: marijn.userId },
      });
      expect(await service.list(marijn)).toHaveLength(0);
    });
  });
});
