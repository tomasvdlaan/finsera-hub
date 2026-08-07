import { useEffect, useState } from 'react';
import { PageHeader } from '../../shell/ui/layout.js';
import { SectionTabs } from '../../shell/useNav.js';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useDocumentTitle } from '../../shell/useDocumentTitle.js';

interface Overview {
  outstanding?: { totalCents?: number; overdueCents?: number };
  unbilled?: { totalValueCents?: number };
}

const euros = (cents = 0) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
    .format(cents / 100);

/**
 * One door for the four finance pages that used to hold four rail slots.
 *
 * None of them moved: /billing, /sales, /sales/contracts and /reporting resolve exactly as
 * before, every bookmark and every assistant citation still lands, and `GET /core/navigation`
 * still reports them — they are marked `hidden`, which keeps them out of the rail and nowhere
 * else. Demoted, not removed.
 *
 * The numbers here are a summary, not a dashboard. Everything on this page is already computed
 * by an insight rule that runs every six hours, so anything genuinely wrong reaches you on
 * Today whether or not you ever open this.
 */
export function Money() {
  useDocumentTitle('Money');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    api
      .get<Overview>('/reporting/overview')
      .then(setOverview)
      .catch((e: Error) => setError(e.message));
  }, []);

  const overdue = overview?.outstanding?.overdueCents ?? 0;

  return (
    <>
      <PageHeader
        title="Money"
        subtitle="Invoicing, quotes, contracts and the numbers. Nothing here needs attention daily — when something does, it appears on Today."
        tabs={<SectionTabs section="money" />}
      />

      {error && <p className="error">{error}</p>}

      <div className="stat-row">
        <div className="stat">
          <Link to="/money/invoices">
            <div className="muted">Outstanding</div>
            <div className="stat-value">{euros(overview?.outstanding?.totalCents)}</div>
          </Link>
        </div>
        <div className="stat">
          <Link to="/money/invoices">
            <div className="muted">Overdue</div>
            <div className={`stat-value${overdue > 0 ? ' urgent' : ''}`}>{euros(overdue)}</div>
          </Link>
        </div>
        <div className="stat">
          <Link to="/reporting">
            <div className="muted">Unbilled work</div>
            <div className="stat-value">{euros(overview?.unbilled?.totalValueCents)}</div>
          </Link>
        </div>
      </div>

      <section>
        <h2>Where things are</h2>
        <table>
          <tbody>
            <tr>
              <td><Link to="/money/invoices">Invoices</Link></td>
              <td className="muted">Drafts, issued, paid — and the billing run</td>
            </tr>
            <tr>
              <td><Link to="/money/quotes">Quotes</Link></td>
              <td className="muted">Out for decision, accepted, rejected</td>
            </tr>
            <tr>
              <td><Link to="/money/contracts">Contracts</Link></td>
              <td className="muted">Signed terms, end dates and notice deadlines</td>
            </tr>
            <tr>
              <td><Link to="/reporting">Numbers</Link></td>
              <td className="muted">Revenue, utilisation, pipeline, profitability</td>
            </tr>
            <tr>
              <td><Link to="/money/rate-cards">Rate cards</Link></td>
              <td className="muted">What an hour costs, and since when</td>
            </tr>
          </tbody>
        </table>
      </section>
    </>
  );
}
