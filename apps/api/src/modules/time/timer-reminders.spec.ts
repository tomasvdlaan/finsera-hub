import { beforeEach, describe, expect, it } from 'vitest';
import { defineManifest, type Actor } from '@platform/contracts';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { NotificationService } from '../../core/notifications/notification.service.js';
import { notifications } from '../../core/db/core.schema.js';
import { resetDb, seedUser, testDb } from '../../test/db.js';
import { TimerReminders } from './timer-reminders.js';

const marijn: Actor = { userId: crypto.randomUUID(), role: 'member' };
/** Amsterdam is UTC+2 in October 2026 until the 25th. */
const local = (iso: string) => new Date(`${iso}+02:00`);

/**
 * A clock left running. Each rule once, and the two things that would make people switch it
 * off: being told at night, and being told twice.
 */
describe('timer reminders', () => {
  let service: NotificationService;
  let reminders: TimerReminders;
  const entry = (startedAt: Date) => ({
    id: crypto.randomUUID(),
    personId: marijn.userId,
    startedAt,
    projectName: 'Dashboard',
  });

  beforeEach(async () => {
    await resetDb();
    await seedUser(marijn.userId, 'member', 'Marijn Jansen');
    const m = new ManifestRegistry();
    m.register(defineManifest({ name: 'demo', version: '1.0.0' }));
    m.seal();
    service = new NotificationService(testDb, new PermissionService(testDb, m));
    reminders = new TimerReminders(testDb, service);
  });

  const titles = async () => (await service.list(marijn)).map((n) => n.title);

  it('says so after three hours, during the day', async () => {
    await reminders.remind(entry(local('2026-10-13T06:45:00')), local('2026-10-13T10:00:00'));
    expect(await titles()).toEqual(['Your clock on Dashboard has been running for 3h']);
  });

  it('says so near the end of the working day', async () => {
    await reminders.remind(entry(local('2026-10-13T16:30:00')), local('2026-10-13T18:20:00'));
    expect(await titles()).toEqual(['Your clock on Dashboard is still running as the day ends']);
  });

  it('says it ran overnight the next morning — and asks for the real hours', async () => {
    await reminders.remind(entry(local('2026-10-13T15:00:00')), local('2026-10-14T09:00:00'));
    expect(await titles()).toEqual([
      'Your clock on Dashboard ran overnight (18h). Set the hours you actually worked.',
    ]);
  });

  it('says nothing at night', async () => {
    await reminders.remind(entry(local('2026-10-13T15:00:00')), local('2026-10-13T23:00:00'));
    expect(await titles()).toEqual([]);
  });

  it('says nothing when switched off', async () => {
    const s = await service.settings(marijn.userId);
    await service.saveSettings(marijn, { ...s, timer: { ...s.timer, enabled: false } });
    await reminders.remind(entry(local('2026-10-13T06:45:00')), local('2026-10-13T10:00:00'));
    expect(await titles()).toEqual([]);
  });

  it('says each thing once, however often it looks', async () => {
    const e = entry(local('2026-10-13T06:45:00'));
    await reminders.remind(e, local('2026-10-13T10:00:00'));
    await reminders.remind(e, local('2026-10-13T10:05:00'));
    await reminders.remind(e, local('2026-10-13T11:30:00'));
    expect(await testDb.select().from(notifications)).toHaveLength(1);
  });
});
