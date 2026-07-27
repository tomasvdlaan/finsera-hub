import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb } from '../../test/db.js';
import { DbIntegrityService } from './integrity.service.js';

describe('DbIntegrityService', () => {
  let integrity: DbIntegrityService;

  beforeEach(() => {
    integrity = new DbIntegrityService(testDb);
  });

  it('finds every immutability guarantee present', async () => {
    expect(await integrity.missingTriggers()).toEqual([]);
  });

  it('refuses to start when a guarantee has gone missing', async () => {
    // Exactly the drift this exists to catch: a migration that reported success but left
    // the database without its trigger.
    await testDb.execute(
      sql`DROP TRIGGER contracts_immutable_after_sign ON sales.contracts`,
    );
    try {
      const missing = await integrity.missingTriggers();
      expect(missing.map((t) => t.trigger)).toEqual(['contracts_immutable_after_sign']);
      await expect(integrity.onApplicationBootstrap()).rejects.toThrow(
        /missing 1 immutability trigger/,
      );
    } finally {
      await testDb.execute(sql`
        CREATE TRIGGER contracts_immutable_after_sign
          BEFORE UPDATE ON sales.contracts
          FOR EACH ROW EXECUTE FUNCTION sales.forbid_signed_contract_changes()
      `);
    }
    expect(await integrity.missingTriggers()).toEqual([]);
  });
});
