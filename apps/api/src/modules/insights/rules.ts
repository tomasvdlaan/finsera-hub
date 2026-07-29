import { sql, type SQL } from 'drizzle-orm';

export interface Candidate {
  key: string;
  rule: string;
  subjectId: string | null;
  subjectType: string | null;
  severity: 'info' | 'attention' | 'urgent';
  title: string;
  detail: string | null;
  facts: Record<string, unknown>;
  magnitude: number;
}

export interface Rule {
  name: string;
  description: string;
  /**
   * Reads published views, and core.
   *
   * The contract was "published views only", the same one Reporting holds itself to, and
   * its purpose is that no rule may reach into another module's private tables. Core is
   * not another module — it is the dependency every module already has — and the
   * setup_incomplete rule below reads core.org_settings because the fact it states lives
   * nowhere else. Widened deliberately rather than worked around by publishing a view for
   * a single-row settings table.
   */
  query: SQL;
  toCandidate: (row: Record<string, unknown>) => Candidate;
}

const euro = (cents: number) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(cents / 100);

const n = (v: unknown) => Number(v ?? 0);
const s = (v: unknown) => (v == null ? null : String(v));

/**
 * The rules.
 *
 * Deterministic SQL over published views — no model involvement in deciding what deserves
 * attention. An LLM drafting the follow-up message is useful; an LLM deciding which
 * invoices are overdue is a worse version of a WHERE clause.
 *
 * Each rule states a fact and stops. None of them acts.
 */
