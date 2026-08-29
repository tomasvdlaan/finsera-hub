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
    /*
     * Replaces `task_stalled`, which keyed off `updated_at`.
     *
     * That is the signal `scrum.schema.ts` explicitly calls backwards: correcting a title
     * moves `updated_at`, so the card nobody has touched in a fortnight looked freshly worked
     * on, and the one somebody renamed looked busy. It was the wrong question asked of the
     * wrong column, and the transitions have known the right answer since they were added.
     *
     * Aging is measured from the first time work started, not from the last column change, so
     * a card bouncing between review and in progress cannot keep resetting its own clock.
     */
    name: 'task_aging_wip',
    description: 'A card has been in flight for a fortnight without finishing.',
    query: sql`
      SELECT f.task_id AS id, f.title, f.status, f.current_flow, f.has_history,
             (f.age_minutes / 1440)::int AS days_in_flight,
             p.name AS project_name
        FROM scrum.v_task_flow f
        LEFT JOIN crm.v_projects p ON p.id = f.project_id
       WHERE f.age_minutes IS NOT NULL
         AND f.age_minutes >= 14 * 1440
    `,
    toCandidate: (r) => ({
      key: `task_aging_wip:${String(r.id)}`,
      rule: 'task_aging_wip',
      subjectId: String(r.id),
      subjectType: 'task',
      // A fortnight is a nudge; a month is a decision about whether it is still happening.
      severity: n(r.days_in_flight) >= 30 ? 'urgent' : 'attention',
      title:
        `"${String(r.title)}" has been in flight ` +
        `${r.has_history ? '' : 'at most '}${n(r.days_in_flight)} days`,
      detail:
        String(r.current_flow) === 'waiting'
          ? `Waiting on the client${r.project_name ? ` for ${String(r.project_name)}` : ''} — worth a nudge.`
          : `Started that long ago${r.project_name ? ` on ${String(r.project_name)}` : ''} and not finished.`,
      facts: {
        status: r.status,
        daysInFlight: n(r.days_in_flight),
        measured: r.has_history,
        projectName: r.project_name,
      },
      magnitude: n(r.days_in_flight),
    }),
  },

  {
    /*
     * `due_on` has been published in `v_tasks` since the view existed and read by nothing.
     * The board draws an "overdue" chip from it client-side; nothing ever told you.
     */
    name: 'task_overdue',
    description: 'A task is past the date it was due.',
    query: sql`
      SELECT t.id, t.title, t.status, t.due_on,
             (CURRENT_DATE - t.due_on)::int AS days_over,
             p.name AS project_name
        FROM scrum.v_tasks t
        LEFT JOIN crm.v_projects p ON p.id = t.project_id
       WHERE t.due_on IS NOT NULL
         AND NOT t.completed
         AND t.due_on < CURRENT_DATE
    `,
    toCandidate: (r) => ({
      key: `task_overdue:${String(r.id)}`,
      rule: 'task_overdue',
      subjectId: String(r.id),
      subjectType: 'task',
      severity: n(r.days_over) >= 7 ? 'urgent' : 'attention',
      title: `"${String(r.title)}" was due ${n(r.days_over)} days ago`,
      detail: `${r.project_name ? `${String(r.project_name)} — ` : ''}still in ${String(
        r.status,
      ).replace(/_/g, ' ')}. Either it moves or the date does.`,
      facts: { status: r.status, dueOn: r.due_on, daysOver: n(r.days_over) },
      magnitude: n(r.days_over),
    }),
  },

  {
    /*
     * The first thing that has ever read `scrum.v_sprints`.
     *
     * The view has been created on every boot since the module shipped, declared in the
     * manifest, and queried by exactly one test. A sprint ending on Friday with a third of it
     * open is the single most useful thing a scrum master says out loud, and it is a WHERE
     * clause.
     */
    name: 'sprint_ending_soon_with_open_work',
    description: 'A sprint ends within two days with a good deal of it unfinished.',
    query: sql`
      SELECT s.id, s.name, s.ends_on, s.task_count, s.done_count,
             (s.ends_on - CURRENT_DATE)::int AS days_left,
             (s.task_count - s.done_count)::int AS open_count,
             p.name AS project_name
        FROM scrum.v_sprints s
        LEFT JOIN crm.v_projects p ON p.id = s.project_id
       WHERE s.state = 'active'
         AND s.ends_on - CURRENT_DATE BETWEEN 0 AND 2
         AND s.task_count > 0
         AND (s.task_count - s.done_count)::numeric / s.task_count > 0.3
    `,
    toCandidate: (r) => ({
      key: `sprint_ending:${String(r.id)}`,
      rule: 'sprint_ending_soon_with_open_work',
      subjectId: String(r.id),
      subjectType: 'sprint',
      // On the last day it is not advice any more.
      severity: n(r.days_left) === 0 ? 'urgent' : 'attention',
      title: `${String(r.name)} ends ${n(r.days_left) === 0 ? 'today' : `in ${n(r.days_left)} days`} with ${n(r.open_count)} open`,
      detail:
        `${n(r.done_count)} of ${n(r.task_count)} done` +
        `${r.project_name ? ` on ${String(r.project_name)}` : ''}. ` +
        'Decide now what carries over, rather than discovering it on Friday.',
      facts: {
        daysLeft: n(r.days_left),
        open: n(r.open_count),
        total: n(r.task_count),
        projectName: r.project_name,
      },
      // Days are small numbers next to euros, so this is scaled the way action items are.
      magnitude: n(r.open_count) * 100,
    }),
  },

  {
    /*
     * The charter's thesis as an insight.
     *
     * "Waiting on client" was made a default column because it is the state work spends most
     * time in and the one nobody records — which turns "we are blocked on them" from a feeling
     * into evidence when a deadline slips. Evidence nobody is shown is not evidence.
     */
    name: 'waiting_on_client_too_long',
    description: 'Work has sat with a client for over a week.',
    query: sql`
      SELECT f.task_id AS id, f.title,
             (f.age_minutes / 1440)::int AS days_waiting,
             p.name AS project_name, cl.name AS client_name
        FROM scrum.v_task_flow f
        LEFT JOIN crm.v_projects p ON p.id = f.project_id
        LEFT JOIN crm.v_clients cl ON cl.id = p.client_id
       WHERE f.current_flow = 'waiting'
         AND f.age_minutes IS NOT NULL
         AND f.age_minutes >= 7 * 1440
    `,
    toCandidate: (r) => ({
      key: `waiting_client:${String(r.id)}`,
      rule: 'waiting_on_client_too_long',
      subjectId: String(r.id),
      subjectType: 'task',
      severity: n(r.days_waiting) >= 21 ? 'urgent' : 'attention',
      title: `${r.client_name ? String(r.client_name) : 'A client'} has had "${String(r.title)}" for ${n(r.days_waiting)} days`,
      detail: `${r.project_name ? `${String(r.project_name)} — ` : ''}nothing here is yours to move, but a fortnight of silence is worth a nudge.`,
      facts: {
        daysWaiting: n(r.days_waiting),
        clientName: r.client_name,
        projectName: r.project_name,
      },
      magnitude: n(r.days_waiting),
    }),
  },

  {
    name: 'task_blocked',
    description: 'A task is blocked and nobody has cleared it.',
    query: sql`
      SELECT t.id, t.title, t.status, t.days_blocked, p.name AS project_name
        FROM scrum.v_tasks t
        LEFT JOIN crm.v_projects p ON p.id = t.project_id
       WHERE t.blocked
         AND NOT t.completed
         AND t.days_blocked >= 3
    `,
    toCandidate: (r) => ({
      key: `task_blocked:${String(r.id)}`,
      rule: 'task_blocked',
      subjectId: String(r.id),
      subjectType: 'task',
      /*
       * Three days before it is worth mentioning, a week before it is worth interrupting for.
       *
       * A blocker is different in kind from a stalled task: `task_stalled` infers that nothing
       * has happened, which might mean the work was quietly dropped, while this one is a thing
       * somebody wrote down as being in the way. Somebody already knows what needs to happen,
       * which is exactly why it is embarrassing for it to sit for a week.
       */
      severity: n(r.days_blocked) >= 7 ? 'urgent' : 'attention',
      title: `"${String(r.title)}" has been blocked for ${n(r.days_blocked)} days`,
      detail: `${r.project_name ? `${String(r.project_name)} — ` : ''}still in ${String(
        r.status,
      ).replace(/_/g, ' ')}. Whatever it is waiting on has not moved.`,
      facts: {
        status: r.status,
        daysBlocked: n(r.days_blocked),
        projectName: r.project_name,
      },
      magnitude: n(r.days_blocked),
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

  {
    name: 'action_item_undecided',
    description: 'A meeting produced action points that were never accepted or dismissed.',
    /*
     * The gap between "we agreed to do this" and "it is on the board".
     *
     * meetings.action_items only becomes a task when accepted — nothing reaches the board
     * without a decision, which is right — but nothing ever noticed the decision going
     * unmade. A commitment made out loud in a client call and then silently dropped is worse
     * than one never made, and it was invisible to every surface in the platform.
     */
    query: sql`
      SELECT n.id, n.title, n.meeting_date, cl.name AS client_name,
             count(a.id)::int AS undecided,
             (CURRENT_DATE - n.meeting_date)::int AS days_since
        FROM meetings.action_items a
        JOIN meetings.v_notes n ON n.id = a.note_id
        LEFT JOIN crm.v_clients cl ON cl.id = n.client_id
       WHERE a.status = 'proposed'
         AND CURRENT_DATE - n.meeting_date >= 3
         -- Not one that a later meeting already picked up. Carrying it forward IS the decision
         -- being made; nagging about the ancestor as well would report one commitment as two.
         AND NOT EXISTS (
               SELECT 1 FROM meetings.action_items later WHERE later.carried_from = a.id
             )
       GROUP BY n.id, n.title, n.meeting_date, cl.name
    `,
    toCandidate: (r) => {
      const days = n(r.days_since);
      return {
        key: `action_item_undecided:${String(r.id)}`,
        rule: 'action_item_undecided',
        subjectId: String(r.id),
        subjectType: 'meeting',
        severity: days >= 14 ? 'urgent' : 'attention',
        title: `${n(r.undecided)} action point${n(r.undecided) === 1 ? '' : 's'} from "${String(r.title)}" undecided`,
        detail: `${s(r.client_name) ?? 'Internal'} meeting ${days} days ago. Accept them onto the board or dismiss them.`,
        facts: {
          undecided: n(r.undecided),
          daysSince: days,
          clientName: r.client_name,
          meetingDate: r.meeting_date,
        },
        // Ranked by how long a commitment has been sitting undecided, not by money — this
        // rule has none, and ranking it at zero would bury it under every invoice.
        magnitude: days * 100,
      };
    },
  },
];
