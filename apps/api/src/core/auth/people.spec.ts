import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Actor } from '@platform/contracts';
import { users } from '../db/core.schema.js';
import { resetDb, seedUser, testDb } from '../../test/db.js';
import { UserService } from './user.service.js';

const service = new UserService(testDb);

let bossId: string;
let boss: Actor;
let mateId: string;

beforeEach(async () => {
  await resetDb();
  bossId = crypto.randomUUID();
  mateId = crypto.randomUUID();
  await seedUser(bossId, 'admin');
  await seedUser(mateId, 'member');
  boss = { userId: bossId, role: 'admin' };
});

describe('the people directory', () => {
  it('never carries the subject claim', async () => {
    const rows = await service.people(boss);
    // The Zitadel `sub` is an identity secret in the sense that matters here: it is the key
    // an impersonation would need, and no screen has ever had a reason to show it.
    expect(rows.every((r) => !('oidcSubject' in r))).toBe(true);
  });

  it('shows a cost rate to an admin and hides it from a member', async () => {
    await service.updatePerson(boss, mateId, { costRateCents: 4500 });

    const asAdmin = (await service.people(boss)).find((r) => r.id === mateId);
    expect(asAdmin?.costRateCents).toBe(4500);

    const asMember = (await service.people({ userId: mateId, role: 'member' })).find(
      (r) => r.id === mateId,
    );
    // Absent, not null. A client showing "—" for an unset rate must not show "—" for a hidden
    // one and imply nobody has set it.
    expect(asMember && 'costRateCents' in asMember).toBe(false);
  });
});

describe('who may be changed, and into what', () => {
  it('records what the business knows', async () => {
    const row = await service.updatePerson(boss, mateId, {
      jobTitle: 'BI consultant',
      startedOn: '2026-03-01',
      weeklyHours: 32,
      costRateCents: 5200,
    });
    expect(row).toMatchObject({ jobTitle: 'BI consultant', weeklyHours: 32, costRateCents: 5200 });
  });

  it('will not let you demote or deactivate yourself', async () => {
    // One click from a platform nobody can administer, whose recovery is a hand-written
    // UPDATE against production. Somebody else can always do it to you.
    await expect(service.updatePerson(boss, bossId, { role: 'member' })).rejects.toThrow(
      /another admin/i,
    );
    await expect(service.updatePerson(boss, bossId, { isActive: false })).rejects.toThrow(
      /another admin/i,
    );
  });

  it('will not let the last admin stop being one', async () => {
    const otherId = crypto.randomUUID();
    await seedUser(otherId, 'admin');
    const other: Actor = { userId: otherId, role: 'admin' };

    // Two admins: demoting one is fine.
    await service.updatePerson(other, bossId, { role: 'member' });
    // One admin left, and it is not the caller — the same lockout one step removed.
    await expect(
      service.updatePerson({ userId: mateId, role: 'admin' }, otherId, { role: 'member' }),
    ).rejects.toThrow(/only administrator/i);
  });

  it('counts only active admins when deciding that', async () => {
    const sleeperId = crypto.randomUUID();
    await seedUser(sleeperId, 'admin');
    await testDb.update(users).set({ isActive: false }).where(eq(users.id, sleeperId));
    // A deactivated admin cannot sign in, so it cannot be the one that keeps the door open.
    await expect(
      service.updatePerson({ userId: mateId, role: 'admin' }, bossId, { role: 'member' }),
    ).rejects.toThrow(/only administrator/i);
  });

  it('refuses a cost rate from anybody but an admin', async () => {
    await expect(
      service.updatePerson({ userId: mateId, role: 'member' }, bossId, { costRateCents: 1 }),
    ).rejects.toThrow(/administrator/i);
  });

  it('says so plainly when there is no such person', async () => {
    await expect(service.updatePerson(boss, crypto.randomUUID(), { jobTitle: 'x' })).rejects.toThrow(
      /no such person/i,
    );
  });
});

describe('deactivating somebody', () => {
  it('takes them out of the assignee picker', async () => {
    await service.updatePerson(boss, mateId, { isActive: false });
    const assignable = await service.listAssignable();
    expect(assignable.map((a) => a.id)).not.toContain(mateId);
  });

  it('and refuses their sign-in', async () => {
    await service.updatePerson(boss, mateId, { isActive: false });
    const [row] = await testDb.select().from(users).where(eq(users.id, mateId));

    // The whole point of choosing "block sign-in" over "hide from pickers": the flag used to
    // be read by one function, so somebody marked inactive kept a working session and full
    // sight of every client, rate and invoice.
    await expect(
      service.resolveFromClaims({ sub: row!.oidcSubject } as never, 'token'),
    ).rejects.toThrow(/deactivated/i);
  });

  it('lets them back in when reactivated', async () => {
    await service.updatePerson(boss, mateId, { isActive: false });
    await service.updatePerson(boss, mateId, { isActive: true });
    const [row] = await testDb.select().from(users).where(eq(users.id, mateId));

    const actor = await service.resolveFromClaims({ sub: row!.oidcSubject } as never, 'token');
    expect(actor.userId).toBe(mateId);
  });
});

/**
 * One person, for the page that is about them.
 *
 * The rule worth pinning is that `person()` cannot drift from `people()` — the cost-rate
 * stripping is the kind of thing that gets implemented twice and then only fixed once.
 */
describe('one person', () => {
  it('returns the same shape the directory does', async () => {
    await service.updatePerson(boss, mateId, { jobTitle: 'Data engineer', weeklyHours: 32 });

    const fromList = (await service.people(boss)).find((r) => r.id === mateId);
    const alone = await service.person(boss, mateId);
    expect(alone).toEqual(fromList);
  });

  it('hides the cost rate from a member here too, not only in the list', async () => {
    await service.updatePerson(boss, mateId, { costRateCents: 4500 });

    expect((await service.person(boss, mateId))?.costRateCents).toBe(4500);
    const asMember = await service.person({ userId: mateId, role: 'member' }, mateId);
    expect(asMember && 'costRateCents' in asMember).toBe(false);
  });

  it('answers null for somebody who does not exist, rather than throwing', async () => {
    // The controller turns this into a 404. A thrown error here would make "no such person"
    // indistinguishable from "the query broke".
    expect(await service.person(boss, crypto.randomUUID())).toBeNull();
  });
});

