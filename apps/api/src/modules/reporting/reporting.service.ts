import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { sql } from 'drizzle-orm';
import { DB, type Database } from '../../core/db/db.module.js';
import { PermissionService } from '../../core/permissions/permission.service.js';

export interface Period {
  /** Inclusive. */
  from: string;
  /** EXCLUSIVE, so month boundaries cannot double-count a day. */
  to: string;
}

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** This month, as an inclusive-from / exclusive-to pair. */
export function currentMonth(now = new Date()): Period {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function currentYear(now = new Date()): Period {
  return {
    from: `${now.getUTCFullYear()}-01-01`,
    to: `${now.getUTCFullYear() + 1}-01-01`,
  };
}

/**
 * Reporting (Phase 6a).
 *
 * Reads the `v_*` views every module publishes, and nothing else. It never touches a base
 * table and never re-derives a number a module already computes — the fastest way to make
 * a system disagree with itself about revenue is to calculate it twice.
 *
 * Pure consumer: no writes, no events, no schema of its own.
 */
@Injectable()
export class ReportingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReportingService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly permissions: PermissionService,
  ) {}

  /**
   * Re-grant the read-only role after boot.
   *
   * Runs on application bootstrap, which is after every module has created its views.
   * It has to run every time: ensureReportingViews() drops and recreates each view, and
   * dropping a view drops its grants — so a grant applied once in a migration would be
   * quietly gone after the next restart.
   *
   * Grants cover every published v_* view and nothing else. Views are the contract each
   * module chose to publish, so this stays correct as modules are added, and a base
   * table can never be reached by accident.
   */
  async onApplicationBootstrap(): Promise<void> {
    const exists = await this.db.execute(
      sql`SELECT 1 FROM pg_roles WHERE rolname = 'platform_readonly'`,
    );
    if (exists.rows.length === 0) return; // role not provisioned here; nothing to grant

    const views = await this.db.execute(sql`
      SELECT table_schema, table_name
        FROM information_schema.views
       WHERE table_name LIKE 'v\_%'
         AND table_schema NOT IN ('pg_catalog', 'information_schema')
    `);

    for (const row of views.rows as Array<{ table_schema: string; table_name: string }>) {
      await this.db.execute(
        sql.raw(
          `GRANT SELECT ON "${row.table_schema}"."${row.table_name}" TO platform_readonly`,
        ),
      );
      await this.db.execute(
        sql.raw(`GRANT USAGE ON SCHEMA "${row.table_schema}" TO platform_readonly`),
      );
    }
    this.logger.log(`Reporting: granted platform_readonly SELECT on ${views.rows.length} views.`);
  }

  /**
   * Invoiced revenue in a period, by month and by client.
   *
   * Counts ISSUED invoices by issue date — including credit notes, which are negative, so
   * a credited month reads correctly rather than optimistically. Drafts are excluded:
   * nothing has been asked for yet.
   */
  async revenue(actor: Actor, period: Period) {
    await this.require(actor, 'reporting.read');
    const { from, to } = this.validate(period);

    const byMonth = await this.db.execute(sql`
      SELECT to_char(date_trunc('month', issue_date), 'YYYY-MM') AS month,
             SUM(subtotal_cents)::bigint AS ex_vat_cents,
             SUM(total_cents)::bigint    AS inc_vat_cents,
             COUNT(*)::int               AS invoices
        FROM billing.v_invoices
       WHERE status IN ('issued','paid')
         AND issue_date >= ${from} AND issue_date < ${to}
       GROUP BY 1 ORDER BY 1
    `);

    const byClient = await this.db.execute(sql`
      SELECT i.client_id, c.name AS client_name,
             SUM(i.subtotal_cents)::bigint AS ex_vat_cents,
             COUNT(*)::int                 AS invoices
        FROM billing.v_invoices i
        LEFT JOIN crm.v_clients c ON c.id = i.client_id
       WHERE i.status IN ('issued','paid')
         AND i.issue_date >= ${from} AND i.issue_date < ${to}
       GROUP BY 1, 2 ORDER BY 3 DESC
    `);

    const rows = byMonth.rows as Array<{ ex_vat_cents: string; inc_vat_cents: string }>;
    return {
      period: { from, to },
      totalExVatCents: rows.reduce((s, r) => s + Number(r.ex_vat_cents), 0),
      totalIncVatCents: rows.reduce((s, r) => s + Number(r.inc_vat_cents), 0),
      byMonth: byMonth.rows.map((r) => this.numbers(r, ['ex_vat_cents', 'inc_vat_cents'])),
      byClient: byClient.rows.map((r) => this.numbers(r, ['ex_vat_cents'])),
    };
  }

  /** What is owed, and how much of it is late. `overdue` comes from the view, not from here. */
  async outstanding(actor: Actor) {
    await this.require(actor, 'reporting.read');
    const result = await this.db.execute(sql`
      SELECT COALESCE(SUM(total_cents) FILTER (WHERE NOT overdue), 0)::bigint AS current_cents,
             COALESCE(SUM(total_cents) FILTER (WHERE overdue), 0)::bigint     AS overdue_cents,
             COUNT(*) FILTER (WHERE NOT overdue)::int                         AS current_count,
             COUNT(*) FILTER (WHERE overdue)::int                             AS overdue_count
        FROM billing.v_invoices
       WHERE status = 'issued'
    `);
    const row = (result.rows[0] ?? {}) as Record<string, string | number>;
    const currentCents = Number(row.current_cents ?? 0);
    const overdueCents = Number(row.overdue_cents ?? 0);
    return {
      currentCents,
      overdueCents,
      totalCents: currentCents + overdueCents,
      currentCount: Number(row.current_count ?? 0),
      overdueCount: Number(row.overdue_count ?? 0),
    };
  }

  /**
   * Work done but not charged for — the number nothing showed until now.
   *
   * Values hours at the project's current rate. That is an estimate, not a receivable:
   * the rate could change before it is invoiced, which is exactly why it is reported
   * separately from revenue rather than added to it.
   */
  async unbilled(actor: Actor) {
    await this.require(actor, 'reporting.read');
    const result = await this.db.execute(sql`
      SELECT p.id AS project_id, p.name AS project_name, c.name AS client_name,
             SUM(e.minutes)::int AS minutes,
             p.default_rate_cents,
             (SUM(e.minutes) * COALESCE(p.default_rate_cents, 0) / 60)::bigint AS value_cents
        FROM time.v_entries e
        JOIN crm.v_projects p ON p.id = e.project_id
        LEFT JOIN crm.v_clients c ON c.id = p.client_id
       WHERE e.billable AND e.invoice_id IS NULL AND e.minutes IS NOT NULL
       GROUP BY p.id, p.name, c.name, p.default_rate_cents
       ORDER BY value_cents DESC
    `);
    const byProject = (result.rows as Array<Record<string, string | number | null>>).map((r) => ({
      projectId: String(r.project_id),
      projectName: String(r.project_name),
      clientName: r.client_name == null ? null : String(r.client_name),
      minutes: Number(r.minutes ?? 0),
      defaultRateCents: r.default_rate_cents == null ? null : Number(r.default_rate_cents),
      valueCents: Number(r.value_cents ?? 0),
    }));
    return {
      totalMinutes: byProject.reduce((sum, r) => sum + r.minutes, 0),
      totalValueCents: byProject.reduce((sum, r) => sum + r.valueCents, 0),
      byProject,
    };
  }

  /** How much logged time is billable. A ratio, not a judgement about a good week. */
  async utilisation(actor: Actor, period: Period) {
    await this.require(actor, 'reporting.read');
    const { from, to } = this.validate(period);
    const result = await this.db.execute(sql`
      SELECT COALESCE(SUM(minutes), 0)::int                                AS total_minutes,
             COALESCE(SUM(minutes) FILTER (WHERE billable), 0)::int        AS billable_minutes,
             COALESCE(SUM(minutes) FILTER (WHERE invoiced_at IS NOT NULL), 0)::int AS invoiced_minutes
        FROM time.v_entries
       WHERE worked_on >= ${from} AND worked_on < ${to} AND minutes IS NOT NULL
    `);
    const row = (result.rows[0] ?? {}) as Record<string, number>;
    const total = Number(row.total_minutes ?? 0);
    const billable = Number(row.billable_minutes ?? 0);
    return {
      period: { from, to },
      totalMinutes: total,
      billableMinutes: billable,
      invoicedMinutes: Number(row.invoiced_minutes ?? 0),
      /** Null rather than zero when nothing was logged: no ratio exists. */
      billableRatio: total > 0 ? Math.round((billable / total) * 100) / 100 : null,
    };
  }

  /** Hours and value per project against its budget. */
  async projectProfitability(actor: Actor) {
    await this.require(actor, 'reporting.read');
    const result = await this.db.execute(sql`
      SELECT p.id AS project_id, p.name AS project_name, c.name AS client_name,
             p.budget_amount_cents, p.default_rate_cents,
             COALESCE(SUM(e.minutes), 0)::int AS minutes,
             COALESCE(SUM(e.minutes) FILTER (WHERE e.billable), 0)::int AS billable_minutes,
             (COALESCE(SUM(e.minutes) FILTER (WHERE e.billable), 0)
               * COALESCE(p.default_rate_cents, 0) / 60)::bigint AS earned_cents
        FROM crm.v_projects p
        LEFT JOIN time.v_entries e ON e.project_id = p.id
        LEFT JOIN crm.v_clients c ON c.id = p.client_id
       GROUP BY p.id, p.name, c.name, p.budget_amount_cents, p.default_rate_cents
       HAVING COALESCE(SUM(e.minutes), 0) > 0
       ORDER BY earned_cents DESC
    `);
    return (result.rows as Array<Record<string, string | number | null>>).map((r) => {
      const earnedCents = Number(r.earned_cents ?? 0);
      const budgetAmountCents = r.budget_amount_cents == null ? null : Number(r.budget_amount_cents);
      return {
        projectId: String(r.project_id),
        projectName: String(r.project_name),
        clientName: r.client_name == null ? null : String(r.client_name),
        minutes: Number(r.minutes ?? 0),
        billableMinutes: Number(r.billable_minutes ?? 0),
        earnedCents,
        budgetAmountCents,
        defaultRateCents: r.default_rate_cents == null ? null : Number(r.default_rate_cents),
        budgetUsedPct:
          budgetAmountCents && budgetAmountCents > 0
            ? Math.round((earnedCents / budgetAmountCents) * 100)
            : null,
      };
    });
  }

  /** Quotes out, won and lost, with the conversion rate. */
  async pipeline(actor: Actor, period?: Period) {
    await this.require(actor, 'reporting.read');
    const p = period ? this.validate(period) : null;
    const window = p
      ? sql`AND created_at >= ${p.from} AND created_at < ${p.to}`
      : sql``;

    const result = await this.db.execute(sql`
      SELECT status,
             COUNT(*)::int                 AS count,
             SUM(subtotal_cents)::bigint   AS ex_vat_cents
        FROM sales.v_quotes
       WHERE TRUE ${window}
       GROUP BY status
    `);

    const byStatus = Object.fromEntries(
      (result.rows as Array<{ status: string; count: number; ex_vat_cents: string }>).map((r) => [
        r.status,
        { count: Number(r.count), exVatCents: Number(r.ex_vat_cents ?? 0) },
      ]),
    );
    const accepted = byStatus.accepted?.count ?? 0;
    const rejected = byStatus.rejected?.count ?? 0;
    const decided = accepted + rejected;

    return {
      period: p,
      byStatus,
      outstandingValueCents: byStatus.sent?.exVatCents ?? 0,
      wonValueCents: byStatus.accepted?.exVatCents ?? 0,
      /** Null until something has actually been decided — 0% would be a lie. */
      conversionRate: decided > 0 ? Math.round((accepted / decided) * 100) / 100 : null,
    };
  }

  /** Contracts ending or needing notice within the window. */
  async renewals(actor: Actor, withinDays = 90) {
    await this.require(actor, 'reporting.read');
    const result = await this.db.execute(sql`
      SELECT c.id, c.title, c.type, c.ends_on, c.notice_days, c.auto_renews,
             cl.name AS client_name,
             (c.ends_on - CURRENT_DATE)::int AS days_until_end,
             (c.ends_on - c.notice_days)     AS notice_deadline
        FROM sales.v_contracts c
        LEFT JOIN crm.v_clients cl ON cl.id = c.client_id
       WHERE c.status = 'signed' AND c.ends_on IS NOT NULL
         AND c.ends_on - CURRENT_DATE <= ${withinDays}
       ORDER BY c.ends_on
    `);
    return (result.rows as Array<Record<string, string | number | null>>).map((r) => ({
      id: String(r.id),
      title: String(r.title),
      type: String(r.type),
      clientName: r.client_name == null ? null : String(r.client_name),
      endsOn: String(r.ends_on),
      noticeDays: r.notice_days == null ? null : Number(r.notice_days),
      autoRenews: String(r.auto_renews),
      daysUntilEnd: Number(r.days_until_end ?? 0),
      noticeDeadline: r.notice_deadline == null ? null : String(r.notice_deadline),
    }));
  }

  /** Everything the overview page shows, in one round trip. */
  async overview(actor: Actor) {
    const month = currentMonth();
    const year = currentYear();
    const [revenueYear, revenueMonth, outstanding, unbilled, utilisation, pipeline, renewals] =
      await Promise.all([
        this.revenue(actor, year),
        this.revenue(actor, month),
        this.outstanding(actor),
        this.unbilled(actor),
        this.utilisation(actor, month),
        this.pipeline(actor),
        this.renewals(actor, 90),
      ]);
    return {
      revenueYear,
      revenueMonth,
      outstanding,
      unbilled,
      utilisation,
      pipeline,
      renewals,
    };
  }

  // ── internals ──────────────────────────────────────────────

  private validate(period: Period): Period {
    if (!isDate(period.from) || !isDate(period.to)) {
      throw new BadRequestException('Dates must be YYYY-MM-DD');
    }
    if (period.to <= period.from) {
      throw new BadRequestException('The end of a period must fall after its start');
    }
    return period;
  }

  /**
   * Postgres returns bigint as a string to avoid losing precision in JS. Cents fit
   * comfortably in a JS number, so they are converted here — once, at the boundary —
   * and keys are camelCased for the client.
   */
  private numbers(row: Record<string, unknown>, bigintKeys: string[]) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      out[camel] = bigintKeys.includes(key) && value != null ? Number(value) : value;
    }
    return out;
  }

  private async require(actor: Actor, capability: string): Promise<void> {
    if (!(await this.permissions.can(actor, capability))) {
      throw new BadRequestException(`Missing capability ${capability}`);
    }
  }
}
