import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { resetDb, seedUser, testDb } from '../../test/db.js';

const actorId = crypto.randomUUID();

/**
 * The audit log is append-only, enforced by the database rather than by good manners.
 *
 * Every other guarantee here protects a record — an issued invoice, a sent quote. This one
 * protects the account of what happened to them, which is what you reach for exactly when
 * something has gone wrong and somebody's version of events is in question.
 */
describe('core.audit_log is append-only', () => {
  let entryId: string;

  beforeEach(async () => {
    await resetDb();
    await seedUser(actorId, 'admin');

    entryId = uuidv7();
    await testDb.execute(sql`
      INSERT INTO core.audit_log (id, actor_id, action, entity_type, entity_id, detail)
      VALUES (${entryId}, ${actorId}, 'client.create', 'client', ${crypto.randomUUID()}, '{"name":"A client"}')
    `);
  });

  it('accepts new entries, which is the whole point of a log', async () => {
    const { rows } = await testDb.execute(sql`SELECT id FROM core.audit_log WHERE id = ${entryId}`);
    expect(rows).toHaveLength(1);
  });

  it('refuses to let an entry be altered', async () => {
    // The more dangerous of the two. A deleted row leaves a gap in the timeline; an
    // altered one leaves nothing at all, and reads exactly like the truth.
    await expect(
      testDb.execute(sql`UPDATE core.audit_log SET action = 'client.update' WHERE id = ${entryId}`),
    ).rejects.toThrow(/append-only/);
  });

  it('refuses to let the actor be reattributed', async () => {
    // The specific edit worth worrying about: not erasing that something happened, but
    // changing who did it.
    await expect(
      testDb.execute(sql`UPDATE core.audit_log SET actor_id = NULL WHERE id = ${entryId}`),
    ).rejects.toThrow(/append-only/);
  });

  it('refuses to let an entry be deleted', async () => {
    await expect(
      testDb.execute(sql`DELETE FROM core.audit_log WHERE id = ${entryId}`),
    ).rejects.toThrow(/append-only/);
  });

  it('refuses a delete that names no rows in particular', async () => {
    // `DELETE FROM core.audit_log` with no predicate is the shape of the accident, and of
    // the deliberate act dressed as one.
    await expect(testDb.execute(sql`DELETE FROM core.audit_log`)).rejects.toThrow(/append-only/);
  });

  it('refuses TRUNCATE, which row triggers would never see', async () => {
    // Row-level triggers do not fire for TRUNCATE. Without a statement-level trigger the
    // entire log could still be emptied in one command — the easiest way to destroy it,
    // and the one the other two guards would not notice.
    await expect(testDb.execute(sql`TRUNCATE core.audit_log`)).rejects.toThrow(/append-only/);
  });

  it('survives all of that with the entry intact', async () => {
    const { rows } = await testDb.execute(
      sql`SELECT action, actor_id FROM core.audit_log WHERE id = ${entryId}`,
    );
    expect(rows[0]).toMatchObject({ action: 'client.create', actor_id: actorId });
  });

  it('tells you what to do instead of failing blankly', async () => {
    // Retention is a real need, and someone will hit this wall with a legitimate reason.
    // The error names the way through: a migration, visible in the history.
    await expect(testDb.execute(sql`DELETE FROM core.audit_log`)).rejects.toThrow(
      /not permitted/,
    );
  });
});
