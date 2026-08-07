import { useEffect, useState } from 'react';
import { PageHeader } from '../../shell/ui/layout.js';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { InsightRow, type Insight } from '../insights/Insights.js';

const money = (cents: number) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(cents / 100);

const hours = (minutes: number) => `${(minutes / 60).toFixed(1)}h`;

interface Overview {
  revenueYear: { totalExVatCents: number; byMonth: Array<{ month: string; exVatCents: number }> };
  revenueMonth: { totalExVatCents: number };
  outstanding: {
    totalCents: number;
    currentCents: number;
    overdueCents: number;
    overdueCount: number;
  };
  unbilled: {
    totalMinutes: number;
    totalValueCents: number;
    byProject: Array<{
      projectId: string;
      projectName: string;
      clientName: string | null;
      minutes: number;
      valueCents: number;
    }>;
  };
  utilisation: { totalMinutes: number; billableMinutes: number; billableRatio: number | null };
  pipeline: {
    outstandingValueCents: number;
    wonValueCents: number;
    conversionRate: number | null;
    byStatus: Record<string, { count: number; exVatCents: number }>;
  };
  renewals: Array<{
    id: string;
    title: string;
    clientName: string | null;
    endsOn: string;
    daysUntilEnd: number;
    noticeDeadline: string | null;
  }>;
}

/** A number with its meaning, which is the whole point of a dashboard. */
function Stat({
  label,
  value,
  hint,
  urgent,
  to,
}: {
  label: string;
  value: string;
  hint?: string;
  urgent?: boolean;
  to?: string;
}) {
  const body = (
    <>
      <div className="muted" style={{ fontSize: '0.85rem' }}>
        {label}
      </div>
      <div className={`stat-value${urgent ? ' urgent' : ''}`}>{value}</div>
      {hint && (
        <div className="muted" style={{ fontSize: '0.8rem' }}>
          {hint}
        </div>
      )}
    </>
  );
  return <div className="stat">{to ? <Link to={to}>{body}</Link> : body}</div>;
}

interface InsightSummary {
  total: number;
  urgent: number;
  top: Insight[];
}

export function Overview() {
  const [data, setData] = useState<Overview | null>(null);
  const [insights, setInsights] = useState<InsightSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Overview>('/reporting/overview')
      .then(setData)
      .catch((e: Error) => setError(e.message));
    // Insights are a separate call on purpose: a slow rule sweep must not delay the
    // numbers, and a broken one must not blank the page.
    api
      .get<InsightSummary>('/insights/summary')
      .then(setInsights)
      .catch(() => setInsights(null));
  }, []);

  if (!data) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;

  const { revenueYear, revenueMonth, outstanding, unbilled, utilisation, pipeline, renewals } = data;
  const peakMonth = Math.max(1, ...revenueYear.byMonth.map((m) => m.exVatCents));

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Every number here is read from what the modules publish — nothing is recalculated, so this cannot disagree with the invoice or timesheet behind it."
      />

      {insights && insights.total > 0 && (
        <section>
          <h2>
            Needs attention{' '}
            <span className="badge">{insights.total}</span>
          </h2>
          <ul className="insights">
            {insights.top.map((insight) => (
              <InsightRow key={insight.id} insight={insight} />
            ))}
          </ul>
          {insights.total > insights.top.length && (
            <p className="muted">
              <Link to="/insights">see all {insights.total}</Link>
            </p>
          )}
        </section>
      )}

      <section>
        <h2>Money</h2>
        <div className="stats">
          <Stat
            label="Invoiced this year"
            value={money(revenueYear.totalExVatCents)}
            hint="excluding VAT"
          />
          <Stat label="Invoiced this month" value={money(revenueMonth.totalExVatCents)} />
          <Stat
            label="Outstanding"
            value={money(outstanding.totalCents)}
            hint={
              outstanding.overdueCents > 0
                ? `${money(outstanding.overdueCents)} overdue across ${outstanding.overdueCount}`
                : 'none overdue'
            }
            urgent={outstanding.overdueCents > 0}
            to="/billing"
          />
          <Stat
            label="Not yet invoiced"
            value={money(unbilled.totalValueCents)}
            hint={`${hours(unbilled.totalMinutes)} of billable work in hand`}
            to="/billing"
          />
        </div>
      </section>

      {revenueYear.byMonth.length > 0 && (
        <section>
          <h2>Revenue by month</h2>
          <div className="grid-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Month</th>
                  <th style={{ textAlign: 'left', width: '60%' }}>Invoiced (ex VAT)</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {revenueYear.byMonth.map((m) => (
                  <tr key={m.month}>
                    <td style={{ textAlign: 'left' }}>{m.month}</td>
                    <td style={{ textAlign: 'left' }}>
                      {/* An inline bar, not a charting dependency — enough to see shape. */}
                      <span
                        className="bar"
                        style={{ width: `${Math.max(2, (m.exVatCents / peakMonth) * 100)}%` }}
                      />
                    </td>
                    <td>{money(m.exVatCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2>Delivery</h2>
        <div className="stats">
          <Stat
            label="Billable share this month"
            value={
              utilisation.billableRatio == null
                ? '—'
                : `${Math.round(utilisation.billableRatio * 100)}%`
            }
            hint={
              utilisation.totalMinutes === 0
                ? 'nothing logged yet'
                : `${hours(utilisation.billableMinutes)} of ${hours(utilisation.totalMinutes)}`
            }
            to="/time"
          />
          <Stat
            label="Quotes out"
            value={money(pipeline.outstandingValueCents)}
            hint={`${pipeline.byStatus.sent?.count ?? 0} awaiting a decision`}
            to="/sales"
          />
          <Stat
            label="Won"
            value={money(pipeline.wonValueCents)}
            hint={
              pipeline.conversionRate == null
                ? 'nothing decided yet'
                : `${Math.round(pipeline.conversionRate * 100)}% of decided quotes`
            }
          />
        </div>
      </section>

      {unbilled.byProject.length > 0 && (
        <section>
          <h2>Work in hand</h2>
          <ul className="cards">
            {unbilled.byProject.map((p) => (
              <li key={p.projectId}>
                <Link to={`/crm/projects/${p.projectId}`}>{p.projectName}</Link>{' '}
                <span className="muted">
                  {p.clientName ?? '—'} · {hours(p.minutes)} · {money(p.valueCents)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {renewals.length > 0 && (
        <section>
          <h2>Contracts needing attention</h2>
          <ul className="cards">
            {renewals.map((c) => (
              <li key={c.id}>
                <Link to={`/sales/contracts/${c.id}`}>{c.title}</Link>{' '}
                <span className="badge">{c.daysUntilEnd} days</span>
                <span className="muted">
                  {c.clientName ?? '—'} · ends {c.endsOn}
                  {c.noticeDeadline && ` · notice by ${c.noticeDeadline}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
