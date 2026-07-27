import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { users } from '../../core/db/core.schema.js';
import { DB, type Database } from '../../core/db/db.module.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { CrmService } from '../crm/crm.service.js';
import { TimeService } from '../time/time.service.js';
import { DEFAULT_COLUMNS, PRIORITIES, boards, tasks, type BoardColumn } from './scrum.schema.js';

export interface CreateTaskInput {
  projectId: string;
  title: string;
  description?: string | null;
  status?: string;
  assigneeId?: string | null;
  estimateMinutes?: number | null;
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

  async listTasks(
    actor: Actor,
    filter: { projectId?: string; status?: string; assigneeId?: string; sprintId?: string } = {},
  ) {
    await this.require(actor, 'scrum.tasks.read');
    const where = [isNull(tasks.archivedAt)];
    if (filter.projectId) where.push(eq(tasks.projectId, filter.projectId));
    if (filter.status) where.push(eq(tasks.status, filter.status));
    if (filter.assigneeId) where.push(eq(tasks.assigneeId, filter.assigneeId));
    if (filter.sprintId) where.push(eq(tasks.sprintId, filter.sprintId));

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
             t.due_on, t.parent_id, t.sprint_id,
             (t.completed_at IS NOT NULL) AS completed, t.completed_at,
             t.created_at, t.updated_at
        FROM scrum.tasks t
       WHERE t.archived_at IS NULL
    `);
    await this.db.execute(sql`DROP VIEW IF EXISTS scrum.v_sprints CASCADE`);
    await this.db.execute(sql`
      CREATE VIEW scrum.v_sprints AS
      SELECT s.id, s.project_id, s.name, s.starts_on, s.ends_on, s.state,
             (SELECT count(*) FROM scrum.tasks t WHERE t.sprint_id = s.id) AS task_count
        FROM scrum.sprints s
    `);
  }
}
