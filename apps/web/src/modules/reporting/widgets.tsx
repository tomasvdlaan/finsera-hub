import { Card, Figure } from '../../shell/ui/card.js';
import { Skeleton } from '../../shell/ui/data.js';
import { Split, Legend, Buckets, Bullet, Funnel, Timeline, type Slice } from '../../shell/ui/viz.js';
import { useShared } from '../../lib/useShared.js';
import { Empty } from '../../shell/ui/primitives.js';
import type { WidgetDef } from '../types.js';

interface Receivables {
  aging: Record<'current' | 'd1to30' | 'd31to60' | 'd60plus', { cents: number; count: number }>;
  byClient: Array<{ client: string; invoices: number; avgDaysLate: number }>;
}

/** Exactly what `/reporting/project-profitability` returns — read, not guessed. */
interface Project {
  projectId: string;
  projectName: string;
  clientName: string | null;
  earnedCents: number;
  budgetAmountCents: number | null;
}

const days = (n: number) => `${n > 0 ? '+' : ''}${n}d`;

interface Overview {
  outstanding?: { totalCents?: number; overdueCents?: number };
  unbilled?: { totalValueCents?: number };
}

const euros = (cents = 0) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(
    cents / 100,
  );

export const reportingWidgets: Record<string, WidgetDef> = {
  'reporting:owed': {
    title: 'Owed to us',
    description: 'Invoiced and not yet paid, split by whether it has gone past its date.',
    slot: 'dashboard',
    defaultSpan: 6,
    minSpan: 4,
    permission: 'reporting.read',
    Component: () => {
      const { data, loading } = useShared<Overview>('/reporting/overview');
      const total = data?.outstanding?.totalCents ?? 0;
      const late = data?.outstanding?.overdueCents ?? 0;
      const slices: Slice[] = [
        { label: 'Within terms', value: Math.max(0, total - late), tone: 'var(--accent)' },
        { label: 'Overdue', value: late, tone: 'var(--danger)' },
      ];
      return (
        <Card to="/money/invoices" tone={late > 0 ? 'danger' : undefined}>
          {loading ? (
            <Skeleton height="3rem" />
          ) : (
            <>
              <Figure
                label="Owed to us"
                value={euros(total)}
                note={late > 0 ? `${euros(late)} of it is past its date` : 'nothing has gone past its date'}
              />
              {/* The split says the thing two separate tiles made you subtract. */}
              {total > 0 && (
                <div className="card-fill">
                  <Split slices={slices} />
                  <Legend slices={slices} format={euros} />
                </div>
              )}
            </>
          )}
        </Card>
      );
    },
  },

  'reporting:unbilled': {
    title: 'Unbilled work',
    description: 'Hours logged and billable that no invoice has picked up yet.',
    slot: 'dashboard',
    defaultSpan: 3,
    minSpan: 3,
    permission: 'reporting.read',
    Component: () => {
      const { data, loading } = useShared<Overview>('/reporting/overview');
      return (
        <Card to="/reporting">
          {loading ? (
            <Skeleton height="3rem" />
          ) : (
            <Figure
              label="Unbilled work"
              value={euros(data?.unbilled?.totalValueCents)}
              note="logged, billable, not yet invoiced"
            />
          )}
        </Card>
      );
    },
  },

  /* ── Financial consultant ─────────────────────────────────────────────── */

  'reporting:ar-aging': {
    title: 'Receivables, by age',
    description: 'What is owed, sorted by how long it has been owed. The bucket on the right is the one that phones people.',
    slot: 'dashboard',
    defaultSpan: 6,
    minSpan: 4,
    permission: 'reporting.read',
    Component: () => {
      const { data, loading } = useShared<Receivables>('/reporting/receivables');
      const a = data?.aging;
      const bins = [
        { label: 'Not yet due', value: a?.current.cents ?? 0, tone: 'var(--accent)' },
        { label: '1–30 days', value: a?.d1to30.cents ?? 0, tone: 'var(--info)' },
        { label: '31–60', value: a?.d31to60.cents ?? 0, tone: 'var(--warning)' },
        { label: 'Over 60', value: a?.d60plus.cents ?? 0, tone: 'var(--danger)' },
      ];
      const late = bins.slice(1).reduce((n, b) => n + b.value, 0);
      const owed = bins.reduce((n, b) => n + b.value, 0);
      return (
        <Card
          title="Receivables, by age"
          sub={loading || owed === 0 ? undefined : late > 0 ? `${euros(late)} of it is past due` : 'nothing is past due'}
          tone={(a?.d60plus.cents ?? 0) > 0 ? 'danger' : undefined}
          to="/money/invoices"
        >
          {loading ? (
            <Skeleton height="6rem" />
          ) : owed === 0 ? (
            /*
              Four zero bars and "nothing is past due" is technically true and reads as a
              broken widget. Nothing is owed because nothing has been issued — a draft is not
              a receivable — and saying which of those two it is takes one sentence.
            */
            <Empty>Nothing is owed. Drafts do not count until they are issued.</Empty>
          ) : (
            <div className="card-fill">
              <Buckets bins={bins} format={euros} />
            </div>
          )}
        </Card>
      );
    },
  },

  'reporting:who-pays-late': {
    title: 'Who pays late',
    description: 'Average days past the due date, per client — measured against their own terms, not against the calendar.',
    slot: 'dashboard',
    defaultSpan: 6,
    minSpan: 4,
    permission: 'reporting.read',
    Component: () => {
      const { data, loading } = useShared<Receivables>('/reporting/receivables');
      const rows = data?.byClient ?? [];
      return (
        <Card
          title="Who pays late"
          sub="Days past the due date, averaged. Negative is early."
          to="/money/invoices"
        >
          {loading ? (
            <Skeleton height="4rem" />
          ) : rows.length === 0 ? (
            <Empty>No invoice has been paid yet, so there is nothing to average.</Empty>
          ) : (
            <ul className="pay-rank">
              {rows.map((r) => (
                <li key={r.client} data-late={r.avgDaysLate > 0 || undefined}>
                  <span>{r.client}</span>
                  <b>{days(r.avgDaysLate)}</b>
                  <small>{r.invoices} paid</small>
                </li>
              ))}
            </ul>
          )}
        </Card>
      );
    },
  },

  'reporting:budget-burn': {
    title: 'Every budget at once',
    description: 'Spend against budget for all projects, on one scale. A project with no budget says so rather than showing a bar.',
    slot: 'dashboard',
    defaultSpan: 6,
    minSpan: 4,
    permission: 'reporting.read',
    Component: () => {
      const { data, loading } = useShared<Project[]>('/reporting/project-profitability');
      const rows = (data ?? []).map((p) => ({
        label: p.projectName,
        value: p.earnedCents,
        of: p.budgetAmountCents,
        note: p.clientName ?? undefined,
      }));
      return (
        <Card title="Every budget at once" sub={`${rows.length} projects`} to="/reporting">
          {loading ? <Skeleton height="5rem" /> : <Bullet rows={rows} format={euros} />}
        </Card>
      );
    },
  },

  /* ── Business owner ───────────────────────────────────────────────────── */

  'reporting:pipeline-funnel': {
    title: 'Pipeline, stage by stage',
    description: 'Quoted, sent, accepted — and what fell out between them.',
    slot: 'dashboard',
    defaultSpan: 6,
    minSpan: 4,
    permission: 'reporting.read',
    Component: () => {
      const { data, loading } = useShared<{
        byStatus: Record<string, { count: number; exVatCents: number } | undefined>;
      }>('/reporting/pipeline');
      const at = (key: string) => data?.byStatus?.[key];
      const stages = [
        { label: 'Drafted', key: 'draft' },
        { label: 'Sent', key: 'sent' },
        { label: 'Accepted', key: 'accepted' },
      ].map((st) => ({
        label: st.label,
        value: Number(at(st.key)?.exVatCents ?? 0),
        count: at(st.key)?.count ?? 0,
      }));
      return (
        <Card title="Pipeline, stage by stage" to="/money/quotes">
          {loading ? <Skeleton height="6rem" /> : <Funnel stages={stages} format={euros} />}
        </Card>
      );
    },
  },

  'reporting:client-concentration': {
    title: 'How much rides on one client',
    description: 'Revenue share per client. The number a consultancy should look at before it feels the problem.',
    slot: 'dashboard',
    defaultSpan: 6,
    minSpan: 4,
    permission: 'reporting.read',
    Component: () => {
      const { data, loading } = useShared<{
        // The row is passed through from the view, so the keys stay snake_case — only
        // ex_vat_cents is converted from the bigint string Postgres returns.
        byClient?: Array<{ client_name: string; ex_vat_cents: number }>;
      }>('/reporting/revenue?period=year');
      const rows = (data?.byClient ?? []).slice(0, 6);
      const total = rows.reduce((n, r) => n + Number(r.ex_vat_cents ?? 0), 0);
      const biggest = rows[0];
      const share = total > 0 && biggest ? Math.round((Number(biggest.ex_vat_cents) / total) * 100) : 0;
      const slices: Slice[] = rows.map((r, i) => ({
        label: r.client_name,
        value: Number(r.ex_vat_cents ?? 0),
        // One accent, stepped down. Six named hues would need a legend to decode and would
        // spend every colour the rest of the palette is using to mean something.
        tone: `color-mix(in srgb, var(--accent) ${Math.max(20, 100 - i * 16)}%, var(--surface-sunken))`,
      }));
      return (
        <Card
          title="How much rides on one client"
          sub={biggest ? `${biggest.client_name} is ${share}% of the year` : undefined}
          // Above about half the year from one client, losing them is not a bad quarter.
          tone={share >= 50 ? 'warning' : undefined}
          to="/reporting"
        >
          {loading ? (
            <Skeleton height="4rem" />
          ) : rows.length === 0 ? (
            <Empty>No invoiced revenue this year yet.</Empty>
          ) : (
            <div className="card-fill">
              <Split slices={slices} />
              <Legend slices={slices} format={euros} />
            </div>
          )}
        </Card>
      );
    },
  },

  'reporting:whats-ending': {
    title: 'What is ending',
    description: 'Contracts and projects reaching their end date in the next quarter, on a scale — three in one week is a different problem from three in a quarter.',
    slot: 'dashboard',
    defaultSpan: 6,
    minSpan: 4,
    permission: 'reporting.read',
    Component: () => {
      const { data, loading } = useShared<
        Array<{ id: string; title: string; endsOn: string; clientName: string | null; daysUntilEnd: number }>
      >('/reporting/renewals');
      const rows = data ?? [];
      return (
        <Card
          title="What is ending"
          sub={loading ? undefined : `${rows.length} in the next 90 days`}
          to="/money/contracts"
        >
          {loading ? (
            <Skeleton height="4rem" />
          ) : (
            <>
              <Timeline
                events={rows.map((r) => ({ date: r.endsOn, label: r.title, tone: 'var(--warning)' }))}
                days={90}
              />
              <ul className="ending-list">
                {rows.slice(0, 4).map((r) => (
                  <li key={r.id}>
                    <span>
                      {r.title}
                      {r.clientName && <span className="muted"> · {r.clientName}</span>}
                    </span>
                    <small>{r.daysUntilEnd}d</small>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      );
    },
  },
};
