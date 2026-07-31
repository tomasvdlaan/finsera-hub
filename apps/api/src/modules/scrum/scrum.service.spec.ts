import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@platform/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { CommentService } from '../../core/comments/comment.service.js';
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
describe('ScrumService sprints', () => {
  let scrum: ScrumService;
  let projectId: string;

  beforeEach(async () => {
    await resetDb();
    await truncate(
      sql`TRUNCATE scrum.tasks, scrum.sprints, scrum.boards, crm.projects, crm.contacts, crm.clients CASCADE`,
    );
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
    await scrum.getBoard(actor, projectId); // the board exists on first read
  });

  const sprint = (over: Record<string, unknown> = {}) =>
    scrum.createSprint(actor, {
      projectId,
      name: 'Sprint 1',
      goal: 'Ship the spend model',
      startsOn: '2026-07-27',
      endsOn: '2026-08-07',
      ...over,
    });

  it('creates a sprint and opts the board into sprints', async () => {
    const created = await sprint();
    expect(created.state).toBe('planned');
    expect(created.goal).toBe('Ship the spend model');

    // boards.uses_sprints defaulted false and nothing had ever set it, so no board in the
    // database had said it works in sprints.
    const board = await scrum.getBoard(actor, projectId);
    expect(board.usesSprints).toBe(true);
  });

  it('refuses a sprint that ends before it starts', async () => {
    await expect(sprint({ startsOn: '2026-08-07', endsOn: '2026-07-27' })).rejects.toThrow(
      /cannot end before/i,
    );
  });

  it('refuses a second active sprint with a sentence, not a constraint name', async () => {
    const first = await sprint();
    await scrum.startSprint(actor, first.id);
    const second = await sprint({ name: 'Sprint 2' });

    // The partial unique index is the guarantee. Untranslated it surfaces as a 500 and
    // 'sprints_one_active_per_project', which tells the operator nothing.
    await expect(scrum.startSprint(actor, second.id)).rejects.toThrow(/still running/i);
  });

  it('publishes sprint.started, declared since the module was written', async () => {
    const created = await sprint();
    await scrum.startSprint(actor, created.id);

    const events = await testDb.execute(
      sql`SELECT event_name FROM core.events WHERE entity_id = ${created.id}`,
    );
    expect(events.rows.map((r) => (r as { event_name: string }).event_name)).toContain(
      'sprint.started',
    );
  });

  it('hands unfinished work back to the backlog when it closes', async () => {
    const created = await sprint();
    await scrum.startSprint(actor, created.id);
    const unfinished = await scrum.createTask(actor, {
      projectId,
      title: 'Not going to happen',
      sprintId: created.id,
    });
    const finished = await scrum.createTask(actor, {
      projectId,
      title: 'Did happen',
      sprintId: created.id,
    });
    await scrum.moveTask(actor, finished.id, { status: 'done' });

    await scrum.completeSprint(actor, created.id);

    // A sprint records what a fortnight actually contained. Dragging its failures into the
    // next one makes both of them lies, so the work returns to the backlog to be argued for.
    expect((await scrum.getTask(actor, unfinished.id)).sprintId).toBeNull();
    expect((await scrum.getTask(actor, finished.id)).sprintId).toBe(created.id);
  });

  it('refuses to restart a finished sprint', async () => {
    const created = await sprint();
    await scrum.startSprint(actor, created.id);
    await scrum.completeSprint(actor, created.id);
    await expect(scrum.startSprint(actor, created.id)).rejects.toThrow(/finished/i);
  });

  // ── the unit, which is the part that can quietly lie ──

  it('reports points only when every card has them', async () => {
    const created = await sprint();
    await scrum.createTask(actor, { projectId, title: 'A', sprintId: created.id, storyPoints: 3 });
    const b = await scrum.createTask(actor, {
      projectId,
      title: 'B',
      sprintId: created.id,
      storyPoints: 5,
    });
    await scrum.moveTask(actor, b.id, { status: 'done' });

    const { progress } = await scrum.getSprint(actor, created.id);
    expect(progress.unit).toBe('points');
    expect(progress.points).toEqual({ done: 5, total: 8 });
  });

  it('falls back to hours when nothing is pointed', async () => {
    const created = await sprint();
    await scrum.createTask(actor, {
      projectId,
      title: 'A',
      sprintId: created.id,
      estimateMinutes: 120,
    });
    const { progress } = await scrum.getSprint(actor, created.id);
    expect(progress.unit).toBe('minutes');
    expect(progress.minutes.total).toBe(120);
  });

  it('counts cards rather than mixing units on a half-pointed sprint', async () => {
    const created = await sprint();
    await scrum.createTask(actor, { projectId, title: 'A', sprintId: created.id, storyPoints: 3 });
    await scrum.createTask(actor, {
      projectId,
      title: 'B',
      sprintId: created.id,
      estimateMinutes: 60,
    });

    // A percentage computed from a partly-estimated backlog is a chart that quietly lies, and
    // it lies in the flattering direction. Counting cards is the honest answer.
    const { progress } = await scrum.getSprint(actor, created.id);
    expect(progress.unit).toBe('count');
    expect(progress.cards).toEqual({ done: 0, total: 2 });
  });

  it('counts cards for an empty sprint rather than claiming a full one', async () => {
    const created = await sprint();
    const { progress } = await scrum.getSprint(actor, created.id);
    // 0 of 0 points would render as 100% complete on any progress bar.
    expect(progress.unit).toBe('count');
    expect(progress.cards).toEqual({ done: 0, total: 0 });
  });

  it('counts blocked cards that are not done', async () => {
    const created = await sprint();
    const a = await scrum.createTask(actor, { projectId, title: 'A', sprintId: created.id });
    await scrum.blockTask(actor, a.id, { reason: 'Waiting on IT' });

    const { progress } = await scrum.getSprint(actor, created.id);
    expect(progress.blocked).toBe(1);
  });

  it('says a sprint has overrun rather than counting past its length', async () => {
    const created = await sprint({ startsOn: '2026-07-01', endsOn: '2026-07-10' });
    const { progress } = await scrum.getSprint(actor, created.id);

    // "Day 14 of 10" on a top bar forever is how a sprint that nobody closed starts lying.
    expect(progress.days.total).toBe(10);
    expect(progress.days.elapsed).toBe(10);
    expect(progress.days.overrun).toBe(true);
  });

  it('ignores archived cards, which used to inflate a sprint as it was tidied', async () => {
    await scrum.ensureReportingViews();
    const created = await sprint();
    const a = await scrum.createTask(actor, { projectId, title: 'A', sprintId: created.id });
    await scrum.createTask(actor, { projectId, title: 'B', sprintId: created.id });
    await scrum.archiveTask(actor, a.id);

    const { progress } = await scrum.getSprint(actor, created.id);
    expect(progress.cards.total).toBe(1);

    const rows = await testDb.execute(
      sql`SELECT task_count FROM scrum.v_sprints WHERE id = ${created.id}`,
    );
    expect(Number((rows.rows[0] as { task_count: string }).task_count)).toBe(1);
  });
});

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

