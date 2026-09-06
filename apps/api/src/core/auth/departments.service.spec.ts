import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@platform/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { resetDb, seedUser, testDb, truncate } from '../../test/db.js';
import { DepartmentsService, STANDARD_DEPARTMENTS } from './departments.service.js';

const admin: Actor = { userId: crypto.randomUUID(), role: 'admin' };
const mate = crypto.randomUUID();

/**
 * Departments route work; they do not authorise it.
 *
 * The tests worth having are therefore about addresses staying stable — a key the rules name
 * in code, surviving a rename — and about the two ways somebody could quietly break routing:
 * deleting a department the rules address, or a rename that changes what an insight is
 * looking for.
 */
describe('DepartmentsService', () => {
  let departments: DepartmentsService;

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE core.departments, core.user_departments CASCADE`);
    await seedUser(admin.userId, 'admin');
    await seedUser(mate, 'member');
    departments = new DepartmentsService(testDb, new AuditService(testDb));
    await departments.ensureStandard();
  });

  it('seeds exactly the departments the rules address', async () => {
    const keys = (await departments.list()).map((d) => d.key).sort();
    expect(keys).toEqual([...STANDARD_DEPARTMENTS.map((d) => d.key)].sort());
  });

  it('seeds once, and does not resurrect what somebody removed', async () => {
    await departments.ensureStandard();
    expect(await departments.list()).toHaveLength(STANDARD_DEPARTMENTS.length);

    // A business that emptied a department has said something; a later boot must not argue.
    const custom = await departments.create(admin, { label: 'Marketing' });
    await departments.remove(admin, custom.id);
    await departments.ensureStandard();
    expect((await departments.list()).map((d) => d.key)).not.toContain('marketing');
  });

  it('keeps the address when the name changes', async () => {
    const finance = (await departments.list()).find((d) => d.key === 'finance')!;
    const renamed = await departments.rename(admin, finance.id, 'Finance & Admin');

    // The rules say `audience: 'finance'` in code. A rename is presentation, and an invoice
    // notice that stopped arriving because somebody retitled a department would be a mystery
    // nobody could debug from the screen.
    expect(renamed.key).toBe('finance');
    expect(renamed.label).toBe('Finance & Admin');
  });

  it('refuses to delete a department the rules name', async () => {
    const sales = (await departments.list()).find((d) => d.key === 'sales')!;
    await expect(departments.remove(admin, sales.id)).rejects.toThrow(/cannot be deleted/);
  });

  it('gives a new department a slug of its own', async () => {
    const created = await departments.create(admin, { label: 'Marketing & Brand' });
    expect(created.key).toBe('marketing-brand');
    expect(created.isStandard).toBe(false);
    await expect(departments.create(admin, { label: 'Marketing & Brand' })).rejects.toThrow(
      /already a department/,
    );
  });

  it('puts somebody in several departments, and takes them out again', async () => {
    const all = await departments.list();
    const finance = all.find((d) => d.key === 'finance')!;
    const it = all.find((d) => d.key === 'it')!;

    await departments.setForUser(admin, mate, [finance.id, it.id]);
    expect((await departments.keysFor(mate)).sort()).toEqual(['finance', 'it']);

    // The set is replaced, not merged — the screen sends what it wants to be true.
    await departments.setForUser(admin, mate, [it.id]);
    expect(await departments.keysFor(mate)).toEqual(['it']);

    await departments.setForUser(admin, mate, []);
    expect(await departments.keysFor(mate)).toEqual([]);
  });

  it('refuses a department that does not exist rather than silently dropping it', async () => {
    // Silently ignoring an unknown id would leave the screen showing a department nobody is
    // in, which is worse than an error: the routing would simply never happen.
    await expect(departments.setForUser(admin, mate, [crypto.randomUUID()])).rejects.toThrow(
      /does not exist/,
    );
  });

  it('lists who is in one, skipping people who have left', async () => {
    const finance = (await departments.list()).find((d) => d.key === 'finance')!;
    await departments.setForUser(admin, mate, [finance.id]);
    expect((await departments.membersOf('finance')).map((m) => m.id)).toEqual([mate]);

    await testDb.execute(sql`UPDATE core.users SET is_active = false WHERE id = ${mate}`);
    expect(await departments.membersOf('finance')).toEqual([]);
  });
});
