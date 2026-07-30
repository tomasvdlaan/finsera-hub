import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { and, asc, desc, eq, inArray, isNull, lte, notInArray, or, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { users } from '../../core/db/core.schema.js';
import { DB, type Database } from '../../core/db/db.module.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { CrmService } from '../crm/crm.service.js';
import { TimeService } from '../time/time.service.js';
import {
  DEFAULT_COLUMNS,
  PRIORITIES,
  boards,
  sprints,
  tasks,
  type BoardColumn,
} from './scrum.schema.js';

export interface CreateTaskInput {
  projectId: string;
  title: string;
  description?: string | null;
  status?: string;
  assigneeId?: string | null;
  estimateMinutes?: number | null;
  storyPoints?: number | null;
  priority?: string;
  labels?: string[];
  dueOn?: string | null;
  parentId?: string | null;
  sprintId?: string | null;
}

/** Gap between ranks, so a card can always be dropped between two others without a rewrite. */
const RANK_STEP = 1000;

@Injectable()
export class ScrumService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly registry: RegistryService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly links: LinkService,
    private readonly crm: CrmService,
    private readonly time: TimeService,
  ) {}

  // ── board ──────────────────────────────────────────────────

  /** A project has a board the first time it is opened; no setup step. */
  async getBoard(actor: Actor, projectId: string) {
    await this.require(actor, 'scrum.tasks.read');
    await this.crm.getProject(actor, projectId); // cross-module read, service not schema

    const [existing] = await this.db
      .select()
      .from(boards)
      .where(eq(boards.projectId, projectId))
      .limit(1);
    if (existing) return existing;

    const [created] = await this.db
      .insert(boards)
      .values({ projectId, columns: DEFAULT_COLUMNS })
      .onConflictDoNothing()
      .returning();
    return created ?? { projectId, columns: DEFAULT_COLUMNS, usesSprints: false };
  }

  async updateBoard(
    actor: Actor,
    projectId: string,
    patch: { columns?: BoardColumn[]; usesSprints?: boolean },
  ) {
    await this.require(actor, 'scrum.board.manage');
    const board = await this.getBoard(actor, projectId);

    if (patch.columns) {
      if (patch.columns.length === 0) throw new BadRequestException('A board needs columns');
      if (!patch.columns.some((c) => c.isDone)) {
        // Without a done column nothing can ever complete, and completed_at never sets.
        throw new BadRequestException('At least one column must be a done column');
      }
      const keys = new Set(patch.columns.map((c) => c.key));
      if (keys.size !== patch.columns.length) {
        throw new BadRequestException('Column keys must be unique');
      }
      // Removing a column would strand every task sitting in it.
      const inUse = await this.db
        .selectDistinct({ status: tasks.status })
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId), isNull(tasks.archivedAt)));
      const orphaned = inUse.map((r) => r.status).filter((s) => !keys.has(s));
      if (orphaned.length > 0) {
        throw new BadRequestException(
          `Move the tasks out of ${orphaned.join(', ')} before removing those columns`,
        );
      }
    }

    await this.db
      .update(boards)
      .set({
        columns: patch.columns ?? board.columns,
        usesSprints: patch.usesSprints ?? board.usesSprints,
        updatedAt: new Date(),
      })
      .where(eq(boards.projectId, projectId));

    return this.getBoard(actor, projectId);
  }

  // ── sprints ────────────────────────────────────────────────

  /*
   * The sprints table, its foreign key, its one-active-per-project unique index, its state
   * and date checks and its published view have all existed since migration 0006. Nothing
   * ever created a sprint, so `tasks.sprint_id` was null on every row in the database and
   * `boards.uses_sprints` was false on every board. This is the code that was missing.
   */

  async listSprints(actor: Actor, projectId: string) {
    await this.require(actor, 'scrum.tasks.read');
    await this.crm.getProject(actor, projectId);
    return this.db
      .select()
      .from(sprints)
      .where(eq(sprints.projectId, projectId))
      .orderBy(desc(sprints.startsOn));
  }

  /** The one that is running, if any. At most one, guaranteed by the database. */
  async activeSprint(projectId: string) {
    const [found] = await this.db
      .select()
      .from(sprints)
      .where(and(eq(sprints.projectId, projectId), eq(sprints.state, 'active')))
      .limit(1);
    return found ?? null;
  }

  async createSprint(
    actor: Actor,
    input: { projectId: string; name: string; goal?: string | null; startsOn: string; endsOn: string },
  ) {
    await this.require(actor, 'scrum.board.manage');
    await this.crm.getProject(actor, input.projectId);

    const name = input.name?.trim();
    if (!name) throw new BadRequestException('A sprint needs a name');
    if (!input.startsOn || !input.endsOn) throw new BadRequestException('A sprint needs dates');
    if (input.endsOn < input.startsOn) {
      throw new BadRequestException('A sprint cannot end before it starts');
    }

    const id = this.registry.newId();
    await this.db.transaction(async (tx) => {
      await tx.insert(sprints).values({
        id,
        projectId: input.projectId,
        name,
        goal: input.goal?.trim() || null,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
      });

      // The board opts in the moment a project has a sprint. It defaulted false and nothing
      // ever set it, so no board has ever said it works in sprints.
      await tx
        .update(boards)
        .set({ usesSprints: true, updatedAt: new Date() })
        .where(eq(boards.projectId, input.projectId));

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'sprint.create',
        entityType: 'sprint',
        entityId: id,
        detail: { projectId: input.projectId, name, startsOn: input.startsOn, endsOn: input.endsOn },
      });
    });

    return this.getSprint(actor, id);
  }

  /**
   * Start it. At most one sprint per project may be active, and the database is what says so.
   *
   * The partial unique index is the guarantee; this translates its violation into a sentence.
   * Without that translation a second start surfaces as a 500 and a Postgres constraint name.
   */
  async startSprint(actor: Actor, id: string) {
    await this.require(actor, 'scrum.board.manage');
    const sprint = await this.rawSprint(id);
    if (sprint.state === 'active') return this.getSprint(actor, id);
    if (sprint.state === 'completed') {
      throw new BadRequestException('That sprint is finished. Create the next one.');
    }

    const running = await this.activeSprint(sprint.projectId);
    if (running) {
      throw new BadRequestException(
        `"${running.name}" is still running. Finish it before starting another.`,
      );
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(sprints)
        .set({ state: 'active', updatedAt: new Date() })
        .where(eq(sprints.id, id));
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'sprint.start',
        entityType: 'sprint',
        entityId: id,
      });
      // Declared in the manifest since the module was written and never fired.
      await this.events.publish(tx, {
        name: 'sprint.started',
        entityType: 'sprint',
        entityId: id,
        actorId: actor.userId,
        payload: { projectId: sprint.projectId, name: sprint.name },
      });
    });

    return this.getSprint(actor, id);
  }

  /**
   * Close it, and hand back whatever did not get done.
   *
   * Unfinished cards leave the sprint rather than travelling with it. A sprint is a record of
   * what a fortnight actually contained, and dragging its failures into the next one makes
   * both of them lies — the work returns to the backlog, where the next planning session has
   * to argue for it again.
   */
  async completeSprint(actor: Actor, id: string) {
    await this.require(actor, 'scrum.board.manage');
    const sprint = await this.rawSprint(id);
    if (sprint.state === 'completed') return this.getSprint(actor, id);

    const board = await this.getBoard(actor, sprint.projectId);
    const doneKeys = board.columns.filter((c) => c.isDone).map((c) => c.key);

    const returned = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.sprintId, id),
          isNull(tasks.archivedAt),
          isNull(tasks.completedAt),
          // notInArray, not a sql template with ALL(): drizzle binds a JS array as one
          // parameter, so Postgres tried to read the string 'done' as an array literal.
          doneKeys.length > 0 ? notInArray(tasks.status, doneKeys) : undefined,
        ),
      );

    await this.db.transaction(async (tx) => {
      if (returned.length > 0) {
        await tx
          .update(tasks)
          .set({ sprintId: null, updatedAt: new Date() })
          .where(
            inArray(
              tasks.id,
              returned.map((t) => t.id),
            ),
          );
      }

      await tx
        .update(sprints)
        .set({ state: 'completed', updatedAt: new Date() })
        .where(eq(sprints.id, id));

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'sprint.complete',
        entityType: 'sprint',
        entityId: id,
        detail: { returnedToBacklog: returned.length },
      });

      await this.events.publish(tx, {
        name: 'sprint.completed',
        entityType: 'sprint',
        entityId: id,
        actorId: actor.userId,
        payload: { projectId: sprint.projectId, returnedToBacklog: returned.length },
      });
    });

    return this.getSprint(actor, id);
  }

  async getSprint(actor: Actor, id: string) {
    await this.require(actor, 'scrum.tasks.read');
    const sprint = await this.rawSprint(id);
    return { ...sprint, progress: await this.sprintProgress(sprint) };
  }

  /**
   * How far through, in whichever unit the sprint can honestly report.
   *
   * The unit is decided here rather than in the browser, so every screen agrees. The rule
   * matters more than the unit: a percentage computed from a partly-estimated backlog is a
   * chart that quietly lies, and it lies in the flattering direction. So points are used only
   * when every card has them, minutes only when every card has those, and otherwise it counts
   * cards and says so.
   */
  async sprintProgress(sprint: { id: string; projectId: string; startsOn: string; endsOn: string }) {
    const board = await this.getBoardRaw(sprint.projectId);
    const doneKeys = (board?.columns ?? DEFAULT_COLUMNS).filter((c) => c.isDone).map((c) => c.key);

    const rows = await this.db
      .select({
        storyPoints: tasks.storyPoints,
        estimateMinutes: tasks.estimateMinutes,
        status: tasks.status,
        completedAt: tasks.completedAt,
        blockedSince: tasks.blockedSince,
      })
      .from(tasks)
      .where(and(eq(tasks.sprintId, sprint.id), isNull(tasks.archivedAt)));

    const isDone = (t: (typeof rows)[number]) =>
      t.completedAt !== null || doneKeys.includes(t.status);

    const sum = (pick: (t: (typeof rows)[number]) => number | null, only?: boolean) =>
      rows.reduce((n, t) => (only && !isDone(t) ? n : n + (pick(t) ?? 0)), 0);

    const allPointed = rows.length > 0 && rows.every((t) => t.storyPoints !== null);
    const allEstimated = rows.length > 0 && rows.every((t) => t.estimateMinutes !== null);

    const today = new Date().toISOString().slice(0, 10);
    const day = 86_400_000;
    const totalDays =
      Math.round((Date.parse(sprint.endsOn) - Date.parse(sprint.startsOn)) / day) + 1;
    const elapsedDays = Math.min(
      totalDays,
      Math.max(0, Math.round((Date.parse(today) - Date.parse(sprint.startsOn)) / day) + 1),
    );

    return {
      /** Which of the three below a screen should show. Never a mixture. */
      unit: allPointed ? ('points' as const) : allEstimated ? ('minutes' as const) : ('count' as const),
      points: { done: sum((t) => t.storyPoints, true), total: sum((t) => t.storyPoints) },
      minutes: { done: sum((t) => t.estimateMinutes, true), total: sum((t) => t.estimateMinutes) },
      cards: { done: rows.filter(isDone).length, total: rows.length },
      blocked: rows.filter((t) => t.blockedSince !== null && !isDone(t)).length,
      days: {
        elapsed: elapsedDays,
        total: totalDays,
        /** Past its end date and still open, so "day 14 of 10" is never shown. */
        overrun: today > sprint.endsOn,
      },
    };
  }

  private async rawSprint(id: string) {
    const [found] = await this.db.select().from(sprints).where(eq(sprints.id, id)).limit(1);
    if (!found) throw new NotFoundException('Sprint not found');
    return found;
  }

  /** The board row without the permission check, for internal aggregates. */
  private async getBoardRaw(projectId: string) {
    const [found] = await this.db
      .select()
      .from(boards)
      .where(eq(boards.projectId, projectId))
      .limit(1);
    return found ?? null;
  }

  // ── tasks ──────────────────────────────────────────────────

  async createTask(actor: Actor, input: CreateTaskInput, origin: { aiInitiated?: boolean } = {}) {
    await this.require(actor, 'scrum.tasks.write');
    const title = (input.title ?? '').trim();
    if (!title) throw new BadRequestException('A task needs a title');

    const board = await this.getBoard(actor, input.projectId);
    const status = input.status ?? board.columns[0]!.key;
    const column = this.column(board.columns, status);
    const assigneeId = await this.resolveUser(input.assigneeId);
    if (input.parentId) await this.assertTaskInProject(input.parentId, input.projectId);

    const id = this.registry.newId();
    const rank = await this.nextRank(input.projectId, status);

    await this.db.transaction(async (tx) => {
      await this.registry.register(tx, {
        id,
        entityType: 'task',
        displayName: title,
        urlPath: `/scrum/tasks/${id}`,
      });

      await tx.insert(tasks).values({
        id,
        projectId: input.projectId,
        title,
        description: input.description ?? null,
        status,
        assigneeId,
        estimateMinutes: input.estimateMinutes ?? null,
        storyPoints: input.storyPoints ?? null,
        priority: this.validPriority(input.priority),
        labels: input.labels ?? [],
        dueOn: input.dueOn ?? null,
        parentId: input.parentId ?? null,
        sprintId: input.sprintId ?? null,
        rank: String(rank),
        completedAt: column.isDone ? new Date() : null,
        createdBy: actor.userId,
      });

      // Mirror the structural ref so tasks reach the project and client timelines.
      await this.links.createWithin(tx, actor, {
        fromId: id,
        toId: input.projectId,
        kind: 'belongs_to',
      });

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'task.create',
        entityType: 'task',
        entityId: id,
        detail: { title, projectId: input.projectId, status },
        aiInitiated: origin.aiInitiated ?? false,
      });

      await this.events.publish(tx, {
        name: 'task.created',
        entityType: 'task',
        entityId: id,
        actorId: actor.userId,
        payload: { projectId: input.projectId, status },
      });
    });

    return this.getTask(actor, id);
  }

  async updateTask(actor: Actor, id: string, patch: Partial<CreateTaskInput>) {
    await this.require(actor, 'scrum.tasks.write');
    const before = await this.rawTask(id);
    const board = await this.getBoard(actor, before.projectId);

    const status = patch.status ?? before.status;
    const column = this.column(board.columns, status);
    const wasDone = Boolean(before.completedAt);
    const title = patch.title !== undefined ? patch.title.trim() : before.title;
    if (!title) throw new BadRequestException('A task needs a title');

    if (patch.parentId) {
      await this.assertTaskInProject(patch.parentId, before.projectId);
      await this.assertNoParentCycle(id, patch.parentId);
    }
    const assigneeId =
      patch.assigneeId === undefined ? before.assigneeId : await this.resolveUser(patch.assigneeId);

    await this.db.transaction(async (tx) => {
      await tx
        .update(tasks)
        .set({
          title,
          description: patch.description === undefined ? before.description : patch.description,
          status,
          assigneeId,
          estimateMinutes:
            patch.estimateMinutes === undefined ? before.estimateMinutes : patch.estimateMinutes,
          storyPoints: patch.storyPoints === undefined ? before.storyPoints : patch.storyPoints,
          priority: patch.priority ? this.validPriority(patch.priority) : before.priority,
          labels: patch.labels ?? before.labels,
          dueOn: patch.dueOn === undefined ? before.dueOn : patch.dueOn,
          parentId: patch.parentId === undefined ? before.parentId : patch.parentId,
          sprintId: patch.sprintId === undefined ? before.sprintId : patch.sprintId,
          // Completion follows the column, so it cannot drift from where the card sits.
          completedAt: column.isDone ? (before.completedAt ?? new Date()) : null,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, id));

      if (title !== before.title) {
        await this.registry.updateDisplay(tx, id, { displayName: title });
      }

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'task.update',
        entityType: 'task',
        entityId: id,
        detail: { from: before.status, to: status },
      });

      if (status !== before.status) {
        await this.events.publish(tx, {
          name: 'task.moved',
          entityType: 'task',
          entityId: id,
          actorId: actor.userId,
          payload: { from: before.status, to: status },
        });
      }
      if (column.isDone && !wasDone) {
        await this.events.publish(tx, {
          name: 'task.completed',
          entityType: 'task',
          entityId: id,
          actorId: actor.userId,
          payload: { projectId: before.projectId },
        });
      }
      if (assigneeId && assigneeId !== before.assigneeId) {
        await this.events.publish(tx, {
          name: 'task.assigned',
          entityType: 'task',
          entityId: id,
          actorId: actor.userId,
          payload: { assigneeId },
        });
      }
    });

    return this.getTask(actor, id);
  }

  /**
   * Move a card: new column, and a rank between its new neighbours.
   *
   * Fractional ranking writes one row. Integer positions would rewrite every task below
   * the insertion point, which is how drag-and-drop becomes a slow endpoint.
   */
  async moveTask(
    actor: Actor,
    id: string,
    input: { status: string; beforeTaskId?: string | null; afterTaskId?: string | null },
  ) {
    await this.require(actor, 'scrum.tasks.write');
    const task = await this.rawTask(id);
    const board = await this.getBoard(actor, task.projectId);
    const column = this.column(board.columns, input.status);

    const neighbours = await this.db
      .select({ id: tasks.id, rank: tasks.rank })
      .from(tasks)
      .where(inArray(tasks.id, [input.beforeTaskId, input.afterTaskId].filter(Boolean) as string[]));

    const rankOf = (taskId?: string | null) =>
      taskId ? Number(neighbours.find((n) => n.id === taskId)?.rank ?? NaN) : NaN;

    const above = rankOf(input.beforeTaskId);
    const below = rankOf(input.afterTaskId);
    let rank: number;
    if (Number.isFinite(above) && Number.isFinite(below)) rank = (above + below) / 2;
    else if (Number.isFinite(above)) rank = above + RANK_STEP;
    else if (Number.isFinite(below)) rank = below - RANK_STEP;
    else rank = await this.nextRank(task.projectId, input.status);

    const wasDone = Boolean(task.completedAt);

    await this.db.transaction(async (tx) => {
      await tx
        .update(tasks)
        .set({
          status: input.status,
          rank: String(rank),
          completedAt: column.isDone ? (task.completedAt ?? new Date()) : null,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, id));

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'task.move',
        entityType: 'task',
        entityId: id,
        detail: { from: task.status, to: input.status },
      });

      if (input.status !== task.status) {
        await this.events.publish(tx, {
          name: 'task.moved',
          entityType: 'task',
          entityId: id,
          actorId: actor.userId,
          payload: { from: task.status, to: input.status },
        });
      }
      if (column.isDone && !wasDone) {
        await this.events.publish(tx, {
          name: 'task.completed',
          entityType: 'task',
          entityId: id,
          actorId: actor.userId,
          payload: { projectId: task.projectId },
        });
      }
    });

    return this.getTask(actor, id);
  }

  /**
   * Tasks across every project, or narrowed.
   *
   * Widened from single-value filters because a board that spans projects cannot be built on
   * them: "everything open" means several statuses, and "mine or nobody's" means a set that
   * includes null. The single-value forms still work — a string is read as a set of one — so
   * every existing caller and the AI tool keep working unchanged.
   *
   * Completed work is excluded by default. A cross-project board that included every task
   * ever finished would be unreadable within a month, and "show me what is done" is a
   * different question asked deliberately.
   */
  async listTasks(
    actor: Actor,
    filter: {
      projectId?: string | string[];
      status?: string | string[];
      /** `null` in the array means unassigned, which is a real answer rather than a gap. */
      assigneeId?: (string | null)[] | string;
      sprintId?: string;
      dueBefore?: string;
      includeCompleted?: boolean;
    } = {},
  ) {
    await this.require(actor, 'scrum.tasks.read');
    const many = <T>(v: T | T[] | undefined): T[] | undefined =>
      v === undefined ? undefined : Array.isArray(v) ? v : [v];

    const where = [isNull(tasks.archivedAt)];

    const projectIds = many(filter.projectId);
    if (projectIds?.length) where.push(inArray(tasks.projectId, projectIds));

    const statuses = many(filter.status);
    if (statuses?.length) where.push(inArray(tasks.status, statuses));

    const assignees = many(filter.assigneeId);
    if (assignees?.length) {
      const ids = assignees.filter((a): a is string => a !== null);
      const wantsUnassigned = assignees.includes(null);
      // Unassigned is a column on a board, not the absence of a filter — so it has to be
      // expressible alongside named people rather than instead of them.
      const clauses = [
        ids.length ? inArray(tasks.assigneeId, ids) : undefined,
        wantsUnassigned ? isNull(tasks.assigneeId) : undefined,
      ].filter(Boolean);
      if (clauses.length === 1) where.push(clauses[0]!);
      else if (clauses.length > 1) where.push(or(...clauses)!);
    }

    if (filter.sprintId) where.push(eq(tasks.sprintId, filter.sprintId));
    if (filter.dueBefore) where.push(lte(tasks.dueOn, filter.dueBefore));
    if (!filter.includeCompleted) where.push(isNull(tasks.completedAt));

    return this.db
      .select()
      .from(tasks)
      .where(and(...where))
      .orderBy(asc(tasks.rank))
      .limit(500);
  }

  /** One task with the hours logged against it — the reason this module exists. */
  async getTask(actor: Actor, id: string) {
    await this.require(actor, 'scrum.tasks.read');
    const task = await this.rawTask(id);
    const [children, loggedMinutes, assignee] = await Promise.all([
      this.db
        .select()
        .from(tasks)
        .where(and(eq(tasks.parentId, id), isNull(tasks.archivedAt)))
        .orderBy(asc(tasks.rank)),
      this.time.minutesForTask(id),
      task.assigneeId
        ? this.db
            .select({ id: users.id, displayName: users.displayName })
            .from(users)
            .where(eq(users.id, task.assigneeId))
            .limit(1)
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
    ]);

    return { ...task, children, loggedMinutes, assignee };
  }

  /**
   * This card cannot move, and here is why.
   *
   * A flag beside the status rather than a column on the board. A card is normally blocked
   * *while* being somewhere — in progress waiting on a credential, in review waiting on a
   * sign-off — and a "blocked" column would make it stop being where it is in order to say
   * it is stuck, losing the more useful of the two facts.
   *
   * The reason is required. A red badge with no reason cannot be acted on, and by the time
   * somebody asks, the answer has been forgotten — which is the entire failure this is for.
   */
  async blockTask(
    actor: Actor,
    id: string,
    input: { reason: string; blockedOnUserId?: string | null },
  ) {
    await this.require(actor, 'scrum.tasks.write');
    const task = await this.rawTask(id);

    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException('Say what it is blocked on');

    // Same validation the assignee gets — waiting on somebody who does not exist is a
    // blocker nobody will ever clear.
    const blockedOnUserId = await this.resolveUser(input.blockedOnUserId);

    // Re-blocking an already-blocked card keeps the original date: the clock should measure
    // how long the work has been stuck, not how long ago somebody last rephrased it.
    const since = task.blockedSince ?? new Date();

    await this.db.transaction(async (tx) => {
      await tx
        .update(tasks)
        .set({
          blockedReason: reason,
          blockedSince: since,
          blockedOnUserId,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, id));

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'task.block',
        entityType: 'task',
        entityId: id,
        detail: { reason, blockedOnUserId },
      });

      if (!task.blockedSince) {
        await this.events.publish(tx, {
          name: 'task.blocked',
          entityType: 'task',
          entityId: id,
          actorId: actor.userId,
          payload: { reason, status: task.status },
        });
      }
    });

    return this.getTask(actor, id);
  }

  /** Unstuck. Clears all three columns together, because the CHECK requires it. */
  async unblockTask(actor: Actor, id: string) {
    await this.require(actor, 'scrum.tasks.write');
    const task = await this.rawTask(id);
    const since = task.blockedSince;
    if (!since) return this.getTask(actor, id);

    await this.db.transaction(async (tx) => {
      await tx
        .update(tasks)
        .set({
          blockedReason: null,
          blockedSince: null,
          blockedOnUserId: null,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, id));

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'task.unblock',
        entityType: 'task',
        entityId: id,
        // Kept in the audit trail, because the row no longer holds it and how long things sit
        // blocked is the interesting question a month later.
        detail: {
          reason: task.blockedReason,
          blockedForDays: Math.floor((Date.now() - since.getTime()) / 86_400_000),
        },
      });

      await this.events.publish(tx, {
        name: 'task.unblocked',
        entityType: 'task',
        entityId: id,
        actorId: actor.userId,
        payload: { reason: task.blockedReason },
      });
    });

    return this.getTask(actor, id);
  }

  async archiveTask(actor: Actor, id: string) {
    await this.require(actor, 'scrum.tasks.write');
    await this.rawTask(id);
    await this.db.transaction(async (tx) => {
      await tx.update(tasks).set({ archivedAt: new Date() }).where(eq(tasks.id, id));
      await this.registry.softDelete(tx, id);
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'task.archive',
        entityType: 'task',
        entityId: id,
      });
    });
  }

  /** Start a timer on a task (Master §3.5). SCRUM calls Time; Time knows nothing of SCRUM. */
  async startTimer(actor: Actor, taskId: string) {
    await this.require(actor, 'scrum.tasks.read');
    const task = await this.rawTask(taskId);
    return this.time.createEntry(actor, {
      projectId: task.projectId,
      taskId,
      startedAt: new Date().toISOString(),
      description: task.title,
    });
  }

  // ── AI tool handlers ───────────────────────────────────────

  async listTasksTool(actor: Actor, input: { projectId?: string; status?: string }) {
    const rows = await this.listTasks(actor, input);
    return {
      tasks: rows.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        estimateHours: t.estimateMinutes ? +(t.estimateMinutes / 60).toFixed(2) : null,
      })),
    };
  }

  async createTaskTool(actor: Actor, input: CreateTaskInput) {
    const task = await this.createTask(actor, input, { aiInitiated: true });
    return { id: task.id, title: task.title, status: task.status };
  }

  async moveTaskTool(actor: Actor, input: { taskId: string; status: string }) {
    const task = await this.moveTask(actor, input.taskId, { status: input.status });
    return { id: task.id, status: task.status };
  }

  // ── internals ──────────────────────────────────────────────

  private column(columns: BoardColumn[], key: string): BoardColumn {
    const found = columns.find((c) => c.key === key);
    if (!found) {
      throw new BadRequestException(
        `'${key}' is not a column on this board (${columns.map((c) => c.key).join(', ')})`,
      );
    }
    return found;
  }

  private validPriority(priority?: string): string {
    if (!priority) return 'normal';
    if (!PRIORITIES.includes(priority as (typeof PRIORITIES)[number])) {
      throw new BadRequestException(`Unknown priority '${priority}'`);
    }
    return priority;
  }

  private async nextRank(projectId: string, status: string): Promise<number> {
    const [row] = await this.db
      .select({ max: sql<string | null>`MAX(${tasks.rank})` })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), eq(tasks.status, status)));
    return (Number(row?.max ?? 0) || 0) + RANK_STEP;
  }

  private async rawTask(id: string) {
    const [row] = await this.db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!row) throw new NotFoundException('Task not found');
    return row;
  }

  private async assertTaskInProject(taskId: string, projectId: string): Promise<void> {
    const parent = await this.rawTask(taskId);
    if (parent.projectId !== projectId) {
      throw new BadRequestException('A parent task must be in the same project');
    }
  }

  /** Walk up the parent chain — a cycle would make the task tree infinite to render. */
  private async assertNoParentCycle(taskId: string, parentId: string): Promise<void> {
    let cursor: string | null = parentId;
    for (let depth = 0; cursor && depth < 20; depth++) {
      if (cursor === taskId) throw new BadRequestException('That would create a loop of parents');
      const [row] = await this.db
        .select({ parentId: tasks.parentId })
        .from(tasks)
        .where(eq(tasks.id, cursor))
        .limit(1);
      cursor = row?.parentId ?? null;
    }
  }

  private async resolveUser(userId: string | null | undefined): Promise<string | null> {
    if (!userId) return null;
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new BadRequestException('Assignee must be an existing user');
    return user.id;
  }

  private async require(actor: Actor, capability: string): Promise<void> {
    if (!(await this.permissions.can(actor, capability))) {
      throw new ForbiddenException(`Missing capability '${capability}'`);
    }
  }

  async ensureReportingViews(): Promise<void> {
    await this.db.execute(sql`DROP VIEW IF EXISTS scrum.v_tasks CASCADE`);
    await this.db.execute(sql`
      CREATE VIEW scrum.v_tasks AS
      SELECT t.id, t.project_id, t.title, t.status, t.priority, t.assignee_id,
             t.estimate_minutes, t.estimate_minutes / 60.0 AS estimate_hours,
             t.story_points,
             t.due_on, t.parent_id, t.sprint_id,
             (t.completed_at IS NOT NULL) AS completed, t.completed_at,
             -- Blocked, and for how long. The duration is what an insight rule can act on;
             -- the reason is deliberately not published, because it is free text somebody
             -- typed about a client and a reporting view is the wrong place for that.
             (t.blocked_since IS NOT NULL) AS blocked,
             t.blocked_since,
             t.blocked_on_user_id,
             CASE WHEN t.blocked_since IS NULL THEN NULL
                  ELSE (CURRENT_DATE - t.blocked_since::date) END AS days_blocked,
             t.created_at, t.updated_at
        FROM scrum.tasks t
       WHERE t.archived_at IS NULL
    `);
    await this.db.execute(sql`DROP VIEW IF EXISTS scrum.v_sprints CASCADE`);
    await this.db.execute(sql`
      CREATE VIEW scrum.v_sprints AS
      SELECT s.id, s.project_id, s.name, s.goal, s.starts_on, s.ends_on, s.state,
             -- Was a bare count that included archived cards, so a sprint's size grew every
             -- time somebody tidied up. Done vs total, and points, are what a review reads.
             (SELECT count(*) FROM scrum.tasks t
               WHERE t.sprint_id = s.id AND t.archived_at IS NULL) AS task_count,
             (SELECT count(*) FROM scrum.tasks t
               WHERE t.sprint_id = s.id AND t.archived_at IS NULL
                 AND t.completed_at IS NOT NULL) AS done_count,
             (SELECT coalesce(sum(t.story_points), 0) FROM scrum.tasks t
               WHERE t.sprint_id = s.id AND t.archived_at IS NULL) AS points_total,
             (SELECT coalesce(sum(t.story_points), 0) FROM scrum.tasks t
               WHERE t.sprint_id = s.id AND t.archived_at IS NULL
                 AND t.completed_at IS NOT NULL) AS points_done
        FROM scrum.sprints s
    `);
  }
}
