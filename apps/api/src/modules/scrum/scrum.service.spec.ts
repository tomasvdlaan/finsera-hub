import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@platform/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { resetDb, seedUser, testDb, truncate } from '../../test/db.js';
import { crmManifest } from '../crm/crm.manifest.js';
import { CrmService } from '../crm/crm.service.js';
import { timeManifest } from '../time/time.manifest.js';
import { TimeService } from '../time/time.service.js';
import { scrumManifest } from './scrum.manifest.js';
import { ScrumService } from './scrum.service.js';

const actor: Actor = { userId: crypto.randomUUID(), role: 'admin' };

/**
 * Blockers.
 *
 * The scrum module had no tests, and this adds a lifecycle guarded by a database CHECK — the
 * kind of thing that fails at 3am in a migration rather than in review. Every case here is a
 * way the board could end up lying about what is stuck.
 */
describe('ScrumService blockers', () => {
  let scrum: ScrumService;
  let projectId: string;

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE scrum.tasks, crm.projects, crm.contacts, crm.clients CASCADE`);
    await seedUser(actor.userId, 'admin');

    const manifests = new ManifestRegistry();
    for (const m of [crmManifest, timeManifest, scrumManifest]) manifests.register(m);
    manifests.seal();

    const registry = new RegistryService(testDb, manifests);
    const permissions = new PermissionService(testDb, manifests);
    const audit = new AuditService();
    const links = new LinkService(testDb, registry, permissions, audit, manifests);
    const bus = new EventBus(manifests);
    const crm = new CrmService(testDb, registry, permissions, audit, bus, links);
    const time = new TimeService(testDb, registry, permissions, audit, bus, links, crm);
    scrum = new ScrumService(testDb, registry, permissions, audit, bus, links, crm, time);

    const client = await crm.createClient(actor, { name: 'DocHorse', status: 'active' });
    const project = await crm.createProject(actor, {
      clientId: client.id,
      name: 'Power BI',
      billingModel: 'time_and_materials',
    });
    projectId = project.id;
  });

  const task = (over: Record<string, unknown> = {}) =>
    scrum.createTask(actor, { projectId, title: 'Model the spend dataset', ...over });

  it('records what a card is blocked on, without moving it', () => {
    return task().then(async (created) => {
      const moved = await scrum.moveTask(actor, created.id, { status: 'in_progress' });
      const blocked = await scrum.blockTask(actor, moved.id, {
        reason: 'Waiting on the Snowflake credentials from IT',
      });

      // The whole design decision: a card is blocked *while* being somewhere. A blocked
      // column would have to take it out of in_progress, losing where the work actually is.
      expect(blocked.status).toBe('in_progress');
      expect(blocked.blockedReason).toMatch(/Snowflake/);
      expect(blocked.blockedSince).not.toBeNull();
    });
  });

  it('refuses a blocker with no reason', async () => {
    const created = await task();
    // A red badge nobody can act on. By the time somebody asks, the answer is forgotten —
    // which is the entire failure this feature exists for.
    await expect(scrum.blockTask(actor, created.id, { reason: '   ' })).rejects.toThrow(
      /what it is blocked on/i,
    );
  });

  it('keeps the original date when the reason is rewritten', async () => {
    const created = await task();
    const first = await scrum.blockTask(actor, created.id, { reason: 'Waiting on IT' });
    const reworded = await scrum.blockTask(actor, created.id, {
      reason: 'Waiting on IT for the Snowflake credentials',
    });

    // The clock measures how long the work has been stuck, not how long ago somebody last
    // rephrased it. Resetting it would make a month-old blocker look new every time.
    expect(reworded.blockedSince).toEqual(first.blockedSince);
    expect(reworded.blockedReason).toMatch(/credentials/);
  });

  it('clears all three columns together, as the constraint requires', async () => {
    const created = await task();
    await scrum.blockTask(actor, created.id, { reason: 'Waiting on IT' });
    const cleared = await scrum.unblockTask(actor, created.id);

    expect(cleared.blockedReason).toBeNull();
    expect(cleared.blockedSince).toBeNull();
    expect(cleared.blockedOnUserId).toBeNull();
  });

  it('unblocking something that is not blocked changes nothing', async () => {
    const created = await task();
    const same = await scrum.unblockTask(actor, created.id);
    expect(same.blockedSince).toBeNull();
  });

  it('refuses to wait on somebody who does not exist', async () => {
    const created = await task();
    await expect(
      scrum.blockTask(actor, created.id, {
        reason: 'Waiting on a sign-off',
        blockedOnUserId: crypto.randomUUID(),
      }),
    ).rejects.toThrow(/existing user/i);
  });

  it('can wait on a real person', async () => {
    const created = await task();
    const blocked = await scrum.blockTask(actor, created.id, {
      reason: 'Needs the compliance sign-off',
      blockedOnUserId: actor.userId,
    });
    expect(blocked.blockedOnUserId).toBe(actor.userId);
  });

  it('announces a blocker once, not on every rewording', async () => {
    const created = await task();
    await scrum.blockTask(actor, created.id, { reason: 'Waiting on IT' });
    await scrum.blockTask(actor, created.id, { reason: 'Still waiting on IT' });

    const events = await testDb.execute(
      sql`SELECT event_name FROM core.events WHERE entity_id = ${created.id}`,
    );
    const names = events.rows.map((r) => (r as { event_name: string }).event_name);
    // Two 'task.blocked' events for one blocker would tell a subscriber it got stuck twice.
    expect(names.filter((n) => n === 'task.blocked')).toHaveLength(1);
  });

  it('publishes task.unblocked when it is cleared', async () => {
    const created = await task();
    await scrum.blockTask(actor, created.id, { reason: 'Waiting on IT' });
    await scrum.unblockTask(actor, created.id);

    const events = await testDb.execute(
      sql`SELECT event_name FROM core.events WHERE entity_id = ${created.id}`,
    );
    const names = events.rows.map((r) => (r as { event_name: string }).event_name);
    expect(names).toContain('task.unblocked');
  });

  it('publishes how long it was stuck, since the row stops holding it', async () => {
    const created = await task();
    await scrum.blockTask(actor, created.id, { reason: 'Waiting on IT' });
    await scrum.unblockTask(actor, created.id);

    // Clearing a blocker deletes the reason and the date. How long things sit blocked is the
    // interesting question a month later, so the audit trail keeps it.
    const audit = await testDb.execute(
      sql`SELECT detail FROM core.audit_log
           WHERE entity_id = ${created.id} AND action = 'task.unblock'`,
    );
    const detail = (audit.rows[0] as { detail: Record<string, unknown> }).detail;
    expect(detail.reason).toBe('Waiting on IT');
    expect(detail.blockedForDays).toBe(0);
  });

  it('publishes blocked and days_blocked on the reporting view', async () => {
    await scrum.ensureReportingViews();
    const created = await task();
    await scrum.blockTask(actor, created.id, { reason: 'Waiting on IT' });

    const rows = await testDb.execute(
      sql`SELECT blocked, days_blocked, blocked_since FROM scrum.v_tasks WHERE id = ${created.id}`,
    );
    const row = rows.rows[0] as Record<string, unknown>;
    // The insight rule reads this view, not the table.
    expect(row.blocked).toBe(true);
    expect(Number(row.days_blocked)).toBe(0);
    expect(row.blocked_since).not.toBeNull();
  });
});