/**
 * Card age, task type, and the comment count on the board.
 *
 * Card age gets a test because it is derived rather than stored, and derived numbers rot
 * quietly — the failure mode is not an error, it is a board that says a stuck card is fresh.
 *
 * The count is tested against `core.comments` on purpose. Discussion on any record already
 * lives there, and the count on the card has to be the same number as the thread beneath it;
 * a scrum-local comments table would have made those two disagree.
 */
describe('ScrumService card age, type and comment counts', () => {
  let scrum: ScrumService;
  let comments: CommentService;
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
    comments = new CommentService(testDb, registry, permissions, audit);

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

  it('measures age from the last move, not the last edit', async () => {
    const created = await task();
    await scrum.moveTask(actor, created.id, { status: 'in_progress' });

    // Backdate the arrival, then touch the card. `updatedAt` jumps; the age must not.
    await testDb.execute(
      sql`UPDATE scrum.task_transitions SET at = now() - interval '9 days'
          WHERE task_id = ${created.id} AND to_status = 'in_progress'`,
    );
    await scrum.updateTask(actor, created.id, { title: 'Model the spend dataset (v2)' });

    const [row] = await scrum.listTasks(actor, { projectId });
    expect(row?.daysInColumn).toBe(9);
  });

  it('records a transition when the edit form moves the card', async () => {
    const created = await task();
    await scrum.updateTask(actor, created.id, { status: 'in_progress' });

    const rows = await testDb.execute(
      sql`SELECT from_status, to_status FROM scrum.task_transitions
          WHERE task_id = ${created.id} ORDER BY at`,
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[1]).toMatchObject({ from_status: 'to_do', to_status: 'in_progress' });
  });

  it('refuses a task type it cannot report on', async () => {
    await expect(task({ type: 'epic' })).rejects.toThrow(/type/i);
    const spike = await task({ type: 'spike' });
    expect(spike.type).toBe('spike');
  });

  it('counts the discussion on the card, and forgets what was deleted', async () => {
    const talkative = await task();
    const quiet = await task({ title: 'Nobody has said anything' });
    await comments.add(actor, { subjectId: talkative.id, body: 'Blocked on the export format.' });
    const second = await comments.add(actor, { subjectId: talkative.id, body: 'CSV it is.' });

    const before = new Map((await scrum.listTasks(actor, { projectId })).map((r) => [r.id, r]));
    expect(before.get(talkative.id)?.commentCount).toBe(2);
    // Zero rather than undefined: the card renders the same either way, and the type should
    // not make the caller think about it.
    expect(before.get(quiet.id)?.commentCount).toBe(0);

    // Comments are soft-deleted so replies keep their parent — but a tombstone is not a
    // remark, and counting it would leave a card advertising a conversation that is not there.
    await comments.remove(actor, second.id);
    const after = new Map((await scrum.listTasks(actor, { projectId })).map((r) => [r.id, r]));
    expect(after.get(talkative.id)?.commentCount).toBe(1);
  });
});
