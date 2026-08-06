import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { DB, type Database, type Tx } from '../../core/db/db.module.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { CrmService } from '../crm/crm.service.js';
import { entries } from './time.schema.js';

export type BillingStatus = 'not_billable' | 'unbilled' | 'on_draft' | 'invoiced';

/**
 * What has happened to these hours, money-wise — derived, never stored, so it cannot
 * fall out of step with the columns it reads.
 */
export function billingStatus(row: {
  billable: boolean;
  invoiceId: string | null;
  invoicedAt: Date | null;
}): BillingStatus {
  if (!row.billable) return 'not_billable';
  if (row.invoicedAt) return 'invoiced';
  if (row.invoiceId) return 'on_draft';
  return 'unbilled';
}

export interface CreateEntryInput {
  /** A project, a client, or neither — see the schema. At most one of these two. */
  projectId?: string | null;
  clientId?: string | null;
  /** Optional task; validated through the registry, so Time needs no SCRUM dependency. */
  taskId?: string | null;
  workedOn?: string; // ISO date; defaults to today or the start time's day
  minutes?: number | null;
  startedAt?: string | null; // ISO timestamp
  endedAt?: string | null;
  description?: string | null;
  billable?: boolean;
  personId?: string;
}

export interface ProjectBurn {
  projectId: string;
  projectName: string;
  billingModel: string;
  currency: string;
  budgetedHours: number | null;
  loggedHours: number;
  billableHours: number;
  /** Billable hours by how far they have got towards an invoice; these three sum to billableHours. */
  invoicedHours: number;
  onDraftHours: number;
  uninvoicedHours: number;
  uninvoicedAmountCents: number | null;
  budgetAmountCents: number | null;
  burnedAmountCents: number | null;
}

/** Monday of the week containing `date`. Weeks start Monday (Dutch/EU convention). */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Time Registration.
 *
 * The first module that depends on another: budget burn needs CRM's project data, so it
 * calls CrmService — never crm.projects — which is what keeps both modules replaceable
 * (Master §10). The dependency runs one way only: Time → CRM.
 */