export const RULES: Rule[] = [
  {
    name: 'invoice_overdue',
    description: 'An issued invoice is past its due date.',
    query: sql`
      SELECT i.id, i.number, i.total_cents, i.due_on, c.name AS client_name,
             (CURRENT_DATE - i.due_on)::int AS days_overdue
        FROM billing.v_invoices i
        LEFT JOIN crm.v_clients c ON c.id = i.client_id
       WHERE i.status = 'issued' AND i.overdue
    `,
    toCandidate: (r) => {
      const days = n(r.days_overdue);
      return {
        key: `invoice_overdue:${String(r.id)}`,
        rule: 'invoice_overdue',
        subjectId: String(r.id),
        subjectType: 'invoice',
        // A week late is a reminder; a month late is a problem.
        severity: days >= 30 ? 'urgent' : 'attention',
        title: `Invoice ${String(r.number)} is ${days} days overdue`,
        detail: `${euro(n(r.total_cents))} from ${s(r.client_name) ?? 'the client'}, due ${String(r.due_on)}.`,
        facts: {
          number: r.number,
          totalCents: n(r.total_cents),
          daysOverdue: days,
          clientName: r.client_name,
        },
        magnitude: n(r.total_cents),
      };
    },
  },

  {
    name: 'quote_unanswered',
    description: 'A sent quote has had no decision for 14 days.',
    query: sql`
      SELECT q.id, q.number, q.title, q.subtotal_cents, q.valid_until, c.name AS client_name,
             (CURRENT_DATE - q.issue_date)::int AS days_out,
             (q.valid_until < CURRENT_DATE) AS expired
        FROM sales.v_quotes q
        LEFT JOIN crm.v_clients c ON c.id = q.client_id
       WHERE q.status = 'sent' AND CURRENT_DATE - q.issue_date >= 14
    `,
    toCandidate: (r) => {
      const expired = Boolean(r.expired);
      return {
        key: `quote_unanswered:${String(r.id)}`,
        rule: 'quote_unanswered',
        subjectId: String(r.id),
        subjectType: 'quote',
        severity: expired ? 'urgent' : 'attention',
        title: expired
          ? `Quote ${String(r.number)} has passed its validity date`
          : `Quote ${String(r.number)} has been out ${n(r.days_out)} days`,
        detail: `${String(r.title)} — ${euro(n(r.subtotal_cents))} for ${s(r.client_name) ?? 'the client'}.`,
        facts: {
          number: r.number,
          daysOut: n(r.days_out),
          subtotalCents: n(r.subtotal_cents),
          validUntil: r.valid_until,
          clientName: r.client_name,
        },
        magnitude: n(r.subtotal_cents),
      };
    },
  },

  {
    name: 'contract_notice_closing',
    description: 'A contract rolls over unless notice is given within 45 days.',
    query: sql`
      SELECT c.id, c.title, c.ends_on, c.notice_days, c.auto_renews, cl.name AS client_name,
             (c.ends_on - c.notice_days) AS notice_deadline,
             (c.ends_on - c.notice_days - CURRENT_DATE)::int AS days_to_deadline
        FROM sales.v_contracts c
        LEFT JOIN crm.v_clients cl ON cl.id = c.client_id
       WHERE c.status = 'signed'
         AND c.ends_on IS NOT NULL AND c.notice_days IS NOT NULL
         AND c.ends_on - c.notice_days - CURRENT_DATE BETWEEN 0 AND 45
    `,
    toCandidate: (r) => {
      const days = n(r.days_to_deadline);
      return {
        key: `contract_notice_closing:${String(r.id)}`,
        rule: 'contract_notice_closing',
        subjectId: String(r.id),
        subjectType: 'contract',
        severity: days <= 14 ? 'urgent' : 'attention',
        title: `Notice on ${String(r.title)} must be given within ${days} days`,
        detail:
          String(r.auto_renews) === 'yes'
            ? `Rolls over automatically after ${String(r.notice_deadline)} unless notice is given.`
            : `The notice window closes ${String(r.notice_deadline)}.`,
        facts: {
          noticeDeadline: r.notice_deadline,
          endsOn: r.ends_on,
          daysToDeadline: days,
          clientName: r.client_name,
        },
        // Days remaining, inverted: the closer the deadline, the higher it ranks.
        magnitude: Math.max(0, 45 - days),
      };
    },
  },

  {
    name: 'budget_nearly_spent',
    description: 'Earned value has reached 80% of a project budget.',
    query: sql`
      SELECT p.id, p.name, p.budget_amount_cents, cl.name AS client_name,
             (COALESCE(SUM(e.minutes) FILTER (WHERE e.billable), 0)
               * COALESCE(p.default_rate_cents, 0) / 60)::bigint AS earned_cents
        FROM crm.v_projects p
        LEFT JOIN time.v_entries e ON e.project_id = p.id
        LEFT JOIN crm.v_clients cl ON cl.id = p.client_id
       WHERE p.budget_amount_cents IS NOT NULL AND p.budget_amount_cents > 0
       GROUP BY p.id, p.name, p.budget_amount_cents, p.default_rate_cents, cl.name
      HAVING (COALESCE(SUM(e.minutes) FILTER (WHERE e.billable), 0)
               * COALESCE(p.default_rate_cents, 0) / 60) >= p.budget_amount_cents * 0.8
    `,
    toCandidate: (r) => {
      const earned = n(r.earned_cents);
      const budget = n(r.budget_amount_cents);
      const pct = Math.round((earned / budget) * 100);
      return {
        key: `budget_nearly_spent:${String(r.id)}`,
        rule: 'budget_nearly_spent',
        subjectId: String(r.id),
        subjectType: 'project',
        severity: pct >= 100 ? 'urgent' : 'attention',
        title:
          pct >= 100
            ? `${String(r.name)} has used ${pct}% of its budget`
            : `${String(r.name)} is at ${pct}% of budget`,
        detail: `${euro(earned)} of ${euro(budget)} for ${s(r.client_name) ?? 'the client'}.`,
        facts: { earnedCents: earned, budgetCents: budget, pct, clientName: r.client_name },
        magnitude: earned,
      };
    },
  },

  {
    name: 'unbilled_work_ageing',
    description: 'Billable work has been sitting uninvoiced for over 30 days.',
    query: sql`
      SELECT p.id, p.name, cl.name AS client_name,
             SUM(e.minutes)::int AS minutes,
             (SUM(e.minutes) * COALESCE(p.default_rate_cents, 0) / 60)::bigint AS value_cents,
             (CURRENT_DATE - MIN(e.worked_on))::int AS oldest_days
        FROM time.v_entries e
        JOIN crm.v_projects p ON p.id = e.project_id
        LEFT JOIN crm.v_clients cl ON cl.id = p.client_id
       WHERE e.billable AND e.invoice_id IS NULL AND e.minutes IS NOT NULL
       GROUP BY p.id, p.name, p.default_rate_cents, cl.name
      HAVING CURRENT_DATE - MIN(e.worked_on) >= 30
    `,
    toCandidate: (r) => ({
      key: `unbilled_work_ageing:${String(r.id)}`,
      rule: 'unbilled_work_ageing',
      subjectId: String(r.id),
      subjectType: 'project',
      severity: n(r.oldest_days) >= 60 ? 'urgent' : 'attention',
      title: `${(n(r.minutes) / 60).toFixed(1)}h on ${String(r.name)} has not been invoiced`,
      detail: `${euro(n(r.value_cents))} of work, the oldest ${n(r.oldest_days)} days ago.`,
      facts: {
        minutes: n(r.minutes),
        valueCents: n(r.value_cents),
        oldestDays: n(r.oldest_days),
        clientName: r.client_name,
      },
      magnitude: n(r.value_cents),
    }),
  },

  {
    name: 'task_stalled',
    description: 'An in-progress task has not moved for 14 days.',
    query: sql`
      SELECT t.id, t.title, t.status, p.name AS project_name,
             (CURRENT_DATE - t.updated_at::date)::int AS days_still
        FROM scrum.v_tasks t
        LEFT JOIN crm.v_projects p ON p.id = t.project_id
       WHERE t.status IN ('in_progress', 'waiting_on_client')
         AND CURRENT_DATE - t.updated_at::date >= 14
    `,
    toCandidate: (r) => ({
      key: `task_stalled:${String(r.id)}`,
      rule: 'task_stalled',
      subjectId: String(r.id),
      subjectType: 'task',
      severity: 'info',
      title: `"${String(r.title)}" has not moved in ${n(r.days_still)} days`,
      detail:
        String(r.status) === 'waiting_on_client'
          ? `Still waiting on the client${r.project_name ? ` for ${String(r.project_name)}` : ''} — worth a nudge.`
          : `In progress${r.project_name ? ` on ${String(r.project_name)}` : ''} since then.`,
      facts: { status: r.status, daysStill: n(r.days_still), projectName: r.project_name },
      magnitude: n(r.days_still),
    }),
  },

  {
    name: 'quote_accepted_by_client',
    description: 'A client accepted a quote and the work has no project yet.',
    query: sql`
      SELECT q.id, q.number, q.title, q.subtotal_cents, q.decided_at, cl.name AS client_name,
             (CURRENT_DATE - q.decided_at::date)::int AS days_since
        FROM sales.v_quotes q
        LEFT JOIN crm.v_clients cl ON cl.id = q.client_id
       WHERE q.status = 'accepted'
         AND q.project_created_id IS NULL
    `,
    toCandidate: (r) => {
      const days = n(r.days_since);
      return {
        key: `quote_accepted_by_client:${String(r.id)}`,
        rule: 'quote_accepted_by_client',
        subjectId: String(r.id),
        subjectType: 'quote',
        // A client agreeing to spend money and nobody noticing is the kind of quiet that
        // gets expensive: the work is owed from the day they clicked, not from the day
        // somebody opened the portal to check.
        severity: days >= 3 ? 'urgent' : 'attention',
        title: `${s(r.client_name) ?? 'A client'} accepted quote ${String(r.number)}`,
        detail: `${String(r.title)} — ${euro(n(r.subtotal_cents))}. No project has been set up for the work${
          days > 0 ? `, ${days} day${days === 1 ? '' : 's'} on` : ''
        }.`,
        facts: {
          number: r.number,
          clientName: r.client_name,
          subtotalCents: n(r.subtotal_cents),
          decidedAt: r.decided_at,
          daysSince: days,
        },
        magnitude: n(r.subtotal_cents),
      };
    },
  },

  {
    name: 'setup_incomplete',
    description: 'The organisation cannot legally issue an invoice yet.',
    /*
     * The one rule that reads core rather than a published view: these fields live in
     * core.org_settings and nowhere else, and publishing a view over a single-row settings
     * table to satisfy a convention would be ceremony.
     *
     * It is also the only rule about us rather than about a client, which is why it says so
     * plainly — it currently surfaces on a settings page reachable through a link most
     * people never click, and the consequence of missing it is an invoice that is not valid.
     */
    query: sql`
      SELECT o.legal_name, o.kvk_number, o.vat_number, o.iban
        FROM core.org_settings o
       WHERE o.id = 1
         AND (o.legal_name = '' OR o.kvk_number = '' OR o.vat_number = '' OR o.iban = '')
    `,
    toCandidate: (r) => {
      const missing = [
        !String(r.legal_name ?? '') && 'legal name',
        !String(r.kvk_number ?? '') && 'KvK number',
        !String(r.vat_number ?? '') && 'VAT number',
        !String(r.iban ?? '') && 'IBAN',
      ].filter(Boolean) as string[];
      return {
        // Stable and singular: there is one organisation, so re-running must update this
        // row rather than accumulate one per run.
        key: 'setup_incomplete',
        rule: 'setup_incomplete',
        subjectId: null,
        subjectType: null,
        severity: 'urgent',
        title: 'Your invoices are missing legally required details',
        detail: `A Dutch invoice needs ${missing.join(', ')}. Until then, anything issued is not a valid invoice.`,
        facts: { missing },
        // Ranked above everything with a euro value: not being able to invoice at all
        // outranks any individual invoice.
        magnitude: Number.MAX_SAFE_INTEGER,
      };
    },
  },
];
