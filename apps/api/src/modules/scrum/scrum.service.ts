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
import { comments, users } from '../../core/db/core.schema.js';
import { DB, type Database } from '../../core/db/db.module.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { CrmService } from '../crm/crm.service.js';
import { TimeService } from '../time/time.service.js';
import {
  COLUMN_FLOWS,
  DEFAULT_COLUMNS,
  PRIORITIES,
  flowOf,
  boards,
  sprints,
  sprintCapacity,
  sprintScopeChanges,
  taskTransitions,
  tasks,
  type BoardColumn,
  type ColumnFlow,
  type SprintSummary,
} from './scrum.schema.js';

/** Every column carrying an explicit flow, so no caller has to know the fallback. */
const withFlow = (columns: BoardColumn[]): BoardColumn[] =>
  columns.map((c, i) => ({ ...c, flow: flowOf(c, i) }));

export interface CreateTaskInput {
  projectId: string;
  title: string;
  description?: string | null;
  status?: string;
  assigneeId?: string | null;
  estimateMinutes?: number | null;
  priority?: string;
  /** story | bug | chore | spike. See validType for why the vocabulary is closed. */
  type?: string;
  labels?: string[];
  dueOn?: string | null;
  parentId?: string | null;
  sprintId?: string | null;
}

/** What `scrum_update_task` accepts: the card, and whichever fields are being changed. */
export type UpdateTaskToolInput = { taskId: string } & Partial<Omit<CreateTaskInput, 'projectId'>>;

/** Something worth saying about a move, said instead of refusing it. */
export interface TaskWarning {
  code: 'wip_exceeded' | 'done_without_hours';
  column: string;
  message: string;
}

/** Gap between ranks, so a card can always be dropped between two others without a rewrite. */
const RANK_STEP = 1000;

/**
 * The label that marks a card as something a retrospective decided to change.
 *
 * A reserved label rather than a column or a type, because a retro action *is* a card — it is
 * worked on, estimated and finished like any other. What it needs is to be findable, so the
 * next retro can open by asking whether the last one's promises landed.
 */
export const RETRO_LABEL = 'retro';

interface FlowRow extends Record<string, unknown> {
  task_id: string;
  title: string;
  assignee_id: string | null;
  status: string;
  current_flow: string | null;
  has_history: boolean;
  cycle_minutes: number | null;
  lead_minutes: number | null;
  age_minutes: number | null;
  queued_minutes: number | null;
  waiting_minutes: number;
  waiting_spells: number;
  reopen_count: number;
  first_done_at: string | null;
  completed_at: string | null;
}

/**
 * How many finished cards it takes before a percentile is worth printing.
 *
 * Under this the answer is the cards themselves — "six finished: 2d, 3d, 1d, 9d, 2d, 4d" is
 * strictly more informative than a median over six, and it cannot mislead. A p85 of five items
 * *is* the second-worst item wearing a statistic's clothes, and it will be read as a forecast.
 * So the API returns null rather than leaving the UI to decide how brave to be.
 */
const MEANINGFUL_AT = 8;

/** Nearest-rank, which for small samples is an actual observation rather than an average. */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
}

function stat(rows: FlowRow[], pick: (r: FlowRow) => number) {
  const samples = rows
    .map((r) => ({ taskId: r.task_id, title: r.title, minutes: pick(r) }))
    .sort((a, b) => a.minutes - b.minutes);
  const values = samples.map((s) => s.minutes);
  const enough = samples.length >= MEANINGFUL_AT;
  return {
    n: samples.length,
    samples,
    meaningful: enough,
    p50: enough ? percentile(values, 0.5) : null,
    // p85 rather than p95: at twenty items p95 is simply the worst one.
    p85: enough ? percentile(values, 0.85) : null,
  };
}

