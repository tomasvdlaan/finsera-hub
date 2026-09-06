import { beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { AuditService } from './audit.service.js';
import { UserService } from '../auth/user.service.js';
import { entities, users } from '../db/core.schema.js';
import { resetDb, seedUser, testDb, truncate } from '../../test/db.js';

const SUB = 'sub-comes-and-goes';

/**
 * Who has been here, and how the platform works out that anybody arrived.
 *
 * There is no login to observe. The internal app runs the OIDC exchange in the browser and
 * renews its token silently, so what is recorded is the first request after a gap — which
 * is what a colleague means by the question, and is why these tests move the clock rather
 * than call anything named `login`.
 */
describe('Sign-ins', () => {
  let service: UserService;
  let audit: AuditService;
  let id: string;

  /** Pretend the last thing this person did was `minutes` ago. */
  const lastSeen = async (minutes: number | null) => {
    await testDb
      .update(users)
      .set({ lastSeenAt: minutes === null ? null : new Date(Date.now() - minutes * 60_000) })
      .where(eq(users.id, id));
  };

  /** One request from them, through the same path the guard uses. */
  const arrive = () =>
    service.resolveFromClaims({ sub: SUB, email: 'tomas@finsera.nl', roles: ['internal'] }, 'token');

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE core.users CASCADE`);
    audit = new AuditService(testDb);
    service = new UserService(testDb, audit);
    // The issuer is not called in these tests; the decision under test is about our own row.
    service.fetchUserInfo = async () => null;

    id = crypto.randomUUID();
    await testDb.insert(users).values({
      id,
      oidcSubject: SUB,
      email: 'tomas@finsera.nl',
      displayName: 'Tomas van der Laan',
      role: 'admin',
    });
  });

  it('records a sign-in the first time somebody is seen at all', async () => {
    await lastSeen(null);
    await arrive();
    expect(await audit.signIns({ userId: id })).toMatchObject([
      { userId: id, displayName: 'Tomas van der Laan', surface: 'platform' },
    ]);
  });

  it('records one when they come back after being away', async () => {
    await lastSeen(45);
    await arrive();
    expect(await audit.signIns({ userId: id })).toHaveLength(1);
  });

  it('does not record one for somebody who never left', async () => {
    // The point of the gap. This runs on every request, and a row per page load would be a
    // log of nothing, in a table that already carries every mutation in the platform.
    await lastSeen(10);
    await arrive();
    expect(await audit.signIns({ userId: id })).toEqual([]);
  });

  it('writes at most one row however many requests arrive', async () => {
    await lastSeen(45);
    await arrive();
    await arrive();
    await arrive();
    expect(await audit.signIns({ userId: id })).toHaveLength(1);
  });

  it('leaves the timestamp alone for somebody seen moments ago', async () => {
    await lastSeen(1);
    const before = (await testDb.select().from(users).where(eq(users.id, id)))[0]!.lastSeenAt;
    await arrive();
    const after = (await testDb.select().from(users).where(eq(users.id, id)))[0]!.lastSeenAt;
    // Skipped entirely rather than written and thrown away: this is the common case, on
    // every request of every page load.
    expect(after?.getTime()).toBe(before?.getTime());
  });

  it('says when the gap it measured began', async () => {
    await lastSeen(90);
    await arrive();
    const { rows } = await testDb.execute<{ detail: Record<string, unknown> }>(
      sql`SELECT detail FROM core.audit_log WHERE action = 'core.signed_in'`,
    );
    // Carried with the row so a reader does not have to know the constant that produced it.
    expect(rows[0]?.detail).toMatchObject({ email: 'tomas@finsera.nl' });
    expect(typeof rows[0]?.detail.since).toBe('string');
  });
});

/**
 * The other half: reading the log back, which nothing in the platform did before.
 */
describe('AuditService.signIns', () => {
  let audit: AuditService;
  const colleague = crypto.randomUUID();
  const clientId = crypto.randomUUID();

  beforeEach(async () => {
    await resetDb();
    audit = new AuditService(testDb);
    await seedUser(colleague, 'admin', 'Tomas van der Laan');
    await testDb.insert(entities).values({
      id: clientId,
      entityType: 'client',
      owningModule: 'crm',
      displayName: 'DocHorse',
      urlPath: `/clients/${clientId}`,
    });
  });

  const write = (action: string, actorId: string | null, detail: Record<string, unknown> = {}) =>
    testDb.transaction((tx) =>
      audit.record(tx, { actorId, action, entityType: 'client', entityId: clientId, detail }),
    );

  it('names a client who signed in to their own portal', async () => {
    // No user row exists for them, so the entry names them from what the invitation knew.
    await write('portal.login', null, { email: 'charlotte@dochorse.com' });

    expect(await audit.signIns()).toMatchObject([
      { surface: 'portal', clientName: 'DocHorse', label: 'charlotte@dochorse.com', userId: null },
    ]);
  });

  it('names a colleague who opened a client portal, from their user row', async () => {
    await write('portal.login', colleague, { staff: true });

    const [entry] = await audit.signIns();
    expect(entry).toMatchObject({
      surface: 'portal',
      clientName: 'DocHorse',
      displayName: 'Tomas van der Laan',
    });
    // Their own name, not a label: a colleague has a row, and the row is the thing that
    // can be checked.
    expect(entry!.label).toBeNull();
  });

  it('ignores everything else in the log', async () => {
    // The table carries every mutation in the platform. This reads two actions out of it.
    await write('client.update', colleague);
    await write('portal.read', null, { read: 'invoices' });
    expect(await audit.signIns()).toEqual([]);
  });

  it('narrows to one person, and caps however much is asked for', async () => {
    const other = crypto.randomUUID();
    await seedUser(other, 'member', 'Somebody Else');
    await write('portal.login', colleague, { staff: true });
    await write('portal.login', other, { staff: true });

    expect(await audit.signIns({ userId: colleague })).toHaveLength(1);
    expect(await audit.signIns({ limit: 5000 })).toHaveLength(2);
  });
});
