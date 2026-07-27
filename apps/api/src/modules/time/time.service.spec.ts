import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@platform/contracts';
import { eq, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { auditLog, events } from '../../core/db/core.schema.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { resetDb, seedUser, testDb } from '../../test/db.js';
import { crmManifest } from '../crm/crm.manifest.js';
import { CrmService } from '../crm/crm.service.js';
import { timeManifest } from './time.manifest.js';
import { entries } from './time.schema.js';
import { TimeService, addDays, weekStart } from './time.service.js';

const actor: Actor = { userId: crypto.randomUUID(), role: 'admin' };
const MONDAY = '2026-07-27'; // a real Monday

function build() {
  const manifests = new ManifestRegistry();
  manifests.register(crmManifest);
  manifests.register(timeManifest);
  manifests.seal();

  const registry = new RegistryService(testDb, manifests);
  const permissions = new PermissionService(testDb, manifests);
  const audit = new AuditService();
  const links = new LinkService(testDb, registry, permissions, audit);
  const bus = new EventBus(manifests);
  const crm = new CrmService(testDb, registry, permissions, audit, bus, links);
  const time = new TimeService(testDb, registry, permissions, audit, bus, links, crm);
  return { crm, time, links };
}

describe('weekStart', () => {
  it('snaps any day to its Monday', () => {
    expect(weekStart('2026-07-27')).toBe('2026-07-27'); // Monday
    expect(weekStart('2026-07-29')).toBe('2026-07-27'); // Wednesday
    expect(weekStart('2026-08-02')).toBe('2026-07-27'); // Sunday belongs to that week
    expect(weekStart('2026-08-03')).toBe('2026-08-03'); // next Monday
  });
});

describe('TimeService', () => {
  let crm: CrmService;
  let time: TimeService;
  let projectId: string;

  beforeEach(async () => {
    await resetDb();
    await testDb.execute(sql`TRUNCATE time.entries CASCADE`);
    await testDb.execute(sql`TRUNCATE crm.projects, crm.contacts, crm.clients CASCADE`);
    await seedUser(actor.userId, 'admin');
    ({ crm, time } = build());

    const client = await crm.createClient(actor, { name: 'Acme' });
    const project = await crm.createProject(actor, {
      clientId: client.id,
      name: 'Dashboard',
      billingModel: 'time_and_materials',
      defaultRateCents: 12_000, // €120/hr
      budgetHours: 40,
    });
    projectId = project.id;
  });

  // ── logging ──

  it('logs hours, registers the entry, and publishes', async () => {
    const result = await time.logHours(actor, { projectId, workedOn: MONDAY, minutes: 450 });

    expect(result.minutes).toBe(450);
    const [row] = await testDb.select().from(entries).where(eq(entries.id, result.id));
    expect(row).toMatchObject({ minutes: 450, billable: true, personId: actor.userId });

    const names = (await testDb.select().from(events)).map((e) => e.eventName);
    expect(names).toContain('time_entry.created');
  });

  it('rejects a project that does not exist', async () => {
    await expect(
      time.logHours(actor, { projectId: crypto.randomUUID(), workedOn: MONDAY, minutes: 60 }),
    ).rejects.toThrow();
  });

  it('rejects impossible durations', async () => {
    await expect(
      time.logHours(actor, { projectId, workedOn: MONDAY, minutes: 0 }),
    ).rejects.toThrow(/positive/);
    await expect(
      time.logHours(actor, { projectId, workedOn: MONDAY, minutes: 1441 }),
    ).rejects.toThrow(/1440/);
  });

  it('rejects a malformed date', async () => {
    await expect(
      time.logHours(actor, { projectId, workedOn: '27-07-2026', minutes: 60 }),
    ).rejects.toThrow(/ISO/);
  });

  // ── the week grid's write path ──

  it('creates, updates, and clears a cell', async () => {
    await time.setCell(actor, { projectId, workedOn: MONDAY, minutes: 300 });
    expect((await testDb.select().from(entries))[0]!.minutes).toBe(300);

    await time.setCell(actor, { projectId, workedOn: MONDAY, minutes: 450 });
    const afterUpdate = await testDb.select().from(entries);
    expect(afterUpdate).toHaveLength(1); // updated, not duplicated
    expect(afterUpdate[0]!.minutes).toBe(450);

    // Zero clears — typing over and deleting are the same gesture in the grid.
    await time.setCell(actor, { projectId, workedOn: MONDAY, minutes: 0 });
    expect(await testDb.select().from(entries)).toHaveLength(0);
  });

  // ── the week view ──

  it('returns a week shaped for the grid', async () => {
    await time.logHours(actor, { projectId, workedOn: MONDAY, minutes: 450 });
    await time.logHours(actor, { projectId, workedOn: addDays(MONDAY, 1), minutes: 240 });

    const week = await time.getWeek(actor, { weekOf: MONDAY });

    expect(week.weekOf).toBe(MONDAY);
    expect(week.days).toHaveLength(7);
    expect(week.rows).toHaveLength(1);
    expect(week.rows[0]!.days[MONDAY]).toBe(450);
    expect(week.rows[0]!.days[addDays(MONDAY, 1)]).toBe(240);
    expect(week.totalMinutes).toBe(690);
    expect(week.rows[0]!.name).toBe('Dashboard'); // name came from CRM's service
  });

  it('carries last week’s projects forward as empty rows', async () => {
    // Most weeks repeat; pre-listed rows are what make entry fast.
    await time.logHours(actor, { projectId, workedOn: addDays(MONDAY, -7), minutes: 300 });

    const week = await time.getWeek(actor, { weekOf: MONDAY });
    expect(week.rows).toHaveLength(1);
    expect(week.totalMinutes).toBe(0);
    expect(week.rows[0]!.days[MONDAY]).toBe(0);
  });

  it('does not leak another person’s hours into your week', async () => {
    const other = crypto.randomUUID();
    await seedUser(other);
    await time.logHours(actor, { projectId, workedOn: MONDAY, minutes: 450, personId: other });

    const mine = await time.getWeek(actor, { weekOf: MONDAY });
    expect(mine.totalMinutes).toBe(0);
  });

  // ── submission ──

  it('submits a week, locks it, and publishes', async () => {
    await time.logHours(actor, { projectId, workedOn: MONDAY, minutes: 450 });
    await time.submitWeek(actor, MONDAY);

    const [row] = await testDb.select().from(entries);
    expect(row!.submittedAt).not.toBeNull();

    // Invoicing (Phase 5c) keys off this event.
    const names = (await testDb.select().from(events)).map((e) => e.eventName);
    expect(names).toContain('timesheet.submitted');
  });

  it('refuses new hours in a submitted week', async () => {
    await time.logHours(actor, { projectId, workedOn: MONDAY, minutes: 450 });
    await time.submitWeek(actor, MONDAY);

    await expect(
      time.logHours(actor, { projectId, workedOn: addDays(MONDAY, 1), minutes: 60 }),
    ).rejects.toThrow(/submitted/);
  });

  it('refuses to delete an entry in a submitted week', async () => {
    const { id } = await time.logHours(actor, { projectId, workedOn: MONDAY, minutes: 450 });
    await time.submitWeek(actor, MONDAY);
    await expect(time.deleteEntry(actor, id)).rejects.toThrow(/submitted/);
  });

  it('reopens a submitted week so it can be corrected', async () => {
    await time.logHours(actor, { projectId, workedOn: MONDAY, minutes: 450 });
    await time.submitWeek(actor, MONDAY);
    await time.reopenWeek(actor, MONDAY);

    // Real timesheets get corrected; a lock that cannot be undone stops people submitting.
    const [row] = await testDb.select().from(entries);
    expect(row!.submittedAt).toBeNull();
    await expect(
      time.logHours(actor, { projectId, workedOn: addDays(MONDAY, 1), minutes: 60 }),
    ).resolves.toBeDefined();
  });

  it('refuses to submit an empty week', async () => {
    await expect(time.submitWeek(actor, MONDAY)).rejects.toThrow(/Nothing to submit/);
  });

  it('lists weeks with unsubmitted hours', async () => {
    await time.logHours(actor, { projectId, workedOn: MONDAY, minutes: 450 });
    await time.logHours(actor, { projectId, workedOn: addDays(MONDAY, -7), minutes: 300 });

    const { weeks } = await time.unsubmittedWeeks(actor);
    expect(weeks).toHaveLength(2);
    expect(weeks.find((w) => w.weekOf === MONDAY)?.hours).toBe(7.5);
  });

  // ── the cross-module read ──

  it('computes budget burn from CRM’s budget and its own hours', async () => {
    await time.logHours(actor, { projectId, workedOn: MONDAY, minutes: 600 }); // 10h

    const burn = await time.projectBurn(actor, projectId);

    expect(burn).toMatchObject({
      projectName: 'Dashboard', // read through CrmService, never crm.projects
      budgetedHours: 40,
      loggedHours: 10,
      billableHours: 10,
      burnedAmountCents: 120_000, // 10h × €120
    });
  });

  it('reports no monetary burn when the project has no rate', async () => {
    const client = await crm.createClient(actor, { name: 'Fixed Co' });
    const fixed = await crm.createProject(actor, {
      clientId: client.id,
      name: 'Rebuild',
      billingModel: 'fixed_fee',
      budgetAmountCents: 500_000,
    });
    await time.logHours(actor, { projectId: fixed.id, workedOn: MONDAY, minutes: 120 });

    const burn = await time.projectBurn(actor, fixed.id);
    expect(burn.loggedHours).toBe(2);
    expect(burn.burnedAmountCents).toBeNull(); // no rate to multiply by
  });

  it('excludes non-billable hours from the monetary burn', async () => {
    await time.logHours(actor, { projectId, workedOn: MONDAY, minutes: 600 });
    await time.logHours(actor, {
      projectId,
      workedOn: addDays(MONDAY, 1),
      minutes: 300,
      billable: false,
    });

    const burn = await time.projectBurn(actor, projectId);
    expect(burn.loggedHours).toBe(15);
    expect(burn.billableHours).toBe(10);
    expect(burn.burnedAmountCents).toBe(120_000); // only the billable 10h
  });

  // ── links, audit, permissions ──

  it('makes logged hours visible on the project timeline', async () => {
    const { id } = await time.logHours(actor, { projectId, workedOn: MONDAY, minutes: 450 });
    const { links } = build();
    expect(await links.linkedIds(actor, projectId)).toContain(id);
  });

  it('flags AI-logged hours in the audit trail', async () => {
    const { id } = await time.logHours(
      actor,
      { projectId, workedOn: MONDAY, minutes: 60 },
      { aiInitiated: true },
    );
    const [row] = await testDb.select().from(auditLog).where(eq(auditLog.entityId, id));
    expect(row).toMatchObject({ action: 'time_entry.create', aiInitiated: true });
  });

  it('requires the manage capability to log for someone else', async () => {
    const manifests = new ManifestRegistry();
    manifests.register(crmManifest);
    manifests.register(timeManifest);
    manifests.seal();

    const registry = new RegistryService(testDb, manifests);
    const denied = new (class extends PermissionService {
      override async can(a: Actor, capability: string) {
        return capability !== 'time.entries.manage' && super.can(a, capability);
      }
    })(testDb, manifests);
    const audit = new AuditService();
    const links = new LinkService(testDb, registry, denied, audit);
    const bus = new EventBus(manifests);
    const restricted = new TimeService(
      testDb,
      registry,
      denied,
      audit,
      bus,
      links,
      new CrmService(testDb, registry, denied, audit, bus, links),
    );

    await expect(
      restricted.logHours(actor, {
        projectId,
        workedOn: MONDAY,
        minutes: 60,
        personId: crypto.randomUUID(),
      }),
    ).rejects.toThrow(/capability/);
  });
});
