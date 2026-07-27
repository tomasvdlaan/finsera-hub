import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { and, asc, eq, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { DB, type Database } from '../../core/db/db.module.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { CrmService } from '../crm/crm.service.js';
import { entries } from './time.schema.js';

export interface LogHoursInput {
  projectId: string;
  workedOn: string; // ISO date
  minutes: number;
  description?: string | null;
  billable?: boolean;
  personId?: string; // defaults to the actor; only 'manage' may log for others
}

export interface ProjectBurn {
  projectId: string;
  projectName: string;
  billingModel: string;
  currency: string;
  budgetedHours: number | null;
  loggedHours: number;
  billableHours: number;
  budgetAmountCents: number | null;
  burnedAmountCents: number | null;
}

/** Monday of the week containing `date`. Weeks start Monday (Dutch/EU convention). */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Time Registration (Phase 2 brief).
 *
 * This is the first module that depends on another: budget burn needs CRM's project
 * data. It calls CrmService — never crm.projects — which is what keeps both modules
 * replaceable (Master §10). The dependency runs one way only: Time → CRM.
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

  // ── logging ────────────────────────────────────────────────

  async logHours(actor: Actor, input: LogHoursInput, origin: { aiInitiated?: boolean } = {}) {
    await this.require(actor, 'time.entries.write_own');

    const personId = input.personId ?? actor.userId;
    if (personId !== actor.userId) {
      // Logging on someone else's behalf is a separate, rarer capability.
      await this.require(actor, 'time.entries.manage');
    }

    const minutes = this.validateMinutes(input.minutes);
    const workedOn = this.validateDate(input.workedOn);
    await this.assertWeekOpen(personId, workedOn);

    // Cross-module call: the project must exist and be visible to this actor.
    const project = await this.crm.getProject(actor, input.projectId);

    const id = this.registry.newId();
    await this.db.transaction(async (tx) => {
      await this.registry.register(tx, {
        id,
        entityType: 'time_entry',
        displayName: `${(minutes / 60).toFixed(2)}h on ${project.name}`,
        urlPath: `/time/entries/${id}`,
      });

      await tx.insert(entries).values({
        id,
        personId,
        projectId: input.projectId,
        workedOn,
        minutes,
        billable: input.billable ?? this.defaultBillable(project.billingModel),
        description: input.description ?? null,
      });

      // Mirror the structural ref so hours show on the project's timeline (Master §8.3).
      await this.links.createWithin(tx, actor, {
        fromId: id,
        toId: input.projectId,
        kind: 'logged_against',
      });

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'time_entry.create',
        entityType: 'time_entry',
        entityId: id,
        detail: { projectId: input.projectId, workedOn, minutes },
        aiInitiated: origin.aiInitiated ?? false,
      });

      await this.events.publish(tx, {
        name: 'time_entry.created',
        entityType: 'time_entry',
        entityId: id,
        actorId: actor.userId,
        payload: { projectId: input.projectId, minutes, workedOn },
      });
    });

    return { id, minutes };
  }

  /**
   * Set the minutes for a person+project+day in one call — the shape the week grid needs.
   * Zero deletes the entry, so clearing a cell is the same gesture as typing over it.
   */
  async setCell(
    actor: Actor,
    input: { projectId: string; workedOn: string; minutes: number; personId?: string },
  ) {
    await this.require(actor, 'time.entries.write_own');
    const personId = input.personId ?? actor.userId;
    if (personId !== actor.userId) await this.require(actor, 'time.entries.manage');

    const workedOn = this.validateDate(input.workedOn);
    await this.assertWeekOpen(personId, workedOn);

    const existing = await this.db
      .select()
      .from(entries)
      .where(
        and(
          eq(entries.personId, personId),
          eq(entries.projectId, input.projectId),
          eq(entries.workedOn, workedOn),
        ),
      )
      .limit(1);

    const current = existing[0];

    if (input.minutes <= 0) {
      if (current) await this.deleteEntry(actor, current.id);
      return { minutes: 0 };
    }

    const minutes = this.validateMinutes(input.minutes);
    if (!current) {
      await this.logHours(actor, { projectId: input.projectId, workedOn, minutes, personId });
      return { minutes };
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(entries)
        .set({ minutes, updatedAt: new Date() })
        .where(eq(entries.id, current.id));
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'time_entry.update',
        entityType: 'time_entry',
        entityId: current.id,
        detail: { from: current.minutes, to: minutes },
      });
    });
    return { minutes };
  }

  async deleteEntry(actor: Actor, id: string) {
    await this.require(actor, 'time.entries.write_own');
    const [row] = await this.db.select().from(entries).where(eq(entries.id, id)).limit(1);
    if (!row) throw new NotFoundException('Time entry not found');
    if (row.personId !== actor.userId) await this.require(actor, 'time.entries.manage');
    if (row.submittedAt) throw new BadRequestException('That week is submitted — reopen it first');

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

  // ── the week view ──────────────────────────────────────────

  /**
   * A week of one person's hours, shaped for the grid: rows are projects, cells are
   * minutes per day. Projects logged in the *previous* week are included as empty rows,
   * because most weeks repeat and pre-listed rows are what make entry fast.
   */
  async getWeek(actor: Actor, opts: { weekOf?: string; personId?: string } = {}) {
    await this.require(actor, 'time.entries.write_own');
    const personId = opts.personId ?? actor.userId;
    if (personId !== actor.userId) await this.require(actor, 'time.entries.read_all');

    const monday = weekStart(opts.weekOf ?? new Date().toISOString().slice(0, 10));
    const sunday = addDays(monday, 6);
    const prevMonday = addDays(monday, -7);

    const [thisWeek, lastWeek] = await Promise.all([
      this.entriesBetween(personId, monday, sunday),
      this.entriesBetween(personId, prevMonday, addDays(prevMonday, 6)),
    ]);

    const projectIds = [
      ...new Set([...thisWeek, ...lastWeek].map((e) => e.projectId)),
    ];

    // Names come from CRM's service, not its tables.
    const projects = await Promise.all(
      projectIds.map(async (id) => {
        try {
          const p = await this.crm.getProject(actor, id);
          return { id, name: p.name, clientId: p.clientId };
        } catch {
          return { id, name: '(unavailable)', clientId: null };
        }
      }),
    );

    const rows = projects.map((p) => ({
      ...p,
      days: Object.fromEntries(
        Array.from({ length: 7 }, (_, i) => {
          const day = addDays(monday, i);
          const entry = thisWeek.find((e) => e.projectId === p.id && e.workedOn === day);
          return [day, entry ? entry.minutes : 0];
        }),
      ),
    }));

    const submitted = thisWeek.length > 0 && thisWeek.every((e) => e.submittedAt !== null);

    return {
      weekOf: monday,
      days: Array.from({ length: 7 }, (_, i) => addDays(monday, i)),
      rows,
      totalMinutes: thisWeek.reduce((sum, e) => sum + e.minutes, 0),
      billableMinutes: thisWeek.filter((e) => e.billable).reduce((s, e) => s + e.minutes, 0),
      submitted,
    };
  }

  // ── submission ─────────────────────────────────────────────

  async submitWeek(actor: Actor, weekOf: string, personId?: string) {
    await this.require(actor, 'time.entries.write_own');
    const person = personId ?? actor.userId;
    if (person !== actor.userId) await this.require(actor, 'time.entries.manage');

    const monday = weekStart(this.validateDate(weekOf));
    const week = await this.entriesBetween(person, monday, addDays(monday, 6));
    if (week.length === 0) throw new BadRequestException('Nothing to submit for that week');

    await this.db.transaction(async (tx) => {
      await tx
        .update(entries)
        .set({ submittedAt: new Date() })
        .where(
          and(
            eq(entries.personId, person),
            gte(entries.workedOn, monday),
            lte(entries.workedOn, addDays(monday, 6)),
            isNull(entries.submittedAt),
          ),
        );

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'timesheet.submit',
        entityType: 'time_entry',
        entityId: week[0]!.id,
        detail: { weekOf: monday, personId: person, entries: week.length },
      });

      // Invoicing (Phase 5c) keys off this event.
      await this.events.publish(tx, {
        name: 'timesheet.submitted',
        entityType: 'time_entry',
        entityId: week[0]!.id,
        actorId: actor.userId,
        payload: {
          weekOf: monday,
          personId: person,
          totalMinutes: week.reduce((s, e) => s + e.minutes, 0),
        },
      });
    });

    return { weekOf: monday, submitted: true };
  }

  /** Real timesheets get corrected; a lock that cannot be undone just stops people submitting. */
  async reopenWeek(actor: Actor, weekOf: string, personId?: string) {
    await this.require(actor, 'time.entries.manage');
    const person = personId ?? actor.userId;
    const monday = weekStart(this.validateDate(weekOf));

    await this.db.transaction(async (tx) => {
      await tx
        .update(entries)
        .set({ submittedAt: null })
        .where(
          and(
            eq(entries.personId, person),
            gte(entries.workedOn, monday),
            lte(entries.workedOn, addDays(monday, 6)),
            isNotNull(entries.submittedAt),
          ),
        );
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'timesheet.reopen',
        entityType: 'time_entry',
        entityId: this.registry.newId(),
        detail: { weekOf: monday, personId: person },
      });
    });

    return { weekOf: monday, submitted: false };
  }

  async unsubmittedWeeks(actor: Actor) {
    await this.require(actor, 'time.entries.write_own');
    const rows = await this.db
      .select({ workedOn: entries.workedOn, minutes: entries.minutes })
      .from(entries)
      .where(and(eq(entries.personId, actor.userId), isNull(entries.submittedAt)))
      .orderBy(asc(entries.workedOn));

    const byWeek = new Map<string, number>();
    for (const r of rows) {
      const wk = weekStart(r.workedOn);
      byWeek.set(wk, (byWeek.get(wk) ?? 0) + r.minutes);
    }
    return {
      weeks: [...byWeek.entries()].map(([weekOf, minutes]) => ({
        weekOf,
        hours: +(minutes / 60).toFixed(2),
      })),
    };
  }

  // ── budget burn: the cross-module read ─────────────────────

  async projectBurn(actor: Actor, projectId: string): Promise<ProjectBurn> {
    await this.require(actor, 'time.entries.read_all');
    const project = await this.crm.getProject(actor, projectId); // service, not schema

    const [totals] = await this.db
      .select({
        total: sql<number>`COALESCE(SUM(${entries.minutes}), 0)`,
        billable: sql<number>`COALESCE(SUM(${entries.minutes}) FILTER (WHERE ${entries.billable}), 0)`,
      })
      .from(entries)
      .where(eq(entries.projectId, projectId));

    const loggedMinutes = Number(totals?.total ?? 0);
    const billableMinutes = Number(totals?.billable ?? 0);

    return {
      projectId,
      projectName: project.name,
      billingModel: project.billingModel,
      currency: project.currency,
      budgetedHours: project.budgetHours ? Number(project.budgetHours) : null,
      loggedHours: +(loggedMinutes / 60).toFixed(2),
      billableHours: +(billableMinutes / 60).toFixed(2),
      budgetAmountCents: project.budgetAmountCents,
      // Only meaningful when a rate is known; fixed fee burns against the agreed price.
      burnedAmountCents:
        project.defaultRateCents != null
          ? Math.round((billableMinutes / 60) * project.defaultRateCents)
          : null,
    };
  }

  // ── internals ──────────────────────────────────────────────

  private async entriesBetween(personId: string, from: string, to: string) {
    return this.db
      .select()
      .from(entries)
      .where(
        and(
          eq(entries.personId, personId),
          gte(entries.workedOn, from),
          lte(entries.workedOn, to),
        ),
      )
      .orderBy(asc(entries.workedOn));
  }

  private async assertWeekOpen(personId: string, workedOn: string): Promise<void> {
    const monday = weekStart(workedOn);
    const [locked] = await this.db
      .select({ id: entries.id })
      .from(entries)
      .where(
        and(
          eq(entries.personId, personId),
          gte(entries.workedOn, monday),
          lte(entries.workedOn, addDays(monday, 6)),
          isNotNull(entries.submittedAt),
        ),
      )
      .limit(1);
    if (locked) throw new BadRequestException('That week is submitted — reopen it first');
  }

  /**
   * Client work is billable by default regardless of billing model — retainer hours are
   * still delivery, they are just invoiced differently. Internal work is marked
   * non-billable per entry, since the module cannot tell which projects are internal.
   */
  private defaultBillable(_billingModel: string): boolean {
    return true;
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

  private async require(actor: Actor, capability: string): Promise<void> {
    if (!(await this.permissions.can(actor, capability))) {
      throw new ForbiddenException(`Missing capability '${capability}'`);
    }
  }

  async ensureReportingViews(): Promise<void> {
    await this.db.execute(sql`
      CREATE OR REPLACE VIEW time.v_entries AS
      SELECT e.id, e.person_id, e.project_id, e.worked_on, e.minutes,
             e.minutes / 60.0 AS hours, e.billable, e.submitted_at, e.created_at
        FROM time.entries e
    `);
    await this.db.execute(sql`
      CREATE OR REPLACE VIEW time.v_weekly_totals AS
      SELECT e.person_id,
             date_trunc('week', e.worked_on)::date AS week_of,
             SUM(e.minutes) AS total_minutes,
             SUM(e.minutes) FILTER (WHERE e.billable) AS billable_minutes,
             bool_and(e.submitted_at IS NOT NULL) AS submitted
        FROM time.entries e
       GROUP BY e.person_id, date_trunc('week', e.worked_on)
    `);
  }
}