@Injectable()
export class TimeService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly registry: RegistryService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly links: LinkService,
    private readonly crm: CrmService,
  ) {}

  // ── entries ────────────────────────────────────────────────

  /**
   * Create an entry. Accepts a bare duration, a finished session (start+end), or a
   * running session (start only) — see the schema comment for why those three.
   */
  async createEntry(actor: Actor, input: CreateEntryInput, origin: { aiInitiated?: boolean } = {}) {
    await this.require(actor, 'time.entries.write_own');
    const personId = input.personId ?? actor.userId;
    if (personId !== actor.userId) await this.require(actor, 'time.entries.manage');

    const startedAt = input.startedAt ? this.parseInstant(input.startedAt) : null;
    const endedAt = input.endedAt ? this.parseInstant(input.endedAt) : null;
    const workedOn = this.validateDate(
      input.workedOn ?? startedAt?.toISOString().slice(0, 10) ?? today(),
    );

    const minutes = this.resolveMinutes(input.minutes ?? null, startedAt, endedAt);
    const running = startedAt !== null && endedAt === null;

    if (running) await this.assertNoRunningEntry(personId);

    const target = await this.resolveTarget(actor, input.projectId, input.clientId);
    const taskId = await this.resolveTask(input.taskId);

    const id = this.registry.newId();
    await this.db.transaction(async (tx) => {
      await this.registry.register(tx, {
        id,
        entityType: 'time_entry',
        displayName: this.displayName(target.name, minutes, input.description, running),
        urlPath: `/time/entries/${id}`,
      });

      await tx.insert(entries).values({
        id,
        personId,
        projectId: target.projectId,
        clientId: target.clientId,
        taskId,
        workedOn,
        startedAt,
        endedAt,
        minutes,
        /*
         * Billable only when there is somewhere to send it, and true by default only on a
         * project. Client-level work is usually scoping or account care, which is a cost of
         * winning the work rather than the work; internal hours can never be sold at all.
         * An explicit choice always wins where the target allows one.
         */
        billable:
          (target.projectId !== null || target.clientId !== null) &&
          (input.billable ?? target.projectId !== null),
        description: input.description ?? null,
      });

      /*
       * Linked to whatever it is against, when it is against anything.
       *
       * Internal hours have nothing to appear on a timeline of, so they get no link rather
       * than a link to a placeholder — which is the whole point of not inventing one.
       */
      const linkTo = target.projectId ?? target.clientId;
      if (linkTo) {
        await this.links.createWithin(tx, actor, {
          fromId: id,
          toId: linkTo,
          kind: 'logged_against',
        });
      }

      // Linked to the task as well, so hours show on the task's own timeline.
      if (taskId) {
        await this.links.createWithin(tx, actor, {
          fromId: id,
          toId: taskId,
          kind: 'logged_against',
        });
      }

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: running ? 'time_entry.start' : 'time_entry.create',
        entityType: 'time_entry',
        entityId: id,
        detail: { projectId: input.projectId, workedOn, minutes, running },
        aiInitiated: origin.aiInitiated ?? false,
      });

      await this.events.publish(tx, {
        name: 'time_entry.created',
        entityType: 'time_entry',
        entityId: id,
        actorId: actor.userId,
        payload: { projectId: input.projectId, minutes, workedOn, running },
      });
    });

    return this.getEntry(actor, id);
  }

  async updateEntry(actor: Actor, id: string, patch: Partial<CreateEntryInput>) {
    await this.require(actor, 'time.entries.write_own');
    const before = await this.rawEntry(id);
    if (before.personId !== actor.userId) await this.require(actor, 'time.entries.manage');
    if (before.invoicedAt) {
      throw new BadRequestException(
        'These hours are on an issued invoice and cannot be changed — credit the invoice first',
      );
    }

    /*
     * Moving an hour between a project, a client and internal.
     *
     * Both ids are considered together: setting one has to clear the other, or the row would
     * fail the database's check with a message nobody can act on.
     */
    const retarget = patch.projectId !== undefined || patch.clientId !== undefined;
    const target = retarget
      ? await this.resolveTarget(
          actor,
          patch.projectId === undefined ? before.projectId : patch.projectId,
          patch.clientId === undefined ? before.clientId : patch.clientId,
        )
      : { projectId: before.projectId, clientId: before.clientId, name: '' };

    const startedAt =
      patch.startedAt === undefined ? before.startedAt : this.parseInstantOrNull(patch.startedAt);
    const endedAt =
      patch.endedAt === undefined ? before.endedAt : this.parseInstantOrNull(patch.endedAt);
    const workedOn = this.validateDate(patch.workedOn ?? before.workedOn);
    const minutes = this.resolveMinutes(
      patch.minutes === undefined ? before.minutes : (patch.minutes ?? null),
      startedAt,
      endedAt,
      // A running entry that stays running keeps its null duration.
      { allowNullWhenRunning: true },
    );

    await this.db.transaction(async (tx) => {
      await tx
        .update(entries)
        .set({
          projectId: target.projectId,
          clientId: target.clientId,
          workedOn,
          startedAt,
          endedAt,
          minutes,
          /*
           * Billable follows the target when the target moves.
           *
           * Retargeting an hour to internal has to clear billable, or the write fails the
           * check constraint — and an hour moved off a project is one nobody meant to keep
           * selling anyway.
           */
          billable:
            (target.projectId !== null || target.clientId !== null) &&
            (patch.billable ?? before.billable),
          description: patch.description === undefined ? before.description : patch.description,
          updatedAt: new Date(),
        })
        .where(eq(entries.id, id));

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'time_entry.update',
        entityType: 'time_entry',
        entityId: id,
        detail: { before: { minutes: before.minutes }, after: { minutes } },
      });
    });

    return this.getEntry(actor, id);
  }

  /** Stop a running entry: set the end to now and freeze the elapsed minutes. */
  async stopEntry(actor: Actor, id?: string) {
    await this.require(actor, 'time.entries.write_own');
    const running = id ? await this.rawEntry(id) : await this.runningEntry(actor.userId);
    if (!running) throw new NotFoundException('Nothing is running');
    if (running.endedAt) throw new BadRequestException('That entry has already stopped');
    if (running.personId !== actor.userId) await this.require(actor, 'time.entries.manage');

    const endedAt = new Date();
    const minutes = Math.max(1, Math.round((endedAt.getTime() - running.startedAt!.getTime()) / 60_000));

    await this.db.transaction(async (tx) => {
      await tx
        .update(entries)
        .set({ endedAt, minutes, updatedAt: endedAt })
        .where(eq(entries.id, running.id));
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'time_entry.stop',
        entityType: 'time_entry',
        entityId: running.id,
        detail: { minutes },
      });
    });

    return this.getEntry(actor, running.id);
  }

  async deleteEntry(actor: Actor, id: string) {
    await this.require(actor, 'time.entries.write_own');
    const row = await this.rawEntry(id);
    if (row.personId !== actor.userId) await this.require(actor, 'time.entries.manage');
    if (row.invoicedAt) {
      throw new BadRequestException(
        'These hours are on an issued invoice and cannot be deleted — credit the invoice first',
      );
    }

    await this.db.transaction(async (tx) => {
      await tx.delete(entries).where(eq(entries.id, id));
      await this.registry.softDelete(tx, id);
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'time_entry.delete',
        entityType: 'time_entry',
        entityId: id,
        detail: { minutes: row.minutes, projectId: row.projectId },
      });
    });
  }

  async getEntry(actor: Actor, id: string) {
    await this.require(actor, 'time.entries.write_own');
    const row = await this.rawEntry(id);
    if (row.personId !== actor.userId) await this.require(actor, 'time.entries.read_all');
    return this.decorate(row);
  }

  // ── day view: the primary screen ───────────────────────────

  /**
   * Entries across a span of days, newest first, grouped by the day they were worked on.
   *
   * `getDay` answers "what did I do on Tuesday" and the week view answers "how much per
   * project" — neither answers "what have I been doing lately", which is what a tracker
   * screen shows under the clock. Fetching seven days one call at a time would work and
   * would be seven round trips for one list.
   */
  async getRecent(
    actor: Actor,
    opts: { from?: string; to?: string; personId?: string } = {},
  ) {
    await this.require(actor, 'time.entries.write_own');
    const personId = opts.personId ?? actor.userId;
    if (personId !== actor.userId) await this.require(actor, 'time.entries.read_all');

    const to = this.validateDate(opts.to ?? today());
    const from = this.validateDate(
      opts.from ?? new Date(Date.parse(to) - 13 * 86_400_000).toISOString().slice(0, 10),
    );

    const rows = await this.db
      .select()
      .from(entries)
      .where(
        and(
          eq(entries.personId, personId),
          gte(entries.workedOn, from),
          lte(entries.workedOn, to),
        ),
      )
      .orderBy(desc(entries.workedOn), desc(entries.startedAt), desc(entries.createdAt));

    const label = await this.labelsFor(actor, rows);
    const decorated = rows.map((r) => ({ ...this.decorate(r), ...label(r) }));

    // Grouped here rather than in the browser: the day totals are the point of the grouping,
    // and a total computed twice is a total that eventually disagrees with itself.
    const byDay = new Map<string, typeof decorated>();
    for (const entry of decorated) {
      const list = byDay.get(entry.workedOn) ?? [];
      list.push(entry);
      byDay.set(entry.workedOn, list);
    }

    return {
      from,
      to,
      days: [...byDay.entries()].map(([date, list]) => ({
        date,
        entries: list,
        /*
         * `effectiveMinutes`, not the raw column — the same basis every other total in this
         * service uses. `minutes` is null for an entry timed by its start and end, and does
         * not move for one that is still running, so summing it produced a day total that
         * disagreed with the rows printed underneath it.
         */
        totalMinutes: list.reduce((sum, e) => sum + e.effectiveMinutes, 0),
      })),
    };
  }

  async getDay(actor: Actor, opts: { date?: string; personId?: string } = {}) {
    await this.require(actor, 'time.entries.write_own');
    const personId = opts.personId ?? actor.userId;
    if (personId !== actor.userId) await this.require(actor, 'time.entries.read_all');

    const date = this.validateDate(opts.date ?? today());
    const rows = await this.db
      .select()
      .from(entries)
      .where(and(eq(entries.personId, personId), eq(entries.workedOn, date)))
      .orderBy(asc(entries.startedAt), asc(entries.createdAt));

    const label = await this.labelsFor(actor, rows);

    return {
      date,
      entries: rows.map((r) => ({ ...this.decorate(r), ...label(r) })),
      totalMinutes: rows.reduce((sum, r) => sum + this.effectiveMinutes(r), 0),
      billableMinutes: rows
        .filter((r) => r.billable)
        .reduce((sum, r) => sum + this.effectiveMinutes(r), 0),
    };
  }

  /** Whatever is currently running for this person, if anything. */
  async getRunning(actor: Actor) {
    await this.require(actor, 'time.entries.write_own');
    const row = await this.runningEntry(actor.userId);
    if (!row) return { running: null };
    const label = await this.labelsFor(actor, [row]);
    return {
      running: {
        ...this.decorate(row),
        ...label(row),
        // What the clock says it is against, whichever of the three shapes it is.
        projectName: label(row).targetName,
      },
    };
  }

  // ── week summary (read-only now that entries carry detail) ──

  async getWeek(actor: Actor, opts: { weekOf?: string; personId?: string } = {}) {
    await this.require(actor, 'time.entries.write_own');
    const personId = opts.personId ?? actor.userId;
    if (personId !== actor.userId) await this.require(actor, 'time.entries.read_all');

    const monday = weekStart(opts.weekOf ?? today());
    const sunday = addDays(monday, 6);
    const week = await this.entriesBetween(personId, monday, sunday);

    /*
     * The week grid is one row per thing worked on, and "thing" now includes a client and
     * internal. Keyed by whichever id an entry carries, with a fixed key for the hours that
     * carry neither — otherwise a fortnight of internal work would collapse into a row
     * labelled "(unavailable)" and look like a bug.
     */
    const label = await this.labelsFor(actor, week);
    const keyOf = (e: { projectId: string | null; clientId: string | null }) =>
      e.projectId ?? e.clientId ?? 'internal';
    const keys = [...new Set(week.map(keyOf))];

    const rows = keys.map((id) => {
      const first = week.find((e) => keyOf(e) === id)!;
      return {
      id,
      name: label(first).targetName,
      clientName: label(first).clientName,
      days: Object.fromEntries(
        Array.from({ length: 7 }, (_, i) => {
          const day = addDays(monday, i);
          const minutes = week
            .filter((e) => keyOf(e) === id && e.workedOn === day)
            .reduce((sum, e) => sum + this.effectiveMinutes(e), 0);
          return [day, minutes];
        }),
      ),
      };
    });

    return {
      weekOf: monday,
      days: Array.from({ length: 7 }, (_, i) => addDays(monday, i)),
      rows,
      totalMinutes: week.reduce((sum, e) => sum + this.effectiveMinutes(e), 0),
      billableMinutes: week
        .filter((e) => e.billable)
        .reduce((sum, e) => sum + this.effectiveMinutes(e), 0),
    };
  }

  // ── cross-module reads ─────────────────────────────────────

  /**
   * Minutes logged against one task. Called by SCRUM to show effort on a task without
   * either module reaching into the other's tables.
   */
  async minutesForTask(taskId: string): Promise<number> {
    const rows = await this.db
      .select({
        minutes: entries.minutes,
        startedAt: entries.startedAt,
        endedAt: entries.endedAt,
      })
      .from(entries)
      .where(eq(entries.taskId, taskId));
    return rows.reduce((sum, r) => sum + this.effectiveMinutes(r), 0);
  }

  /**
   * Claim entries for an invoice, inside the caller's transaction.
   *
   * Called by Billing whenever invoice lines are written, so an hour's billing state and
   * the line that bills it commit together or not at all. Refuses to steal hours already
   * claimed by a different invoice — that refusal IS the double-billing guard, enforced
   * at the moment of writing rather than by a hopeful read beforehand.
   */
  async claimForInvoice(tx: Tx, invoiceId: string, entryIds: string[]): Promise<void> {
    if (entryIds.length === 0) return;

    const claimed = await tx
      .select({ id: entries.id, invoiceId: entries.invoiceId })
      .from(entries)
      .where(and(inArray(entries.id, entryIds), isNotNull(entries.invoiceId)));

    const stolen = claimed.filter((row) => row.invoiceId !== invoiceId);
    if (stolen.length > 0) {
      throw new BadRequestException(
        `${stolen.length} of these hours are already on another invoice`,
      );
    }

    await tx
      .update(entries)
      .set({ invoiceId, updatedAt: new Date() })
      .where(inArray(entries.id, entryIds));
  }

  /** Release every hour an invoice claims — a voided draft, or a credited invoice. */
  async releaseFromInvoice(tx: Tx, invoiceId: string): Promise<void> {
    await tx
      .update(entries)
      .set({ invoiceId: null, invoicedAt: null, updatedAt: new Date() })
      .where(eq(entries.invoiceId, invoiceId));
  }

  /** Stamp the hours as actually invoiced — the invoice left the building. */
  async markInvoiced(tx: Tx, invoiceId: string, at: Date): Promise<void> {
    await tx
      .update(entries)
      .set({ invoicedAt: at, updatedAt: new Date() })
      .where(eq(entries.invoiceId, invoiceId));
  }

  /**
   * Billable entries for a project — what invoicing bills from.
   *
   * There is no submission step: an hour with a recorded duration is billable the
   * moment it is logged. The review that submission used to provide now happens on the
   * invoice draft, which is editable and shows exactly what the client would see.
   * Running timers are excluded because they have no duration yet.
   */
  async entriesForBilling(projectId: string) {
    return this.db
      .select({
        id: entries.id,
        personId: entries.personId,
        workedOn: entries.workedOn,
        minutes: entries.minutes,
      })
      .from(entries)
      .where(
        and(
          eq(entries.projectId, projectId),
          eq(entries.billable, true),
          isNotNull(entries.minutes), // a running timer has no duration yet
          isNull(entries.invoiceId), //   already claimed by an invoice
        ),
      )
      .orderBy(asc(entries.workedOn));
  }

  // ── budget burn: the cross-module read ─────────────────────

  async projectBurn(actor: Actor, projectId: string): Promise<ProjectBurn> {
    await this.require(actor, 'time.entries.read_all');
    const project = await this.crm.getProject(actor, projectId); // service, not schema

    const rows = await this.db
      .select({
        minutes: entries.minutes,
        billable: entries.billable,
        startedAt: entries.startedAt,
        endedAt: entries.endedAt,
        invoiceId: entries.invoiceId,
        invoicedAt: entries.invoicedAt,
      })
      .from(entries)
      .where(eq(entries.projectId, projectId));

    const loggedMinutes = rows.reduce((s, r) => s + this.effectiveMinutes(r), 0);
    const billableMinutes = rows
      .filter((r) => r.billable)
      .reduce((s, r) => s + this.effectiveMinutes(r), 0);

    // Billable hours split by how far they have travelled towards an invoice. The gap
    // between billable and invoiced is money earned but not yet asked for.
    const sumWhere = (predicate: (r: (typeof rows)[number]) => boolean) =>
      rows.filter((r) => r.billable && predicate(r)).reduce((s, r) => s + this.effectiveMinutes(r), 0);

    const invoicedMinutes = sumWhere((r) => r.invoicedAt !== null);
    const onDraftMinutes = sumWhere((r) => r.invoicedAt === null && r.invoiceId !== null);
    const uninvoicedMinutes = billableMinutes - invoicedMinutes - onDraftMinutes;
    const rate = project.defaultRateCents;
    const hours = (minutes: number) => +(minutes / 60).toFixed(2);

    return {
      projectId,
      projectName: project.name,
      billingModel: project.billingModel,
      currency: project.currency,
      budgetedHours: project.budgetHours ? Number(project.budgetHours) : null,
      loggedHours: +(loggedMinutes / 60).toFixed(2),
      billableHours: hours(billableMinutes),
      invoicedHours: hours(invoicedMinutes),
      onDraftHours: hours(onDraftMinutes),
      uninvoicedHours: hours(uninvoicedMinutes),
      /** What the not-yet-invoiced billable hours are worth at the project rate. */
      uninvoicedAmountCents:
        rate != null ? Math.round((uninvoicedMinutes / 60) * rate) : null,
      budgetAmountCents: project.budgetAmountCents,
      burnedAmountCents:
        project.defaultRateCents != null
          ? Math.round((billableMinutes / 60) * project.defaultRateCents)
          : null,
    };
  }

  // ── internals ──────────────────────────────────────────────

  /**
   * Minutes a row counts for. A running entry has no stored duration, so its elapsed
   * time is computed live — otherwise a timer running since this morning would show as
   * zero in every total.
   */
  /**
   * What an hour is against, checked once.
   *
   * Both ids are validated through the owning module rather than by a foreign key, for the
   * reason `taskId` gives: Time may not depend on CRM. Passing both is refused here as well
   * as by the database, because the caller deserves a sentence rather than a constraint name.
   */
  private async resolveTarget(
    actor: Actor,
    projectId?: string | null,
    clientId?: string | null,
  ): Promise<{ projectId: string | null; clientId: string | null; name: string }> {
    if (projectId && clientId) {
      throw new BadRequestException(
        'An entry is against a project or a client, not both — the project already has one',
      );
    }
    if (projectId) {
      const project = await this.crm.getProject(actor, projectId);
      return { projectId, clientId: null, name: project.name };
    }
    if (clientId) {
      const client = await this.crm.getClient(actor, clientId);
      return { projectId: null, clientId, name: client.name };
    }
    // Internal: admin, bookkeeping, our own product. Nobody to bill and nothing to look up.
    return { projectId: null, clientId: null, name: 'Internal' };
  }

  private effectiveMinutes(row: {
    minutes: number | null;
    startedAt: Date | null;
    endedAt: Date | null;
  }): number {
    if (row.minutes != null) return row.minutes;
    if (row.startedAt && !row.endedAt) {
      return Math.max(0, Math.round((Date.now() - row.startedAt.getTime()) / 60_000));
    }
    return 0;
  }

  private decorate(row: typeof entries.$inferSelect) {
    const running = row.startedAt !== null && row.endedAt === null;
    return {
      ...row,
      running,
      effectiveMinutes: this.effectiveMinutes(row),
      billingStatus: billingStatus(row),
    };
  }

  /** Project names come from CRM's service — one call per distinct project. */
  /**
   * What to call a set of entries, whatever they are against.
   *
   * One helper because there are four places that render a list of hours and three shapes an
   * hour can have — and a name resolved four different ways is four chances for a project to
   * read as "(unavailable)" on one screen and fine on another.
   */
  private async labelsFor(
    actor: Actor,
    rows: Array<{ projectId: string | null; clientId: string | null }>,
  ) {
    const projects = await this.projectNames(
      actor,
      rows.map((r) => r.projectId).filter((id): id is string => id !== null),
    );
    const clients = await this.clientNames(
      actor,
      rows.map((r) => r.clientId).filter((id): id is string => id !== null),
    );

    return (row: { projectId: string | null; clientId: string | null }) => {
      if (row.projectId) {
        const p = projects.get(row.projectId);
        return {
          projectName: p?.name ?? '(unavailable)',
          clientName: p?.clientName ?? null,
          targetName: p?.name ?? '(unavailable)',
        };
      }
      if (row.clientId) {
        const name = clients.get(row.clientId) ?? '(unavailable)';
        return { projectName: null, clientName: name, targetName: name };
      }
      // Nothing to look up, and a name anyway — a blank cell reads as a bug.
      return { projectName: null, clientName: null, targetName: 'Internal' };
    };
  }

  private async clientNames(actor: Actor, clientIds: string[]) {
    const map = new Map<string, string>();
    await Promise.all(
      [...new Set(clientIds)].map(async (id) => {
        try {
          map.set(id, (await this.crm.getClient(actor, id)).name);
        } catch {
          /* unreadable for this actor — rendered as unavailable */
        }
      }),
    );
    return map;
  }

  private async projectNames(actor: Actor, projectIds: string[]) {
    const unique = [...new Set(projectIds)];
    const map = new Map<string, { name: string; clientName: string | null }>();
    await Promise.all(
      unique.map(async (id) => {
        try {
          const p = await this.crm.getProject(actor, id);
          const client = await this.crm.getClient(actor, p.clientId).catch(() => null);
          map.set(id, { name: p.name, clientName: client?.name ?? null });
        } catch {
          /* project unreadable for this actor — rendered as unavailable */
        }
      }),
    );
    return map;
  }

  private displayName(
    projectName: string,
    minutes: number | null,
    description: string | null | undefined,
    running: boolean,
  ): string {
    const prefix = running ? 'running' : `${((minutes ?? 0) / 60).toFixed(2)}h`;
    return description ? `${prefix} — ${description}` : `${prefix} on ${projectName}`;
  }

  private async rawEntry(id: string) {
    const [row] = await this.db.select().from(entries).where(eq(entries.id, id)).limit(1);
    if (!row) throw new NotFoundException('Time entry not found');
    return row;
  }

  private async runningEntry(personId: string) {
    const [row] = await this.db
      .select()
      .from(entries)
      .where(
        and(
          eq(entries.personId, personId),
          isNotNull(entries.startedAt),
          isNull(entries.endedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Validate a task reference through the registry rather than a foreign key — that is
   * what keeps Time independent of whichever module owns tasks.
   */
  private async resolveTask(taskId: string | null | undefined): Promise<string | null> {
    if (!taskId) return null;
    const ref = await this.registry.resolveOne(taskId);
    if (!ref || ref.entityType !== 'task') {
      throw new BadRequestException('That task does not exist');
    }
    return ref.id;
  }

  private async assertNoRunningEntry(personId: string): Promise<void> {
    if (await this.runningEntry(personId)) {
      throw new BadRequestException('A timer is already running — stop it first');
    }
  }

  private async entriesBetween(personId: string, from: string, to: string) {
    return this.db
      .select()
      .from(entries)
      .where(
        and(eq(entries.personId, personId), gte(entries.workedOn, from), lte(entries.workedOn, to)),
      )
      .orderBy(asc(entries.workedOn));
  }

  /**
   * Work out the stored duration. Start+end wins over a supplied duration, because the
   * clock times are the evidence — a mismatch between them is a bug, not a preference.
   */
  private resolveMinutes(
    minutes: number | null,
    startedAt: Date | null,
    endedAt: Date | null,
    opts: { allowNullWhenRunning?: boolean } = {},
  ): number | null {
    if (startedAt && endedAt) {
      if (endedAt <= startedAt) throw new BadRequestException('End time must be after start time');
      return this.validateMinutes(Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000));
    }
    if (startedAt && !endedAt) {
      // Running: duration is not known yet.
      if (minutes != null && !opts.allowNullWhenRunning) {
        throw new BadRequestException('A running entry cannot also have a fixed duration');
      }
      return null;
    }
    if (endedAt && !startedAt) throw new BadRequestException('An end time needs a start time');
    if (minutes == null) throw new BadRequestException('Give a duration, or a start time');
    return this.validateMinutes(minutes);
  }

  private validateMinutes(minutes: number): number {
    if (!Number.isInteger(minutes) || minutes <= 0) {
      throw new BadRequestException('Minutes must be a positive whole number');
    }
    if (minutes > 1440) throw new BadRequestException('A day has 1440 minutes');
    return minutes;
  }

  private validateDate(date: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
      throw new BadRequestException('Date must be ISO format (YYYY-MM-DD)');
    }
    return date;
  }

  private parseInstant(value: string): Date {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new BadRequestException(`Invalid time '${value}'`);
    return d;
  }

  private parseInstantOrNull(value: string | null | undefined): Date | null {
    return value ? this.parseInstant(value) : null;
  }

  private async require(actor: Actor, capability: string): Promise<void> {
    if (!(await this.permissions.can(actor, capability))) {
      throw new ForbiddenException(`Missing capability '${capability}'`);
    }
  }

  /**
   * Published reporting views (manifest contract).
   *
   * DROP then CREATE rather than CREATE OR REPLACE: the latter cannot change a view's
   * column names or order, so adding a column mid-list fails with "cannot change name
   * of view column" — at boot, which is where this was caught.
   */
  async ensureReportingViews(): Promise<void> {
    await this.db.execute(sql`DROP VIEW IF EXISTS time.v_entries CASCADE`);
    await this.db.execute(sql`DROP VIEW IF EXISTS time.v_weekly_totals CASCADE`);
    await this.db.execute(sql`
      CREATE VIEW time.v_entries AS
      SELECT e.id, e.person_id, e.project_id,
             -- Published so hours can be joined to the card they were spent on. The column has
             -- existed since the module shipped and the view never selected it, which meant no
             -- reporting query and no insight rule could compare an estimate to what it took.
             e.task_id, e.worked_on,
             e.started_at, e.ended_at, e.minutes, e.minutes / 60.0 AS hours,
             e.billable, e.description, e.invoice_id, e.invoiced_at, e.created_at,
             (e.started_at IS NOT NULL AND e.ended_at IS NULL) AS running
        FROM time.entries e
    `);
    await this.db.execute(sql`
      CREATE VIEW time.v_weekly_totals AS
      SELECT e.person_id,
             date_trunc('week', e.worked_on)::date AS week_of,
             SUM(COALESCE(e.minutes, 0)) AS total_minutes,
             SUM(COALESCE(e.minutes, 0)) FILTER (WHERE e.billable) AS billable_minutes,
             SUM(COALESCE(e.minutes, 0)) FILTER (WHERE e.billable AND e.invoiced_at IS NOT NULL)
               AS invoiced_minutes
        FROM time.entries e
       GROUP BY e.person_id, date_trunc('week', e.worked_on)
    `);
  }
}
