import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@platform/contracts';
import { eq, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { auditLog, events, users } from '../../core/db/core.schema.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { resetDb, seedUser, testDb, truncate } from '../../test/db.js';
import { crmManifest } from '../crm/crm.manifest.js';
import { CrmService } from '../crm/crm.service.js';
import { timeManifest } from './time.manifest.js';
import { entries, timesheets } from './time.schema.js';
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
  const links = new LinkService(testDb, registry, permissions, audit, manifests);
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
  let clientId: string;

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE time.entries, time.timesheets CASCADE`);
    await truncate(sql`TRUNCATE crm.projects, crm.contacts, crm.clients CASCADE`);
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
    clientId = client.id;
  });

  // ── logging ──

  it('logs hours, registers the entry, and publishes', async () => {
    const result = await time.createEntry(actor, { projectId, workedOn: MONDAY, minutes: 450 });

    expect(result.minutes).toBe(450);
    const [row] = await testDb.select().from(entries).where(eq(entries.id, result.id));
    expect(row).toMatchObject({ minutes: 450, billable: true, personId: actor.userId });

    const names = (await testDb.select().from(events)).map((e) => e.eventName);
    expect(names).toContain('time_entry.created');
  });

  it('rejects a project that does not exist', async () => {
    await expect(
      time.createEntry(actor, { projectId: crypto.randomUUID(), workedOn: MONDAY, minutes: 60 }),
    ).rejects.toThrow();
  });

  it('rejects impossible durations', async () => {
    await expect(
      time.createEntry(actor, { projectId, workedOn: MONDAY, minutes: 0 }),
    ).rejects.toThrow(/positive/);
    await expect(
      time.createEntry(actor, { projectId, workedOn: MONDAY, minutes: 1441 }),
    ).rejects.toThrow(/1440/);
  });

  it('rejects a malformed date', async () => {
    await expect(
      time.createEntry(actor, { projectId, workedOn: '27-07-2026', minutes: 60 }),
    ).rejects.toThrow(/ISO/);
  });

  // ── the week grid's write path ──

  it('allows several entries for the same project on one day', async () => {
    // Start/end times mean a day can hold a morning and an afternoon session on the
    // same project — the old one-cell-per-project-per-day model could not express this.
    await time.createEntry(actor, {
      projectId,
      workedOn: MONDAY,
      startedAt: `${MONDAY}T09:00:00Z`,
      endedAt: `${MONDAY}T12:30:00Z`,
    });
    await time.createEntry(actor, {
      projectId,
      workedOn: MONDAY,
      startedAt: `${MONDAY}T13:30:00Z`,
      endedAt: `${MONDAY}T17:00:00Z`,
    });

    const day = await time.getDay(actor, { date: MONDAY });
    expect(day.entries).toHaveLength(2);
    expect(day.totalMinutes).toBe(210 + 210);
  });

  it('derives minutes from start and end times', async () => {
    const entry = await time.createEntry(actor, {
      projectId,
      workedOn: MONDAY,
      startedAt: `${MONDAY}T09:00:00Z`,
      endedAt: `${MONDAY}T10:30:00Z`,
    });
    expect(entry.minutes).toBe(90);
  });

  it('accepts a session that crosses midnight', async () => {
    // A late shift: 22:00 Monday to 02:00 Tuesday is four hours. The entry stays
    // attributed to the day it started, which is how the day view groups it.
    const entry = await time.createEntry(actor, {
      projectId,
      workedOn: MONDAY,
      startedAt: `${MONDAY}T22:00:00Z`,
      endedAt: `${addDays(MONDAY, 1)}T02:00:00Z`,
    });

    expect(entry.minutes).toBe(240);
    expect(entry.workedOn).toBe(MONDAY);

    const day = await time.getDay(actor, { date: MONDAY });
    expect(day.totalMinutes).toBe(240);
    // Not double-counted on the following day.
    const next = await time.getDay(actor, { date: addDays(MONDAY, 1) });
    expect(next.totalMinutes).toBe(0);
  });

  it('caps a cross-midnight session at 24 hours', async () => {
    await expect(
      time.createEntry(actor, {
        projectId,
        workedOn: MONDAY,
        startedAt: `${MONDAY}T09:00:00Z`,
        endedAt: `${addDays(MONDAY, 2)}T09:00:00Z`, // 48 hours
      }),
    ).rejects.toThrow(/1440/);
  });

  it('rejects an end before the start', async () => {
    await expect(
      time.createEntry(actor, {
        projectId,
        workedOn: MONDAY,
        startedAt: `${MONDAY}T10:00:00Z`,
        endedAt: `${MONDAY}T09:00:00Z`,
      }),
    ).rejects.toThrow(/after start/);
  });

  it('rejects an end time with no start', async () => {
    await expect(
      time.createEntry(actor, { projectId, workedOn: MONDAY, endedAt: `${MONDAY}T10:00:00Z` }),
    ).rejects.toThrow(/needs a start/);
  });

  it('rejects an entry with neither duration nor start', async () => {
    await expect(
      time.createEntry(actor, { projectId, workedOn: MONDAY }),
    ).rejects.toThrow(/duration, or a start/);
  });

  // ── the running timer: a start with no end ──

  it('treats a start without an end as a running timer', async () => {
    const entry = await time.createEntry(actor, {
      projectId,
      workedOn: MONDAY,
      startedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    });

    // No separate timer state: running IS "started, not ended".
    expect(entry.running).toBe(true);
    expect(entry.minutes).toBeNull();
    // Elapsed time is computed live, or a timer running since morning shows as zero.
    expect(entry.effectiveMinutes).toBeGreaterThanOrEqual(29);
  });

  it('allows only one running timer per person', async () => {
    await time.createEntry(actor, { projectId, startedAt: new Date().toISOString() });
    await expect(
      time.createEntry(actor, { projectId, startedAt: new Date().toISOString() }),
    ).rejects.toThrow(/already running/);
  });

  it('stops a running timer and freezes the elapsed minutes', async () => {
    await time.createEntry(actor, {
      projectId,
      startedAt: new Date(Date.now() - 45 * 60_000).toISOString(),
    });
    const stopped = await time.stopEntry(actor);

    expect(stopped.running).toBe(false);
    expect(stopped.minutes).toBeGreaterThanOrEqual(44);
    expect(stopped.endedAt).not.toBeNull();
  });

  /*
   * The clock somebody left running over a weekend.
   *
   * Elapsed minutes went straight into a column capped at a day, so the stop died on the
   * check constraint as a 500 and the timer kept running — the failure made itself worse
   * every minute it lasted.
   */
  it('refuses a stop it cannot save, and takes the real hours instead', async () => {
    await time.createEntry(actor, {
      projectId,
      startedAt: new Date(Date.now() - 52 * 60 * 60_000).toISOString(),
    });

    await expect(time.stopEntry(actor)).rejects.toThrow(/longer than a day/);

    const stopped = await time.stopEntry(actor, undefined, { minutes: 180 });
    expect(stopped.running).toBe(false);
    expect(stopped.minutes).toBe(180);
    // The end sits three hours after the start, not at the moment of the stop — so the entry
    // reads as the session that was worked.
    expect(new Date(stopped.endedAt!).getTime() - new Date(stopped.startedAt!).getTime()).toBe(
      180 * 60_000,
    );
  });

  it('refuses a correction longer than a day as well', async () => {
    await time.createEntry(actor, {
      projectId,
      startedAt: new Date(Date.now() - 52 * 60 * 60_000).toISOString(),
    });
    await expect(time.stopEntry(actor, undefined, { minutes: 2000 })).rejects.toThrow(
      /1440 minutes/,
    );
  });

  it('refuses to stop when nothing is running', async () => {
    await expect(time.stopEntry(actor)).rejects.toThrow(/Nothing is running/);
  });

  it('records an optional description', async () => {
    const entry = await time.createEntry(actor, {
      projectId,
      workedOn: MONDAY,
      minutes: 60,
      description: 'Refactored the ETL job',
    });
    expect(entry.description).toBe('Refactored the ETL job');
  });

  it('marks an entry non-billable on request', async () => {
    const entry = await time.createEntry(actor, {
      projectId,
      workedOn: MONDAY,
      minutes: 60,
      billable: false,
    });
    expect(entry.billable).toBe(false);

    const day = await time.getDay(actor, { date: MONDAY });
    expect(day.totalMinutes).toBe(60);
    expect(day.billableMinutes).toBe(0);
  });

  // ── the week view ──

  it('returns a week shaped for the grid', async () => {
    await time.createEntry(actor, { projectId, workedOn: MONDAY, minutes: 450 });
    await time.createEntry(actor, { projectId, workedOn: addDays(MONDAY, 1), minutes: 240 });

    const week = await time.getWeek(actor, { weekOf: MONDAY });

    expect(week.weekOf).toBe(MONDAY);
    expect(week.days).toHaveLength(7);
    expect(week.rows).toHaveLength(1);
    expect(week.rows[0]!.days[MONDAY]).toBe(450);
    expect(week.rows[0]!.days[addDays(MONDAY, 1)]).toBe(240);
    expect(week.totalMinutes).toBe(690);
    expect(week.rows[0]!.name).toBe('Dashboard'); // name came from CRM's service
  });

  it('does not leak another person’s hours into your week', async () => {
    const other = crypto.randomUUID();
    await seedUser(other);
    await time.createEntry(actor, { projectId, workedOn: MONDAY, minutes: 450, personId: other });

    const mine = await time.getWeek(actor, { weekOf: MONDAY });
    expect(mine.totalMinutes).toBe(0);
  });

  // ── what may still be changed ──

  it('lets hours be added to any week, however old', async () => {
    // There is no submission step and no week lock: the timesheet is always open.
    // Only invoicing freezes hours (see billing.service.spec.ts).
    await time.createEntry(actor, { projectId, workedOn: MONDAY, minutes: 450 });
    await expect(
      time.createEntry(actor, { projectId, workedOn: addDays(MONDAY, -365), minutes: 60 }),
    ).resolves.toBeDefined();
  });

  /*
   * Invoiced hours are frozen, and this is the guard that protects the money.
   *
   * The tracker now offers edit and delete on every row, and it disables both on an invoiced
   * entry — but a disabled button is a courtesy, not a control. This is the control.
   */
  it('refuses to change or delete hours that are on an issued invoice', async () => {
    const { id } = await time.createEntry(actor, { projectId, workedOn: MONDAY, minutes: 60 });
    // invoiceId is a registry id rather than a foreign key, so the pair can be set directly;
    // the CHECK only insists the stamp cannot float free of an invoice.
    await testDb.execute(
      sql`UPDATE time.entries SET invoice_id = ${crypto.randomUUID()}, invoiced_at = now()
          WHERE id = ${id}`,
    );

    await expect(time.updateEntry(actor, id, { minutes: 500 })).rejects.toThrow(/credit the invoice/i);
    await expect(time.deleteEntry(actor, id)).rejects.toThrow(/credit the invoice/i);

    // And it is still there afterwards, which is the point.
    const rows = await testDb.execute(sql`SELECT count(*)::int n FROM time.entries WHERE id = ${id}`);
    expect((rows.rows[0] as { n: number }).n).toBe(1);
  });

  it('lets an old entry be edited and deleted', async () => {
    const { id } = await time.createEntry(actor, { projectId, workedOn: MONDAY, minutes: 450 });
    await expect(time.updateEntry(actor, id, { minutes: 500 })).resolves.toBeDefined();
    await expect(time.deleteEntry(actor, id)).resolves.toBeUndefined();
  });

  // ── the cross-module read ──

  it('computes budget burn from CRM’s budget and its own hours', async () => {
    await time.createEntry(actor, { projectId, workedOn: MONDAY, minutes: 600 }); // 10h

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
    await time.createEntry(actor, { projectId: fixed.id, workedOn: MONDAY, minutes: 120 });

    const burn = await time.projectBurn(actor, fixed.id);
    expect(burn.loggedHours).toBe(2);
    expect(burn.burnedAmountCents).toBeNull(); // no rate to multiply by
  });

  it('excludes non-billable hours from the monetary burn', async () => {
    await time.createEntry(actor, { projectId, workedOn: MONDAY, minutes: 600 });
    await time.createEntry(actor, {
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
    const { id } = await time.createEntry(actor, { projectId, workedOn: MONDAY, minutes: 450 });
    const { links } = build();
    expect(await links.linkedIds(actor, projectId)).toContain(id);
  });

  it('flags AI-logged hours in the audit trail', async () => {
    const { id } = await time.createEntry(
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
    const links = new LinkService(testDb, registry, denied, audit, manifests);
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
      restricted.createEntry(actor, {
        projectId,
        workedOn: MONDAY,
        minutes: 60,
        personId: crypto.randomUUID(),
      }),
    ).rejects.toThrow(/capability/);
  });


  /**
   * What an hour is allowed to point at.
   *
   * Both ids were once required, which forced every hour onto a billable project of a paying
   * customer — and the visible result was Finsera registering itself as its own client and
   * opening a time-and-materials project to log building this platform against. A fake customer
   * and a fake sale, in the pipeline and the burn reports, because the schema left nowhere else
   * for the time to go.
   */
  describe('what an hour is against', () => {
    it('records work on a project, billable by default', async () => {
      const entry = await time.createEntry(actor, { projectId, workedOn: MONDAY, minutes: 60 });
      expect(entry.projectId).toBe(projectId);
      expect(entry.clientId).toBeNull();
      expect(entry.billable).toBe(true);
    });

    /** Scoping, pre-sales, account care — real work for a client with no project yet. */
    it('records work for a client with no project', async () => {
      const entry = await time.createEntry(actor, { clientId, workedOn: MONDAY, minutes: 30 });
      expect(entry.clientId).toBe(clientId);
      expect(entry.projectId).toBeNull();
      // Not billable by default: winning the work is a cost of the work, not the work.
      expect(entry.billable).toBe(false);
    });

    it('records internal work against nothing at all', async () => {
      const entry = await time.createEntry(actor, { workedOn: MONDAY, minutes: 120 });
      expect(entry.projectId).toBeNull();
      expect(entry.clientId).toBeNull();
      expect(entry.billable).toBe(false);
    });

    it('refuses a project and a client at once', async () => {
      // The project already has a client; storing a second one lets them disagree.
      await expect(
        time.createEntry(actor, { projectId, clientId, workedOn: MONDAY, minutes: 60 }),
      ).rejects.toThrow(/not both/i);
    });

    /**
     * The invariant the revenue figures rest on.
     *
     * An unattributed hour marked billable is an hour the business believes it can invoice and
     * cannot. Enforced by the database as well as here.
     */
    it('will not mark an unattributed hour billable', async () => {
      const entry = await time.createEntry(actor, { workedOn: MONDAY, minutes: 60, billable: true });
      expect(entry.billable).toBe(false);
    });

    it('clears billable when an hour is moved off its project', async () => {
      const entry = await time.createEntry(actor, { projectId, workedOn: MONDAY, minutes: 60 });
      expect(entry.billable).toBe(true);

      const moved = await time.updateEntry(actor, entry.id, { projectId: null });
      expect(moved.projectId).toBeNull();
      expect(moved.billable).toBe(false);
    });

    it('moves an hour from a project to a client', async () => {
      const entry = await time.createEntry(actor, { projectId, workedOn: MONDAY, minutes: 60 });
      const moved = await time.updateEntry(actor, entry.id, { projectId: null, clientId });
      expect(moved.clientId).toBe(clientId);
      expect(moved.projectId).toBeNull();
    });

    it('names internal hours rather than leaving them blank', async () => {
      await time.createEntry(actor, { workedOn: MONDAY, minutes: 60 });
      const day = await time.getDay(actor, { date: MONDAY });
      // A blank cell where a project name goes reads as a failure to load.
      expect(day.entries[0]!.targetName).toBe('Internal');
    });
  });
});

// ── approval ──

describe('approving a week', () => {
  let crm: CrmService;
  let time: TimeService;
  let projectId: string;

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE time.entries, time.timesheets CASCADE`);
    await truncate(sql`TRUNCATE crm.projects, crm.contacts, crm.clients CASCADE`);
    await seedUser(actor.userId, 'admin');
    ({ crm, time } = build());
    const client = await crm.createClient(actor, { name: 'Acme' });
    const project = await crm.createProject(actor, {
      clientId: client.id,
      name: 'Dashboard',
      billingModel: 'time_and_materials',
      defaultRateCents: 12_000,
    });
    projectId = project.id;
    await time.createEntry(actor, { projectId, workedOn: MONDAY, minutes: 480 });
  });

  it('bills an unsubmitted week exactly as before', async () => {
    // The whole safety property: turning approval on changes nothing until somebody uses it,
    // so hours logged before it existed keep flowing to an invoice.
    expect(await time.timesheet(actor, { weekOf: MONDAY })).toBeNull();
    expect(await time.entriesForBilling(projectId)).toHaveLength(1);
  });

  it('holds a submitted week back until somebody decides', async () => {
    await time.submitWeek(actor, MONDAY);
    expect(await time.entriesForBilling(projectId)).toHaveLength(0);

    await time.decideWeek(actor, { personId: actor.userId!, weekOf: MONDAY, approve: true });
    expect(await time.entriesForBilling(projectId)).toHaveLength(1);
  });

  it('keeps holding a week that was sent back', async () => {
    await time.submitWeek(actor, MONDAY);
    await time.decideWeek(actor, {
      personId: actor.userId!,
      weekOf: MONDAY,
      approve: false,
      note: 'Two entries have no card',
    });
    expect(await time.entriesForBilling(projectId)).toHaveLength(0);

    // Fixed and re-sent: the ordinary path, and it clears the stale reason on the way.
    const again = await time.submitWeek(actor, MONDAY);
    expect(again?.status).toBe('submitted');
    expect(again?.note).toBeNull();
  });

  it('refuses to send a week back without saying why', async () => {
    await time.submitWeek(actor, MONDAY);
    await expect(
      time.decideWeek(actor, { personId: actor.userId!, weekOf: MONDAY, approve: false }),
    ).rejects.toThrow(/why/i);
  });

  it('only lets a week be decided once', async () => {
    await time.submitWeek(actor, MONDAY);
    await time.decideWeek(actor, { personId: actor.userId!, weekOf: MONDAY, approve: true });
    // A second approver must not silently overwrite the first — the trail would show only the
    // last opinion.
    await expect(
      time.decideWeek(actor, { personId: actor.userId!, weekOf: MONDAY, approve: true }),
    ).rejects.toThrow(/waiting on a decision/i);
  });

  it('will not re-submit a week that has been approved', async () => {
    await time.submitWeek(actor, MONDAY);
    await time.decideWeek(actor, { personId: actor.userId!, weekOf: MONDAY, approve: true });
    await expect(time.submitWeek(actor, MONDAY)).rejects.toThrow(/already been approved/i);
  });

  it('snaps a mid-week date to its Monday', async () => {
    // Every week in this system starts on one, and the database refuses anything else — so a
    // caller passing Wednesday must land on the same row as one passing Monday.
    await time.submitWeek(actor, '2026-07-29');
    const [row] = await testDb.select().from(timesheets);
    expect(row?.weekOf).toBe(MONDAY);
  });

  it('lists what is waiting, with what is in it', async () => {
    await time.submitWeek(actor, MONDAY);
    const pending = await time.pendingWeeks(actor);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ minutes: 480, entries: 1, weekOf: MONDAY });
    // The count an approver would otherwise have to go and look for.
    expect(pending[0]?.withoutTask).toBe(1);
  });

  it('records who decided, and says so in the audit log', async () => {
    await time.submitWeek(actor, MONDAY);
    const row = await time.decideWeek(actor, { personId: actor.userId!, weekOf: MONDAY, approve: true });
    expect(row?.decidedBy).toBe(actor.userId);

    const log = await testDb.select().from(auditLog);
    expect(log.map((l) => l.action)).toContain('time.week.approved');
  });
});