/** Counts per ISO week, keyed by the Monday that starts it. */
function weekly(dates: string[]): Array<{ week: string; count: number }> {
  const byWeek = new Map<string, number>();
  for (const iso of dates) {
    const d = new Date(iso);
    const monday = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)),
    );
    const key = monday.toISOString().slice(0, 10);
    byWeek.set(key, (byWeek.get(key) ?? 0) + 1);
  }
  return [...byWeek.entries()]
    .map(([week, count]) => ({ week, count }))
    .sort((a, b) => a.week.localeCompare(b.week));
}

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
    if (existing) return { ...existing, columns: withFlow(existing.columns) };

    const [created] = await this.db
      .insert(boards)
      .values({ projectId, columns: DEFAULT_COLUMNS })
      .onConflictDoNothing()
      .returning();
    return created
      ? { ...created, columns: withFlow(created.columns) }
      : {
          // The unsaved fallback for a board whose insert lost a race. Same shape as a real
          // row, so callers never have to know which one they got.
          projectId,
          columns: DEFAULT_COLUMNS,
          usesSprints: false,
          definitionOfDone: null,
          definitionOfReady: null,
        };
  }

  async updateBoard(
    actor: Actor,
    projectId: string,
    patch: {
      columns?: BoardColumn[];
      usesSprints?: boolean;
      definitionOfDone?: string | null;
      definitionOfReady?: string | null;
    },
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
      const badFlow = patch.columns.find((c) => c.flow && !COLUMN_FLOWS.includes(c.flow));
      if (badFlow) {
        throw new BadRequestException(
          `${badFlow.label} has an unknown flow. Use one of: ${COLUMN_FLOWS.join(', ')}`,
        );
      }
      /*
       * A limit has to be a limit.
       *
       * This was never checked, and the browser divides by it — a stored 0 makes the fill
       * width Infinity and a negative one makes it NaN, so the column silently renders
       * wrong rather than complaining.
       */
      const badLimit = patch.columns.find(
        (c) =>
          c.wipLimit !== undefined &&
          c.wipLimit !== null &&
          (!Number.isInteger(c.wipLimit) || c.wipLimit < 1),
      );
      if (badLimit) {
        throw new BadRequestException(
          `A WIP limit is a whole number of cards, one or more — ${badLimit.label} has ${badLimit.wipLimit}`,
        );
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
        definitionOfDone:
          patch.definitionOfDone === undefined
            ? board.definitionOfDone
            : patch.definitionOfDone?.trim() || null,
        definitionOfReady:
          patch.definitionOfReady === undefined
            ? board.definitionOfReady
            : patch.definitionOfReady?.trim() || null,
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

  /**
   * Sprints, for one project or across all of them.
   *
   * The project became optional so a screen that is not about a single project — the meetings
   * hub, deciding which sprint a ceremony is for — can ask "what is running anywhere" without
   * one request per project.
   */
  async listSprints(actor: Actor, filter: { projectId?: string; state?: string } = {}) {
    await this.require(actor, 'scrum.tasks.read');
    if (filter.projectId) await this.crm.getProject(actor, filter.projectId);

    const where = [
      filter.projectId ? eq(sprints.projectId, filter.projectId) : undefined,
      filter.state ? eq(sprints.state, filter.state) : undefined,
    ].filter(Boolean);

    return this.db
      .select()
      .from(sprints)
      .where(where.length > 0 ? and(...where) : undefined)
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
      /*
       * A sprint is an entity, and until now it only said so in the manifest.
       *
       * `scrum.manifest.ts` has declared the type, its display template and its URL since the
       * module was written, and nothing ever registered one — so a sprint could not be
       * searched, linked, mentioned, or put on a timeline, and the URL it advertised resolved
       * to nothing. Tasks have done this since their first line; sprints were simply missed.
       */
      await this.registry.register(tx, {
        id,
        entityType: 'sprint',
        displayName: name,
        urlPath: `/board/sprints/${id}`,
      });

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

      // Mirrors the task pattern, so a sprint reaches the project and client timelines.
      await this.links.createWithin(tx, actor, {
        fromId: id,
        toId: input.projectId,
        kind: 'belongs_to',
      });

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
   * Correct a sprint after it exists.
   *
   * Name, dates and goal were frozen at creation, which is a strange thing to freeze: the goal
   * is the field the planning dialog itself calls "the thing most worth writing", and a goal
   * you cannot sharpen once the sprint is a day old is a goal you will not bother writing.
   * Sprints run late and get extended too, and pretending otherwise only means the dates lie.
   *
   * `state` is not patchable here. Starting and finishing are their own operations because
   * each does more than set a column — one stamps a beginning, the other freezes a summary
   * and hands work back to the backlog.
   */
  async updateSprint(
    actor: Actor,
    id: string,
    patch: { name?: string; goal?: string | null; startsOn?: string; endsOn?: string },
  ) {
    await this.require(actor, 'scrum.board.manage');
    const before = await this.rawSprint(id);

    const name = patch.name === undefined ? before.name : patch.name.trim();
    if (!name) throw new BadRequestException('A sprint needs a name');
    const startsOn = patch.startsOn ?? before.startsOn;
    const endsOn = patch.endsOn ?? before.endsOn;
    if (endsOn < startsOn) throw new BadRequestException('A sprint cannot end before it starts');

    const goal = patch.goal === undefined ? before.goal : patch.goal?.trim() || null;

    await this.db.transaction(async (tx) => {
      await tx
        .update(sprints)
        .set({ name, goal, startsOn, endsOn, updatedAt: new Date() })
        .where(eq(sprints.id, id));

      if (name !== before.name) {
        await this.registry.updateDisplay(tx, id, { displayName: name });
      }

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'sprint.update',
        entityType: 'sprint',
        entityId: id,
        detail: { before: { name: before.name, goal: before.goal }, after: { name, goal } },
      });
      await this.events.publish(tx, {
        name: 'sprint.updated',
        entityType: 'sprint',
        entityId: id,
        actorId: actor.userId,
        payload: { projectId: before.projectId, goalChanged: goal !== before.goal },
      });
    });

    return this.getSprint(actor, id);
  }

  /**
   * Delete a sprint that should not exist.
   *
   * Only while it is planned. A sprint that has run is evidence — its transitions, its scope
   * changes and its summary are what a retrospective argues from, and deleting it would take
   * that with it. This is for the one created by a mis-click.
   */
  async deleteSprint(actor: Actor, id: string): Promise<void> {
    await this.require(actor, 'scrum.board.manage');
    const sprint = await this.rawSprint(id);
    if (sprint.state !== 'planned') {
      throw new BadRequestException(
        'That sprint has run. Finish it instead — its history is what a retrospective reads.',
      );
    }

    await this.db.transaction(async (tx) => {
      // The FK is ON DELETE SET NULL, so any card sitting in it returns to the backlog.
      await tx.delete(sprints).where(eq(sprints.id, id));
      await this.registry.softDelete(tx, id);
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'sprint.delete',
        entityType: 'sprint',
        entityId: id,
        detail: { name: sprint.name },
      });
    });
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
        .set({ state: 'active', startedAt: new Date(), updatedAt: new Date() })
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
    // Idempotent, and the same shape as a first close: a caller that has to check which
    // branch it got is a caller that will forget to. Nothing moved, so nothing returned.
    if (sprint.state === 'completed') {
      return { ...(await this.getSprint(actor, id)), returnedToBacklog: 0 };
    }

    const board = await this.getBoard(actor, sprint.projectId);
    const doneKeys = board.columns.filter((c) => c.isDone).map((c) => c.key);

    // Read the whole sprint before anything moves. Once the unfinished cards are detached
    // there is no longer a way to ask what was in it.
    const summary = await this.summarise(sprint, doneKeys);

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
        .set({
          state: 'completed',
          completedAt: new Date(),
          summary: { ...summary, returnedToBacklog: returned.length },
          updatedAt: new Date(),
        })
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

    // Told to the caller, not only to the audit log. Closing a sprint silently moves cards
    // off the board, and "3 unfinished cards went back to the backlog" is the one sentence
    // that stops that looking like data loss.
    return { ...(await this.getSprint(actor, id)), returnedToBacklog: returned.length };
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
  /**
   * What this sprint amounted to, computed while the answer still exists.
   *
   * Called from `completeSprint` before any card is detached, and stored on the row. Deriving
   * it afterwards is impossible: closing a sprint nulls `sprint_id` on everything unfinished,
   * so a later query sees only the cards that landed and reports every sprint ever run as a
   * clean sweep.
   */
  private async summarise(
    sprint: { id: string; startsOn: string; endsOn: string },
    doneKeys: string[],
  ): Promise<Omit<SprintSummary, 'returnedToBacklog'>> {
    const rows = await this.db
      .select({
        estimateMinutes: tasks.estimateMinutes,
        status: tasks.status,
        completedAt: tasks.completedAt,
        type: tasks.type,
      })
      .from(tasks)
      .where(and(eq(tasks.sprintId, sprint.id), isNull(tasks.archivedAt)));

    const isDone = (t: (typeof rows)[number]) =>
      t.completedAt !== null || doneKeys.includes(t.status);
    const done = rows.filter(isDone);
    const total = (set: typeof rows, pick: (t: (typeof rows)[number]) => number | null) =>
      set.reduce((n, t) => n + (pick(t) ?? 0), 0);

    const byType: Record<string, number> = {};
    for (const t of done) byType[t.type] = (byType[t.type] ?? 0) + 1;

    const scope = await this.db
      .select({ change: sprintScopeChanges.change })
      .from(sprintScopeChanges)
      .where(eq(sprintScopeChanges.sprintId, sprint.id));

    const day = 86_400_000;
    const today = new Date().toISOString().slice(0, 10);

    return {
      // The unit it could honestly report at the time, frozen. A backlog that was half
      // estimated then does not become fully estimated later because somebody tidied up.
      unit: rows.length > 0 && rows.every((t) => t.estimateMinutes !== null) ? 'minutes' : 'count',
      committed: {
        minutes: total(rows, (t) => t.estimateMinutes),
        cards: rows.length,
      },
      completed: {
        minutes: total(done, (t) => t.estimateMinutes),
        cards: done.length,
      },
      byType,
      /*
       * What turned up after it started, and what was pulled back out.
       *
       * Without this a sprint that planned five and absorbed three more on the Wednesday reads
       * exactly like one that planned eight — the end state is identical and the story is not.
       */
      scope: {
        added: scope.filter((c) => c.change === 'added').length,
        removed: scope.filter((c) => c.change === 'removed').length,
      },
      days: {
        total: Math.round((Date.parse(sprint.endsOn) - Date.parse(sprint.startsOn)) / day) + 1,
        overran: today > sprint.endsOn,
      },
      closedAt: new Date().toISOString(),
    };
  }

  async sprintProgress(sprint: {
    id: string;
    projectId: string;
    startsOn: string;
    endsOn: string;
    startedAt?: Date | null;
  }) {
    const board = await this.getBoardRaw(sprint.projectId);
    const doneKeys = (board?.columns ?? DEFAULT_COLUMNS).filter((c) => c.isDone).map((c) => c.key);

    const rows = await this.db
      .select({
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

    const allEstimated = rows.length > 0 && rows.every((t) => t.estimateMinutes !== null);

    const today = new Date().toISOString().slice(0, 10);
    const day = 86_400_000;
    const totalDays =
      Math.round((Date.parse(sprint.endsOn) - Date.parse(sprint.startsOn)) / day) + 1;
    /*
     * Counted from when it actually started, falling back to the plan.
     *
     * `starts_on` is a date somebody picked at creation. A sprint started two days late spent
     * two of its days not existing, and reporting "day 5 of 10" for it is simply wrong.
     */
    const from = sprint.startedAt
      ? sprint.startedAt.toISOString().slice(0, 10)
      : sprint.startsOn;
    const elapsedDays = Math.min(
      totalDays,
      Math.max(0, Math.round((Date.parse(today) - Date.parse(from)) / day) + 1),
    );

    return {
      /** Which of the two below a screen should show. Never a mixture. */
      unit: allEstimated ? ('minutes' as const) : ('count' as const),
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

  // ── flow ───────────────────────────────────────────────────

  /**
   * How work actually moves through this board.
   *
   * Velocity answers "how much did we commit to and deliver", which needs a team big enough to
   * average and a habit of committing. These answer "how long does a thing take once it starts,
   * what is old right now, and how much of the elapsed time was us waiting on someone else" —
   * which need neither, and which are the questions a consultancy can act on.
   */
  async flow(actor: Actor, projectId: string, opts: { since?: string } = {}) {
    await this.require(actor, 'scrum.tasks.read');
    await this.crm.getProject(actor, projectId);

    const since = opts.since ? new Date(opts.since) : null;
    const rows = await this.db.execute<FlowRow>(sql`
      SELECT task_id, title, assignee_id, status, current_flow, has_history,
             cycle_minutes, lead_minutes, age_minutes, queued_minutes,
             waiting_minutes, waiting_spells, reopen_count,
             first_done_at, completed_at
        FROM scrum.v_task_flow
       WHERE project_id = ${projectId}
    `);
    const all = rows.rows;
    const finishedAt = (r: FlowRow) => r.first_done_at ?? r.completed_at;
    const inWindow = (r: FlowRow) => {
      const at = finishedAt(r);
      return at !== null && (!since || new Date(at) >= since);
    };
    const finished = all.filter(inWindow);

    return {
      /** Cards the column-level numbers cannot see, because they have no transitions at all. */
      excluded: all.filter((r) => !r.has_history).length,
      cards: all.length,
      cycle: stat(finished.filter((r) => r.cycle_minutes !== null), (r) => r.cycle_minutes!),
      lead: stat(finished.filter((r) => r.lead_minutes !== null), (r) => r.lead_minutes!),
      /*
       * What is old right now, oldest first.
       *
       * The one number on this page that is useful on the day it ships: it is a fact about a
       * single card, not a distribution, so it needs no sample size to mean something.
       */
      aging: all
        .filter((r) => r.age_minutes !== null)
        .sort((a, b) => b.age_minutes! - a.age_minutes!)
        .map((r) => ({
          taskId: r.task_id,
          title: r.title,
          status: r.status,
          minutes: r.age_minutes!,
          waiting: r.current_flow === 'waiting',
          /** False when the age is inferred from creation rather than measured from a move. */
          measured: r.has_history,
        })),
      /** Oldest thing nobody has started. Not aging work — a different problem. */
      queued: all
        .filter((r) => r.queued_minutes !== null)
        .sort((a, b) => b.queued_minutes! - a.queued_minutes!)
        .slice(0, 5)
        .map((r) => ({ taskId: r.task_id, title: r.title, minutes: r.queued_minutes! })),
      waiting: {
        minutes: all.reduce((n, r) => n + r.waiting_minutes, 0),
        spells: all.reduce((n, r) => n + r.waiting_spells, 0),
        now: all.filter((r) => r.current_flow === 'waiting').length,
      },
      /*
       * Cards finished per ISO week.
       *
       * Counted from the first time a card entered a done column, never from completed_at:
       * that column is *nulled* when a card leaves a done column, so anything re-opened and
       * finished again would silently count zero.
       */
      throughput: weekly(finished.map((r) => finishedAt(r)!)),
      reopened: all.filter((r) => r.reopen_count > 0).length,
    };
  }

  /**
   * What the board can say at a stand-up, as plain data.
   *
   * Returns a shape meetings declares, not one scrum exports, so the dependency stays one way:
   * scrum has never heard of a meeting and does not start now. It answers the two questions the
   * round-the-table is actually asking — what moved since last time, and what is stuck — from
   * the transitions, which know, rather than from `updated_at`, which does not.
   */
  async standupDigest(actor: Actor, projectId: string, since: Date, sprintId?: string | null) {
    await this.require(actor, 'scrum.tasks.read');
    const board = await this.getBoardRaw(projectId);
    const activeKeys = (board?.columns ?? DEFAULT_COLUMNS)
      .filter((c, i) => flowOf(c, i) === 'active')
      .map((c) => c.key);

    const [sprint, moved, live] = await Promise.all([
      // The sprint the note says it is about, not merely whichever one is running: a stand-up
      // held on the morning a sprint starts is about a sprint that has not started yet.
      sprintId ? this.rawSprint(sprintId) : this.activeSprint(projectId),
      this.db
        .select({ title: tasks.title, to: taskTransitions.toStatus, by: taskTransitions.movedBy })
        .from(taskTransitions)
        .innerJoin(tasks, eq(tasks.id, taskTransitions.taskId))
        .where(
          and(
            eq(tasks.projectId, projectId),
            isNull(tasks.archivedAt),
            sql`${taskTransitions.at} >= ${since.toISOString()}`,
          ),
        )
        .orderBy(asc(taskTransitions.at)),
      this.db
        .select({
          title: tasks.title,
          status: tasks.status,
          assigneeId: tasks.assigneeId,
          blockedReason: tasks.blockedReason,
          blockedSince: tasks.blockedSince,
        })
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId), isNull(tasks.archivedAt), isNull(tasks.completedAt))),
    ]);

    const people = await this.peopleFor([
      ...moved.map((m) => m.by),
      ...live.map((t) => t.assigneeId),
    ]);
    const nameOf = (id: string | null) => (id ? (people.get(id)?.displayName ?? null) : null);

    const byName = new Map<string, { name: string; moved: string[]; doing: string[] }>();
    const entry = (name: string) => {
      if (!byName.has(name)) byName.set(name, { name, moved: [], doing: [] });
      return byName.get(name)!;
    };
    for (const m of moved) {
      const name = nameOf(m.by);
      // Deduped: a card walked through three columns overnight is one thing that happened.
      if (name && !entry(name).moved.includes(m.title)) entry(name).moved.push(m.title);
    }
    for (const t of live) {
      const name = nameOf(t.assigneeId);
      if (name && activeKeys.includes(t.status)) entry(name).doing.push(t.title);
    }

    return {
      sprintGoal: sprint?.goal ?? null,
      people: [...byName.values()],
      blocked: live
        .filter((t) => t.blockedReason !== null)
        .map((t) => ({
          title: t.title,
          reason: t.blockedReason!,
          days: t.blockedSince
            ? Math.floor((Date.now() - t.blockedSince.getTime()) / 86_400_000)
            : 0,
        })),
    };
  }

  /**
   * What a sprint contained, for the review that discusses it.
   *
   * Read live rather than from the frozen summary, because a review is normally held while the
   * sprint is still open — the summary does not exist until it closes, and by then the meeting
   * is over. The summary's job is the opposite: to survive the closing.
   */
  async sprintCards(actor: Actor, sprintId: string) {
    await this.require(actor, 'scrum.tasks.read');
    const sprint = await this.rawSprint(sprintId);
    const board = await this.getBoardRaw(sprint.projectId);
    const doneKeys = (board?.columns ?? DEFAULT_COLUMNS).filter((c) => c.isDone).map((c) => c.key);

    const rows = await this.db
      .select({ title: tasks.title, status: tasks.status, completedAt: tasks.completedAt })
      .from(tasks)
      .where(and(eq(tasks.sprintId, sprintId), isNull(tasks.archivedAt)))
      .orderBy(asc(tasks.rank));

    const done = (t: (typeof rows)[number]) =>
      t.completedAt !== null || doneKeys.includes(t.status);
    return {
      name: sprint.name,
      goal: sprint.goal,
      finished: rows.filter(done).map((t) => t.title),
      unfinished: rows.filter((t) => !done(t)).map((t) => t.title),
      definitionOfDone: board?.definitionOfDone ?? null,
    };
  }

  /**
   * What the last retrospective said it would change, and whether it happened.
   *
   * The one question a retrospective has to open with and the only one nothing could answer.
   * Retro actions became ordinary backlog cards, indistinguishable from work, so the next
   * retro had no way to ask — and a retro that cannot ask is a conversation, not a mechanism.
   */
  async retroActions(actor: Actor, projectId: string) {
    await this.require(actor, 'scrum.tasks.read');
    const rows = await this.db
      .select({ title: tasks.title, completedAt: tasks.completedAt, createdAt: tasks.createdAt })
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, projectId),
          isNull(tasks.archivedAt),
          sql`${RETRO_LABEL} = ANY(${tasks.labels})`,
        ),
      )
      .orderBy(desc(tasks.createdAt))
      .limit(10);
    return rows.map((t) => ({ title: t.title, done: t.completedAt !== null }));
  }

  /**
   * Where a handful of cards stand, asked by id.
   *
   * For the caller that already knows which tasks it cares about and only needs to know whether
   * they are finished — a meeting holding its own past commitments to account. Returns a shape
   * the caller declares, like `standupDigest` and `retroActions` above, so scrum still has never
   * heard of a meeting.
   *
   * An archived card counts as done. It is not on any board and nobody is going to do it, so
   * reporting it as an open commitment would be asking about work that no longer exists.
   */
  async taskStates(actor: Actor, ids: string[]) {
    await this.require(actor, 'scrum.tasks.read');
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({
        id: tasks.id,
        title: tasks.title,
        assigneeId: tasks.assigneeId,
        dueOn: tasks.dueOn,
        completedAt: tasks.completedAt,
        archivedAt: tasks.archivedAt,
      })
      .from(tasks)
      .where(inArray(tasks.id, ids));
    return rows.map((t) => ({
      id: t.id,
      title: t.title,
      assigneeId: t.assigneeId,
      dueOn: t.dueOn,
      done: t.completedAt !== null || t.archivedAt !== null,
    }));
  }

  /**
   * A card arriving in or leaving a running sprint.
   *
   * Only while it is running. Putting a card into a sprint that has not started is planning —
   * recording that as scope change would bury the three cards that actually turned up on the
   * Wednesday under twenty that were always going to be there.
   */
  private async recordScopeChange(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    actor: Actor,
    taskId: string,
    from: string | null,
    to: string | null,
  ): Promise<void> {
    for (const [sprintId, change] of [
      [from, 'removed'] as const,
      [to, 'added'] as const,
    ]) {
      if (!sprintId) continue;
      const [sprint] = await tx
        .select({ state: sprints.state })
        .from(sprints)
        .where(eq(sprints.id, sprintId))
        .limit(1);
      if (sprint?.state !== 'active') continue;
      await tx.insert(sprintScopeChanges).values({
        id: this.registry.newId(),
        sprintId,
        taskId,
        change,
        movedBy: actor.userId,
      });
    }
  }

  /**
   * Who is carrying what in a sprint, and against what if anything.
   *
   * Load is knowable today from assignee and estimate. With one user it reports one row and an
   * "unassigned" line — which is the genuinely useful output right now, because it says the
   * sprint has no owners and that happens to be true of ten of eleven cards.
   *
   * `capacityMinutes` is null when nobody typed one, and the caller must render that as a
   * number with no bar. Defaulting to a forty-hour week would produce a denominator nobody
   * chose, and a bar drawn against an invented denominator is worse than no bar: it looks
   * like a measurement.
   */
  async sprintLoad(actor: Actor, sprintId: string) {
    await this.require(actor, 'scrum.tasks.read');
    const sprint = await this.rawSprint(sprintId);
    const board = await this.getBoardRaw(sprint.projectId);
    const doneKeys = (board?.columns ?? DEFAULT_COLUMNS).filter((c) => c.isDone).map((c) => c.key);

    const [rows, capacity] = await Promise.all([
      this.db
        .select({
          assigneeId: tasks.assigneeId,
          estimateMinutes: tasks.estimateMinutes,
          status: tasks.status,
          completedAt: tasks.completedAt,
        })
        .from(tasks)
        .where(and(eq(tasks.sprintId, sprintId), isNull(tasks.archivedAt))),
      this.db
        .select({ userId: sprintCapacity.userId, minutes: sprintCapacity.minutes })
        .from(sprintCapacity)
        .where(eq(sprintCapacity.sprintId, sprintId)),
    ]);

    const open = (t: (typeof rows)[number]) =>
      t.completedAt === null && !doneKeys.includes(t.status);
    const people = await this.peopleFor(rows.map((r) => r.assigneeId));
    const capacityOf = new Map(capacity.map((c) => [c.userId, c.minutes]));

    const byPerson = new Map<string, { minutes: number; cards: number }>();
    let unassignedCards = 0;
    let unassignedMinutes = 0;
    for (const t of rows) {
      if (!open(t)) continue;
      if (!t.assigneeId) {
        unassignedCards += 1;
        unassignedMinutes += t.estimateMinutes ?? 0;
        continue;
      }
      const acc = byPerson.get(t.assigneeId) ?? { minutes: 0, cards: 0 };
      acc.minutes += t.estimateMinutes ?? 0;
      acc.cards += 1;
      byPerson.set(t.assigneeId, acc);
    }

    // Anyone with a capacity row belongs in the list even carrying nothing — "Ilse has 16
    // hours and no cards" is the sentence planning exists to produce.
    for (const c of capacity) if (!byPerson.has(c.userId)) byPerson.set(c.userId, { minutes: 0, cards: 0 });

    return {
      people: [...byPerson.entries()]
        .map(([userId, load]) => ({
          userId,
          name: people.get(userId)?.displayName ?? 'Someone who has left',
          minutes: load.minutes,
          cards: load.cards,
          capacityMinutes: capacityOf.get(userId) ?? null,
        }))
        .sort((a, b) => b.minutes - a.minutes),
      unassigned: { cards: unassignedCards, minutes: unassignedMinutes },
    };
  }

  /** Set, or clear, how much time somebody has for this sprint. */
  async setCapacity(actor: Actor, sprintId: string, userId: string, minutes: number | null) {
    await this.require(actor, 'scrum.board.manage');
    await this.rawSprint(sprintId);
    await this.resolveUser(userId);

    if (minutes === null) {
      await this.db
        .delete(sprintCapacity)
        .where(and(eq(sprintCapacity.sprintId, sprintId), eq(sprintCapacity.userId, userId)));
      return;
    }
    if (!Number.isInteger(minutes) || minutes <= 0) {
      throw new BadRequestException('Capacity is a whole number of minutes, more than zero');
    }
    await this.db
      .insert(sprintCapacity)
      .values({ sprintId, userId, minutes })
      .onConflictDoUpdate({
        target: [sprintCapacity.sprintId, sprintCapacity.userId],
        set: { minutes, updatedAt: new Date() },
      });
  }

  private async rawSprint(id: string) {
    const [found] = await this.db.select().from(sprints).where(eq(sprints.id, id)).limit(1);
    if (!found) throw new NotFoundException('Sprint not found');
    return found;
  }

  /** `projectId:status` → the column's flow role, for however many projects are in a list. */
  private async flowByStatus(projectIds: string[]): Promise<Map<string, ColumnFlow>> {
    const unique = [...new Set(projectIds)];
    if (unique.length === 0) return new Map();
    const rows = await this.db
      .select({ projectId: boards.projectId, columns: boards.columns })
      .from(boards)
      .where(inArray(boards.projectId, unique));
    const map = new Map<string, ColumnFlow>();
    for (const b of rows) {
      b.columns.forEach((c, i) => map.set(`${b.projectId}:${c.key}`, flowOf(c, i)));
    }
    return map;
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
        urlPath: `/tasks/${id}`,
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
        type: this.validType(input.type),
        labels: input.labels ?? [],
        dueOn: input.dueOn ?? null,
        parentId: input.parentId ?? null,
        sprintId: input.sprintId ?? null,
        rank: String(rank),
        completedAt: column.isDone ? new Date() : null,
        createdBy: actor.userId,
      });

      // The column a card was created in, so its age is measurable from the start.
      await tx.insert(taskTransitions).values({
        id: this.registry.newId(),
        taskId: id,
        fromStatus: null,
        toStatus: status,
        movedBy: actor.userId,
      });

      // A card created straight into a running sprint arrived mid-sprint just as surely as
      // one dragged in — an action point accepted during a stand-up takes exactly this path.
      if (input.sprintId) await this.recordScopeChange(tx, actor, id, null, input.sprintId);

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
          type: patch.type ? this.validType(patch.type) : before.type,
          labels: patch.labels ?? before.labels,
          dueOn: patch.dueOn === undefined ? before.dueOn : patch.dueOn,
          parentId: patch.parentId === undefined ? before.parentId : patch.parentId,
          sprintId: patch.sprintId === undefined ? before.sprintId : patch.sprintId,
          // Completion follows the column, so it cannot drift from where the card sits.
          completedAt: column.isDone ? (before.completedAt ?? new Date()) : null,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, id));

      const nextSprintId = patch.sprintId === undefined ? before.sprintId : patch.sprintId;
      if (nextSprintId !== before.sprintId) {
        await this.recordScopeChange(tx, actor, id, before.sprintId, nextSprintId);
      }

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
        // The edit form can change the column too, and a move recorded on one path but not the
        // other would make card age lie exactly where it matters — the card somebody quietly
        // dragged back would look as though it had never left.
        await tx.insert(taskTransitions).values({
          id: this.registry.newId(),
          taskId: id,
          fromStatus: before.status,
          toStatus: status,
          movedBy: actor.userId,
        });
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
    const warnings =
      input.status === task.status ? [] : await this.warningsFor(task, column, board.columns);

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
        detail: {
          from: task.status,
          to: input.status,
          /*
           * The breach, recorded.
           *
           * A soft limit that leaves no trace changes nothing — you get a toast, you carry on,
           * and by the retrospective nobody can say whether it happened once or eleven times.
           * "We broke the limit eleven times this sprint" is a fact worth arguing about, and
           * this is the only place it can come from.
           */
          ...(warnings.length > 0 ? { warnings: warnings.map((w) => w.code) } : {}),
        },
      });

      if (input.status !== task.status) {
        // Append-only: how long a card has sat where it is cannot be recovered from
        // `updatedAt`, which moves for any edit at all.
        await tx.insert(taskTransitions).values({
          id: this.registry.newId(),
          taskId: id,
          fromStatus: task.status,
          toStatus: input.status,
          movedBy: actor.userId,
        });

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

    return { ...(await this.getTask(actor, id)), warnings };
  }

  /**
   * What is worth saying about a move without refusing it.
   *
   * Never throws, on purpose. Two written decisions already argue for advisory limits, and
   * they are right: the person who most needs to break one is dealing with something urgent,
   * and a board that fights them is a board they stop using. The gap was not soft-versus-hard
   * — it was that the check lived inside a React render, so the API and the assistant walked
   * straight past it.
   */
  private async warningsFor(
    task: { id: string; projectId: string; estimateMinutes: number | null },
    column: BoardColumn,
    columns: BoardColumn[],
  ): Promise<TaskWarning[]> {
    const warnings: TaskWarning[] = [];
    const index = columns.findIndex((c) => c.key === column.key);

    // A limit on a queue is a filing rule, not a work-in-progress limit.
    if (column.wipLimit != null && flowOf(column, index) === 'active') {
      const count = await this.wipCount(task.projectId, column.key, task.id);
      if (count + 1 > column.wipLimit) {
        warnings.push({
          code: 'wip_exceeded',
          column: column.key,
          message:
            `${column.label} is limited to ${column.wipLimit} and this makes ${count + 1}. ` +
            'Finishing something there beats starting another.',
        });
      }
    }

    /*
     * The one Definition-of-Done check worth enforcing in a shop that bills by the hour.
     *
     * Not a checklist builder — the charter lists workflow automation among its non-goals, and
     * with a team this size the checklist is in somebody's head. But a card marked done with
     * an estimate against it and no hours logged means either the work was not tracked or it
     * was not done, and both are worth a sentence before the invoice.
     */
    if (column.isDone && task.estimateMinutes != null) {
      const logged = await this.time.minutesForTask(task.id);
      if (logged === 0) {
        warnings.push({
          code: 'done_without_hours',
          column: column.key,
          message: 'Nothing was logged against this, though it carries an estimate.',
        });
      }
    }

    return warnings;
  }

  /**
   * How many cards are really in a column.
   *
   * One definition, used by the limit and by the count the board prints beside it. The board
   * used to count whatever its filters had left on screen, so narrowing to one person made a
   * column look within its limit — the number moved when the view moved.
   *
   * Subtasks do not count: a checklist item under a card is not a separate piece of work in
   * progress, and counting them would make any card with a checklist breach its own column.
   */
  private async wipCount(projectId: string, status: string, excludeId?: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, projectId),
          eq(tasks.status, status),
          isNull(tasks.archivedAt),
          isNull(tasks.completedAt),
          isNull(tasks.parentId),
          excludeId ? sql`${tasks.id} <> ${excludeId}` : undefined,
        ),
      );
    return row?.n ?? 0;
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
      /**
       * Cards whose blocker is a named person.
       *
       * `blocked_on_user_id` has been written by `blockTask` and asserted in its spec since
       * blockers were built, and no query has ever read it — so "three people are waiting on
       * you" was a fact the database held and nothing could ask for.
       */
      blockedOnUserId?: string;
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
    if (filter.blockedOnUserId) where.push(eq(tasks.blockedOnUserId, filter.blockedOnUserId));
    if (filter.dueBefore) where.push(lte(tasks.dueOn, filter.dueBefore));
    if (!filter.includeCompleted) where.push(isNull(tasks.completedAt));

    const rows = await this.db
      .select()
      .from(tasks)
      .where(and(...where))
      .orderBy(asc(tasks.rank))
      .limit(500);

    /*
     * How long each card has sat where it is.
     *
     * The standup question is "why is this still here", and the board could not answer it:
     * `updatedAt` moves when a title is corrected, so the card nobody has touched in a
     * fortnight looked as fresh as the one edited a minute ago. The latest transition into
     * the current column is the honest answer.
     */
    const ids = rows.map((r) => r.id);
    const [enteredAt, comments, people, subtasks, flows] = await Promise.all([
      this.enteredColumnAt(rows),
      this.commentCounts(ids),
      this.peopleFor(rows.map((r) => r.assigneeId)),
      this.subtaskProgress(ids),
      this.flowByStatus(rows.map((r) => r.projectId)),
    ]);
    return rows.map((r) => ({
      ...r,
      /*
       * What this card's column *means*, carried on the card.
       *
       * Cross-project screens — Today, All work — used to group by hardcoded status keys and
       * so mis-filed any column anybody renamed. They cannot reasonably fetch a board per
       * project, and this is one lookup for the whole list, so the fact travels with the card.
       */
      flow: flows.get(`${r.projectId}:${r.status}`) ?? 'active',
      enteredColumnAt: enteredAt.get(r.id) ?? r.createdAt,
      daysInColumn: Math.floor(
        (Date.now() - (enteredAt.get(r.id) ?? r.createdAt).getTime()) / 86_400_000,
      ),
      commentCount: comments.get(r.id) ?? 0,
      /*
       * The person, not the id.
       *
       * The board could not draw an avatar because it was never sent a name — `assignee_id`
       * is a bare uuid and every screen that wanted to show who was on a card had to fetch
       * the whole user list and join it itself. Two did; the board simply showed nobody.
       */
      assignee: (r.assigneeId && people.get(r.assigneeId)) || null,
      subtasks: subtasks.get(r.id) ?? { done: 0, total: 0 },
    }));
  }

  /** Display names for a set of user ids, deduplicated, in one query. */
  private async peopleFor(
    userIds: Array<string | null>,
  ): Promise<Map<string, { id: string; displayName: string }>> {
    const map = new Map<string, { id: string; displayName: string }>();
    const wanted = [...new Set(userIds.filter((id): id is string => id !== null))];
    if (wanted.length === 0) return map;

    const rows = await this.db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, wanted));
    for (const row of rows) map.set(row.id, row);
    return map;
  }

  /**
   * How much of each card's checklist is ticked.
   *
   * Subtasks are not a separate kind of thing here — a subtask is a task with a parent, which
   * is what lets one be estimated, assigned and timed like any other. The cost is that "three
   * of five done" needs counting rather than reading, so it is counted once for the whole
   * board instead of per card.
   */
  private async subtaskProgress(
    parentIds: string[],
  ): Promise<Map<string, { done: number; total: number }>> {
    const map = new Map<string, { done: number; total: number }>();
    if (parentIds.length === 0) return map;

    const rows = await this.db
      .select({
        parentId: tasks.parentId,
        total: sql<number>`count(*)::int`,
        done: sql<number>`count(${tasks.completedAt})::int`,
      })
      .from(tasks)
      .where(and(inArray(tasks.parentId, parentIds), isNull(tasks.archivedAt)))
      .groupBy(tasks.parentId);

    for (const row of rows) {
      if (row.parentId) map.set(row.parentId, { done: row.done, total: row.total });
    }
    return map;
  }

  /** Every column this card has been in, oldest first, with who moved it. */
  private async historyOf(taskId: string) {
    return this.db
      .select({
        id: taskTransitions.id,
        fromStatus: taskTransitions.fromStatus,
        toStatus: taskTransitions.toStatus,
        at: taskTransitions.at,
        movedBy: taskTransitions.movedBy,
        movedByName: users.displayName,
      })
      .from(taskTransitions)
      .leftJoin(users, eq(users.id, taskTransitions.movedBy))
      .where(eq(taskTransitions.taskId, taskId))
      .orderBy(asc(taskTransitions.at));
  }

  /**
   * When each of these cards last entered the column it is in now.
   *
   * Matched on `toStatus` rather than simply taking the newest row. The two agree while the
   * history is complete, and disagree the moment it is not — a card whose status was set by a
   * path that wrote no transition would otherwise be dated from an unrelated move and report
   * an age that is merely plausible. Reading the column back is the difference between a
   * number derived from evidence and one derived from an assumption.
   */
  private async enteredColumnAt(
    cards: Array<{ id: string; status: string }>,
  ): Promise<Map<string, Date>> {
    const map = new Map<string, Date>();
    if (cards.length === 0) return map;

    const status = new Map(cards.map((c) => [c.id, c.status]));
    const rows = await this.db
      .select({
        taskId: taskTransitions.taskId,
        toStatus: taskTransitions.toStatus,
        at: taskTransitions.at,
      })
      .from(taskTransitions)
      .where(inArray(taskTransitions.taskId, [...status.keys()]))
      .orderBy(asc(taskTransitions.at));

    // Walking in order leaves the most recent arrival into the column the card is in now.
    for (const row of rows) {
      if (row.toStatus === status.get(row.taskId)) map.set(row.taskId, row.at);
    }
    return map;
  }

  /**
   * How many comments each card has, in one query rather than one per card.
   *
   * Read from `core.comments`, which is where discussion on any record already lives — a
   * task, a note, an invoice. A comments table of its own inside scrum would have been a
   * second answer to a question the platform had already answered, and the card would have
   * shown a count that disagreed with the thread underneath it.
   */
  private async commentCounts(taskIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (taskIds.length === 0) return map;

    const rows = await this.db
      .select({ taskId: comments.subjectId, count: sql<number>`count(*)::int` })
      .from(comments)
      .where(and(inArray(comments.subjectId, taskIds), isNull(comments.deletedAt)))
      .groupBy(comments.subjectId);

    for (const row of rows) map.set(row.taskId, row.count);
    return map;
  }
  /** One task with the hours logged against it — the reason this module exists. */
  async getTask(actor: Actor, id: string) {
    await this.require(actor, 'scrum.tasks.read');
    const task = await this.rawTask(id);
    const [children, loggedMinutes, assignee, enteredAt, comments, flows] = await Promise.all([
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
      // The same derived facts the board shows, so the card and the page it opens agree.
      this.enteredColumnAt([task]),
      this.commentCounts([id]),
      this.flowByStatus([task.projectId]),
    ]);
    const since = enteredAt.get(id) ?? task.createdAt;

    return {
      ...task,
      flow: flows.get(`${task.projectId}:${task.status}`) ?? 'active',
      children,
      loggedMinutes,
      assignee,
      /*
       * Where this card has been, and who moved it.
       *
       * The transition log was written for card age and has been accumulating ever since with
       * nothing reading it beyond one derived number. It is the honest answer to "why has this
       * been in review for a week" — it says when it arrived and what it came from.
       */
      history: await this.historyOf(id),
      enteredColumnAt: since,
      daysInColumn: Math.floor((Date.now() - since.getTime()) / 86_400_000),
      commentCount: comments.get(id) ?? 0,
    };
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
        /*
         * The assignee, id and all.
         *
         * Without it the model has no way to obtain a user uuid, so asked to give a card to
         * somebody it will invent one — and `scrum_create_task` now accepts an assignee, which
         * turns that from a harmless mistake into a rejected write or a wrong one.
         */
        assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.displayName } : null,
        blocked: t.blockedReason ?? null,
        sprintId: t.sprintId,
      })),
    };
  }

  async createTaskTool(actor: Actor, input: CreateTaskInput) {
    const task = await this.createTask(actor, input, { aiInitiated: true });
    return { id: task.id, title: task.title, status: task.status };
  }

  /**
   * Edit a card that already exists.
   *
   * The assistant could create and move, so anything else — an estimate, a due date, a new
   * owner — it had to report as impossible even though the edit form does it every day.
   * Only the keys present are sent on, so an unmentioned field keeps its value.
   */
  async updateTaskTool(actor: Actor, input: UpdateTaskToolInput) {
    const { taskId, ...patch } = input;
    const task = await this.updateTask(actor, taskId, patch);
    return { id: task.id, title: task.title, status: task.status };
  }

  /**
   * The sprint as a paragraph.
   *
   * Trimmed hard on purpose: a model reading a sprint wants the goal, the shape of the
   * progress and the names of what is stuck, not every field. The blocked list is included
   * because "will we make it" is nearly always answered by it.
   */
  async sprintStatusTool(actor: Actor, input: { projectId: string }) {
    const active = await this.activeSprint(input.projectId);
    if (!active) return { running: false as const };

    const [sprint, load, cards] = await Promise.all([
      this.getSprint(actor, active.id),
      this.sprintLoad(actor, active.id),
      this.sprintCards(actor, active.id),
    ]);
    const blocked = await this.listTasks(actor, { projectId: input.projectId, sprintId: active.id });

    return {
      running: true as const,
      name: sprint.name,
      goal: sprint.goal,
      endsOn: sprint.endsOn,
      day: sprint.progress.days,
      unit: sprint.progress.unit,
      done: sprint.progress.unit === 'minutes' ? sprint.progress.minutes : sprint.progress.cards,
      unfinished: cards.unfinished,
      blocked: blocked
        .filter((t) => t.blockedReason)
        .map((t) => ({ title: t.title, reason: t.blockedReason })),
      load: load.people.map((p) => ({
        name: p.name,
        hours: Math.round((p.minutes / 60) * 10) / 10,
        // Null rather than a default, so the model cannot report a percentage of a number
        // nobody chose.
        capacityHours: p.capacityMinutes ? Math.round((p.capacityMinutes / 60) * 10) / 10 : null,
      })),
      unassignedCards: load.unassigned.cards,
    };
  }

  /** Flow, in hours, with the "not enough data yet" verdict kept rather than flattened. */
  async flowTool(actor: Actor, input: { projectId: string }) {
    const flow = await this.flow(actor, input.projectId);
    const asHours = (m: number | null) => (m === null ? null : Math.round((m / 60) * 10) / 10);
    return {
      cycleTime: {
        finishedCards: flow.cycle.n,
        // The refusal travels with the numbers. Without it a model reading p50: null next to
        // a sample list will helpfully average the list and present it as a median.
        enoughToGeneralise: flow.cycle.meaningful,
        medianHours: asHours(flow.cycle.p50),
        p85Hours: asHours(flow.cycle.p85),
      },
      inFlight: flow.aging.slice(0, 10).map((a) => ({
        title: a.title,
        days: Math.round((a.minutes / 1440) * 10) / 10,
        waitingOnClient: a.waiting,
        measured: a.measured,
      })),
      waitingOnClient: { hours: asHours(flow.waiting.minutes), spells: flow.waiting.spells },
      finishedPerWeek: flow.throughput,
      cardsWithoutHistory: flow.excluded,
    };
  }

  async moveTaskTool(actor: Actor, input: { taskId: string; status: string }) {
    const task = await this.moveTask(actor, input.taskId, { status: input.status });
    // The warning goes to the model too. It walked past the limit entirely while the check
    // lived in a React render, and a limit only one of two callers can see is not a limit.
    return {
      id: task.id,
      status: task.status,
      ...(task.warnings.length > 0 ? { warnings: task.warnings.map((w) => w.message) } : {}),
    };
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

  /**
   * story | bug | chore | spike, and nothing else.
   *
   * The point of the vocabulary is that a sprint report can subtract the bugs from the
   * velocity; a free-text field would make that arithmetic guesswork within a month.
   */
  private validType(type?: string | null): string {
    const allowed = ['story', 'bug', 'chore', 'spike'];
    if (!type) return 'story';
    if (!allowed.includes(type)) {
      throw new BadRequestException(`Unknown task type '${type}' — one of ${allowed.join(', ')}`);
    }
    return type;
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
    if (!user) {
      // Naming the cause matters: users appear the first time they sign in, so a colleague
      // who has not logged in yet simply is not here, and "must be an existing user" reads
      // like a bug rather than an instruction.
      throw new BadRequestException(
        'They have to sign in once before work can be assigned to them.',
      );
    }
    return user.id;
  }

  private async require(actor: Actor, capability: string): Promise<void> {
    if (!(await this.permissions.can(actor, capability))) {
      throw new ForbiddenException(`Missing capability '${capability}'`);
    }
  }

  async ensureReportingViews(): Promise<void> {
    /*
     * What each column means, per project, as SQL.
     *
     * The roles live in `boards.columns` jsonb, and the fallback for a board that predates the
     * field has to match `flowOf` in the schema exactly — two definitions of "is this column
     * where work happens" would drift, and the one in SQL is the one the metrics and the
     * insight rules would believe. Kept as its own view so there is a single place to look.
     */
    await this.db.execute(sql`DROP VIEW IF EXISTS scrum.v_column_flow CASCADE`);
    await this.db.execute(sql`
      CREATE VIEW scrum.v_column_flow AS
      SELECT b.project_id,
             c.value->>'key' AS status,
             c.ord::int AS position,
             coalesce(
               c.value->>'flow',
               CASE WHEN (c.value->>'isDone')::boolean THEN 'done'
                    WHEN c.ord = 1 THEN 'queue'
                    ELSE 'active' END
             ) AS flow
        FROM scrum.boards b,
             LATERAL jsonb_array_elements(b.columns) WITH ORDINALITY AS c(value, ord)
    `);

    /*
     * How each card has actually flowed.
     *
     * One row per live card. The spans come from a window over the transitions rather than
     * from `from_status`: the previous row's `to_status` *is* the from-status, so reading it
     * would only add a way to disagree with itself, and the NULL on a creation row stops being
     * a special case. A card that re-enters a column produces two spans, which is the whole
     * point — the card's current column cannot tell you it has been here before.
     *
     * Firsts, not lasts. Cycle time runs from the first time work started to the first time it
     * was done, because a card that bounced out of review and back took all of that.
     *
     * `first_done_at` rather than `completed_at` for anything counted: `completed_at` is
     * *nulled* when a card leaves a done column, so a re-opened card silently vanishes from
     * any throughput built on it. `completed_at` survives here only as the fallback for cards
     * created before the transitions table existed, which have no rows at all.
     */
    await this.db.execute(sql`DROP VIEW IF EXISTS scrum.v_task_flow CASCADE`);
    await this.db.execute(sql`
      CREATE VIEW scrum.v_task_flow AS
      WITH spans AS (
        SELECT x.task_id, x.to_status, x.at,
               lead(x.at) OVER (PARTITION BY x.task_id ORDER BY x.at, x.id) AS until
          FROM scrum.task_transitions x
      ),
      labelled AS (
        SELECT s.task_id, s.at, s.until,
               -- A span in a column the board no longer has still happened. Counting it as
               -- active errs toward the longer, less flattering cycle time.
               coalesce(f.flow, 'active') AS flow
          FROM spans s
          JOIN scrum.tasks t ON t.id = s.task_id
          LEFT JOIN scrum.v_column_flow f
            ON f.project_id = t.project_id AND f.status = s.to_status
      ),
      rolled AS (
        SELECT task_id,
               min(at) FILTER (WHERE flow = 'active') AS first_work_at,
               min(at) FILTER (WHERE flow = 'done') AS first_done_at,
               count(*) FILTER (WHERE flow = 'done') AS done_entries,
               coalesce(sum(EXTRACT(epoch FROM (coalesce(until, now()) - at)) / 60)
                        FILTER (WHERE flow = 'waiting'), 0) AS waiting_minutes,
               count(*) FILTER (WHERE flow = 'waiting') AS waiting_spells,
               count(*) AS transitions
          FROM labelled GROUP BY task_id
      )
      SELECT t.id AS task_id, t.project_id, t.assignee_id, t.title, t.type, t.status,
             t.created_at, t.completed_at,
             cf.flow AS current_flow,
             (r.transitions IS NOT NULL) AS has_history,
             r.first_work_at, r.first_done_at,
             coalesce(round(r.waiting_minutes), 0)::int AS waiting_minutes,
             coalesce(r.waiting_spells, 0)::int AS waiting_spells,
             -- How many times it came back after being done.
             greatest(coalesce(r.done_entries, 0) - 1, 0)::int AS reopen_count,
             CASE WHEN r.first_work_at IS NOT NULL AND r.first_done_at IS NOT NULL
                  THEN round(EXTRACT(epoch FROM (r.first_done_at - r.first_work_at)) / 60)::int
             END AS cycle_minutes,
             -- Lead time survives without any history: a card created before the transitions
             -- table existed still knows when it was made and when it finished.
             CASE WHEN coalesce(r.first_done_at, t.completed_at) IS NOT NULL
                  THEN round(EXTRACT(epoch FROM
                       (coalesce(r.first_done_at, t.completed_at) - t.created_at)) / 60)::int
             END AS lead_minutes,
             -- In flight right now: started, not finished. Measured from when work started,
             -- not from when it entered this column, so bouncing does not reset the clock.
             --
             -- A card with no history at all falls back to when it was created. That is an
             -- upper bound rather than a measurement — it cannot have been in flight longer
             -- than it has existed — and it errs toward showing an old card rather than
             -- hiding one, which is the right direction for the number whose entire job is to
             -- make you look. has_history says which of the two you are reading.
             CASE WHEN t.completed_at IS NULL AND cf.flow IN ('active','waiting')
                  THEN round(EXTRACT(epoch FROM
                       (now() - coalesce(r.first_work_at, t.created_at))) / 60)::int
             END AS age_minutes,
             -- Not the same thing, and conflating them is how a board reports two hundred
             -- aging items and gets ignored: this one has not been started at all.
             CASE WHEN t.completed_at IS NULL AND cf.flow = 'queue'
                  THEN round(EXTRACT(epoch FROM (now() - t.created_at)) / 60)::int
             END AS queued_minutes
        FROM scrum.tasks t
        LEFT JOIN rolled r ON r.task_id = t.id
        LEFT JOIN scrum.v_column_flow cf
          ON cf.project_id = t.project_id AND cf.status = t.status
       WHERE t.archived_at IS NULL
    `);

    await this.db.execute(sql`DROP VIEW IF EXISTS scrum.v_tasks CASCADE`);
    await this.db.execute(sql`
      CREATE VIEW scrum.v_tasks AS
      SELECT t.id, t.project_id, t.title, t.status, t.priority, t.assignee_id,
             t.estimate_minutes, t.estimate_minutes / 60.0 AS estimate_hours,
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
             -- time somebody tidied up. Done vs total, in cards and in estimated minutes,
             -- is what a review reads.
             (SELECT count(*) FROM scrum.tasks t
               WHERE t.sprint_id = s.id AND t.archived_at IS NULL) AS task_count,
             (SELECT count(*) FROM scrum.tasks t
               WHERE t.sprint_id = s.id AND t.archived_at IS NULL
                 AND t.completed_at IS NOT NULL) AS done_count,
             (SELECT coalesce(sum(t.estimate_minutes), 0) FROM scrum.tasks t
               WHERE t.sprint_id = s.id AND t.archived_at IS NULL) AS minutes_total,
             (SELECT coalesce(sum(t.estimate_minutes), 0) FROM scrum.tasks t
               WHERE t.sprint_id = s.id AND t.archived_at IS NULL
                 AND t.completed_at IS NOT NULL) AS minutes_done
        FROM scrum.sprints s
    `);
  }
}
