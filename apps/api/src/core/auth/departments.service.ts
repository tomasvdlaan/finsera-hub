import { BadRequestException, Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service.js';
import { DB, type Database } from '../db/db.module.js';
import { departments, userDepartments, users } from '../db/core.schema.js';

/**
 * The departments the insight rules address by name.
 *
 * Seeded rather than assumed: a rule saying `audience: 'finance'` against a table with no
 * finance row would route nothing, and the failure would look like the rule being broken.
 * `key` is the address and is fixed in code; `label` is the business's to rename.
 */
export const STANDARD_DEPARTMENTS = [
  { key: 'finance', label: 'Finance' },
  { key: 'sales', label: 'Sales' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'hr', label: 'HR' },
  { key: 'it', label: 'IT' },
] as const;

export interface Department {
  id: string;
  key: string;
  label: string;
  isStandard: boolean;
}

/**
 * Who work is addressed to.
 *
 * Departments route; they do not authorise. `PermissionService` still answers every "may
 * they?" from `users.role` alone, and nothing here is consulted by it — so putting somebody
 * in Finance changes which items reach their inbox and changes nothing about what they can
 * open. Keeping those two apart is what makes this safe to change on a Friday: the worst a
 * mistake here can do is send a notice to the wrong colleague.
 */
@Injectable()
export class DepartmentsService implements OnModuleInit {
  private readonly logger = new Logger(DepartmentsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureStandard();
  }

  /**
   * Create the departments the rules name, once.
   *
   * `onConflictDoNothing` on the key rather than "insert if the table is empty": a business
   * that deleted Sales has said something, and a later boot must not undo it. Only a key
   * that has never existed is created.
   */
  async ensureStandard(): Promise<void> {
    const existing = await this.db.select({ key: departments.key }).from(departments);
    const known = new Set(existing.map((d) => d.key));
    const missing = STANDARD_DEPARTMENTS.filter((d) => !known.has(d.key));
    if (missing.length === 0) return;

    await this.db
      .insert(departments)
      .values(missing.map((d) => ({ id: uuidv7(), key: d.key, label: d.label, isStandard: true })))
      .onConflictDoNothing({ target: departments.key });
    this.logger.log(`Seeded departments: ${missing.map((d) => d.key).join(', ')}`);
  }

  async list(): Promise<Department[]> {
    return this.db
      .select({
        id: departments.id,
        key: departments.key,
        label: departments.label,
        isStandard: departments.isStandard,
      })
      .from(departments)
      .orderBy(asc(departments.label));
  }

  /**
   * The keys somebody is addressed by, for routing.
   *
   * Read from the join table rather than carried on the Actor: an Actor is minted from a
   * token on every request and would then hold a copy of this that goes stale the moment
   * somebody is moved between departments — for a routing decision made once per page load,
   * one indexed read is the cheaper mistake to avoid.
   */
  async keysFor(userId: string | undefined): Promise<string[]> {
    if (!userId) return [];
    const rows = await this.db
      .select({ key: departments.key })
      .from(userDepartments)
      .innerJoin(departments, eq(departments.id, userDepartments.departmentId))
      .where(eq(userDepartments.userId, userId));
    return rows.map((r) => r.key);
  }

  /** Everyone in a department, for "who should I tell". */
  async membersOf(key: string): Promise<Array<{ id: string; displayName: string }>> {
    return this.db
      .select({ id: users.id, displayName: users.displayName })
      .from(userDepartments)
      .innerJoin(departments, eq(departments.id, userDepartments.departmentId))
      .innerJoin(users, eq(users.id, userDepartments.userId))
      .where(and(eq(departments.key, key), eq(users.isActive, true)));
  }

  /** The department ids each of these people belongs to, for a list that shows them all. */
  async byUser(userIds: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (userIds.length === 0) return out;
    const rows = await this.db
      .select({ userId: userDepartments.userId, departmentId: userDepartments.departmentId })
      .from(userDepartments)
      .where(inArray(userDepartments.userId, userIds));
    for (const r of rows) out.set(r.userId, [...(out.get(r.userId) ?? []), r.departmentId]);
    return out;
  }

  async create(actor: Actor, input: { key?: string; label: string }): Promise<Department> {
    const label = (input.label ?? '').trim();
    if (!label) throw new BadRequestException('A department needs a name');
    const key = this.slug(input.key ?? label);
    if (!key) throw new BadRequestException('A department needs a name with letters in it');

    const [clash] = await this.db.select().from(departments).where(eq(departments.key, key)).limit(1);
    if (clash) throw new BadRequestException(`There is already a department called '${clash.label}'`);

    const id = uuidv7();
    await this.db.transaction(async (tx) => {
      await tx.insert(departments).values({ id, key, label, isStandard: false });
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'department.create',
        entityType: 'department',
        entityId: id,
        detail: { key, label },
      });
    });
    return { id, key, label, isStandard: false };
  }

  /**
   * Rename a department. The key is not touched.
   *
   * Renaming is presentation; the rules address the key, so "Finance" becoming "Finance &
   * Admin" must not stop an overdue invoice reaching it.
   */
  async rename(actor: Actor, id: string, label: string): Promise<Department> {
    const trimmed = (label ?? '').trim();
    if (!trimmed) throw new BadRequestException('A department needs a name');
    const [row] = await this.db.select().from(departments).where(eq(departments.id, id)).limit(1);
    if (!row) throw new NotFoundException('No such department');

    await this.db.transaction(async (tx) => {
      await tx.update(departments).set({ label: trimmed }).where(eq(departments.id, id));
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'department.rename',
        entityType: 'department',
        entityId: id,
        detail: { from: row.label, to: trimmed },
      });
    });
    return { id, key: row.key, label: trimmed, isStandard: row.isStandard };
  }

  /**
   * Remove a department that nothing in the code addresses.
   *
   * A standard one is refused rather than cascaded: the rules name it, so deleting it would
   * silently send every invoice notice to the admin fallback and leave nothing on screen to
   * explain why. Emptying it of people is the way to say "we do not staff this".
   */
  async remove(actor: Actor, id: string): Promise<void> {
    const [row] = await this.db.select().from(departments).where(eq(departments.id, id)).limit(1);
    if (!row) throw new NotFoundException('No such department');
    if (row.isStandard) {
      throw new BadRequestException(
        `'${row.label}' is addressed by name from the insight rules and cannot be deleted — ` +
          'take everybody out of it instead',
      );
    }

    await this.db.transaction(async (tx) => {
      await tx.delete(departments).where(eq(departments.id, id));
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'department.delete',
        entityType: 'department',
        entityId: id,
        detail: { key: row.key, label: row.label },
      });
    });
  }

  /** Replace somebody's departments with exactly this set. */
  async setForUser(actor: Actor, userId: string, departmentIds: string[]): Promise<string[]> {
    const [person] = await this.db.select({ id: users.id }).from(users).where(eq(users.id, userId));
    if (!person) throw new NotFoundException('No such person');

    const wanted = [...new Set(departmentIds ?? [])];
    if (wanted.length > 0) {
      const found = await this.db
        .select({ id: departments.id })
        .from(departments)
        .where(inArray(departments.id, wanted));
      if (found.length !== wanted.length) {
        throw new BadRequestException('That department does not exist');
      }
    }

    await this.db.transaction(async (tx) => {
      // Replaced wholesale rather than diffed: the caller sends the set it wants, and a diff
      // would only be a slower way to reach the same two rows.
      await tx.delete(userDepartments).where(eq(userDepartments.userId, userId));
      if (wanted.length > 0) {
        await tx.insert(userDepartments).values(
          wanted.map((departmentId) => ({ userId, departmentId, grantedBy: actor.userId })),
        );
      }
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'person.departments',
        entityType: 'user',
        entityId: userId,
        detail: { departmentIds: wanted },
      });
    });
    return wanted;
  }

  /** `Finance & Admin` → `finance-admin`. Lowercase, no accents, no spaces. */
  private slug(input: string): string {
    return input
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
  }
}