/**
 * Hours, out of the platform.
 *
 * The behaviour worth pinning is not the CSV shape — `csv.spec.ts` covers that — it is who may
 * ask for what, and what happens when a rate was never set. Both are the kind of thing a later
 * refactor breaks quietly: the first by widening a capability, the second by reaching for a
 * plausible default.
 */
describe('exporting hours', () => {
  let crm: CrmService;
  let time: TimeService;
  let projectId: string;
  const mate = crypto.randomUUID();
  const member: Actor = { userId: mate, role: 'member' };

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE time.entries, time.timesheets CASCADE`);
    await truncate(sql`TRUNCATE crm.projects, crm.contacts, crm.clients CASCADE`);
    await seedUser(actor.userId, 'admin');
    await seedUser(mate, 'member');
    ({ crm, time } = build());

    const client = await crm.createClient(actor, { name: 'DocHorse' });
    const project = await crm.createProject(actor, {
      clientId: client.id,
      name: 'Power BI portal',
      billingModel: 'time_and_materials',
      defaultRateCents: 13500,
    });
    projectId = project.id;

    await time.createEntry(actor, {
      projectId,
      workedOn: MONDAY,
      minutes: 90,
      billable: true,
      description: 'Modelling; the "spend" set',
    });
  });

  it('writes one row per entry, with the description quoted so the row survives', async () => {
    const { csv, filename } = await time.exportHours(actor, { from: MONDAY, to: MONDAY });
    expect(filename).toMatch(/^uren_entries_mijn_2026-07-27\.csv$/);
    expect(csv).toContain('"Modelling; the ""spend"" set"');
    // 90 minutes, in the notation a Dutch spreadsheet adds up.
    expect(csv).toContain(';1,50;');
  });

  it('groups by week for the summary, and by the whole period for payroll', async () => {
    const summary = await time.exportHours(actor, { from: MONDAY, to: '2026-08-02', shape: 'summary' });
    expect(summary.csv).toContain('Week van');
    expect(summary.csv).toContain(MONDAY);

    const payroll = await time.exportHours(actor, { from: MONDAY, to: '2026-08-02', shape: 'payroll' });
    // Payroll is told hours and nothing about who the work was for.
    expect(payroll.csv).toContain('Persoon;Periode;Uren');
    expect(payroll.csv).not.toContain('DocHorse');
    expect(payroll.csv).not.toContain('Power BI portal');
  });

  it('refuses a shape it does not have', async () => {
    await expect(
      time.exportHours(actor, { from: MONDAY, to: MONDAY, shape: 'invoice' }),
    ).rejects.toThrow(/Unknown export shape/);
  });

  it('refuses a period that runs backwards', async () => {
    await expect(
      time.exportHours(actor, { from: '2026-08-02', to: MONDAY }),
    ).rejects.toThrow(/comes before its start/);
  });

  it('lets anybody export their own hours', async () => {
    const { csv } = await time.exportHours(member, { from: MONDAY, to: MONDAY });
    // Their own week is empty, which is a file with a header and no rows — not a refusal.
    expect(csv).toContain('Persoon;Datum');
  });

  it("refuses a member somebody else's hours, and the whole team's", async () => {
    await expect(
      time.exportHours(member, { from: MONDAY, to: MONDAY, personId: actor.userId! }),
    ).rejects.toThrow(/time.entries.read_all/);
    await expect(
      time.exportHours(member, { from: MONDAY, to: MONDAY, personId: 'all' }),
    ).rejects.toThrow(/time.entries.read_all/);
  });

  it('refuses cost columns rather than quietly dropping them', async () => {
    // The whole point: a file that silently arrives without the columns somebody asked for is
    // worse than one that refuses, because they will read the total as the whole answer.
    await expect(
      time.exportHours(member, { from: MONDAY, to: MONDAY, costs: true }),
    ).rejects.toThrow(/time.costs.read/);
  });

  it('leaves cost and margin blank when no rate was ever set, rather than calling it zero', async () => {
    const { csv } = await time.exportHours(actor, { from: MONDAY, to: MONDAY, costs: true });
    expect(csv).toContain('Kosten;Omzet;Marge');
    const row = csv.split('\r\n')[1]!;
    // Revenue is known — the project has a rate. Cost is not, because nobody set one on the
    // person, so cost and the margin that depends on it are empty.
    expect(row.endsWith(';;202,50;')).toBe(true);
  });

  it('computes margin once both rates exist', async () => {
    await testDb.update(users).set({ costRateCents: 4850 }).where(eq(users.id, actor.userId!));
    const { csv } = await time.exportHours(actor, { from: MONDAY, to: MONDAY, costs: true });
    // 1,5h at €48,50 cost and €135,00 revenue: 72,75 and 202,50, so 129,75 of margin.
    expect(csv).toContain(';72,75;202,50;129,75');
  });
});

