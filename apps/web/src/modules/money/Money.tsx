import { useEffect, useState } from 'react';
import { PageHeader } from '../../shell/ui/layout.js';
import { Card, Figure } from '../../shell/ui/card.js';
import { Split, Legend } from '../../shell/ui/viz.js';
import { SectionTabs } from '../../shell/useNav.js';
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

  const outstanding = overview?.outstanding?.totalCents ?? 0;
  const overdue = overview?.outstanding?.overdueCents ?? 0;
  /*
   * Outstanding split by whether it is late, from the two figures already fetched.
   *
   * "€487 outstanding" and "€0 overdue" as two tiles makes you do the subtraction to find the
   * only reading that matters — how much of what is owed has gone past its date. One bar says
   * it without arithmetic.
   */
  const current = Math.max(0, outstanding - overdue);
  const slices = [
    { label: 'Within terms', value: current, tone: 'var(--accent)' },
    { label: 'Overdue', value: overdue, tone: 'var(--danger)' },
  ];

  return (
    <>
      <PageHeader
        title="Money"
        subtitle="Invoicing, quotes, contracts and the numbers. Nothing here needs attention daily — when something does, it appears on Today."
        tabs={<SectionTabs section="money" />}
      />

      {error && <p className="error">{error}</p>}

      {/*
        Two figures, not five.

        The list of five links that used to be here said exactly what the tab strip above now
        says, in more words and further down the page — so a reader arriving at the hub read
        the same five names twice before finding a number.
      */}
      <Card span={7} to="/money/invoices" tone={overdue > 0 ? 'danger' : undefined}>
        <Figure
          label="Owed to us"
          value={euros(outstanding)}
          size="hero"
          note={overdue > 0 ? `${euros(overdue)} of it is past its date` : 'nothing has gone past its date'}
        />
        {outstanding > 0 && (
          <div className="card-fill">
            <Split slices={slices} />
            <Legend slices={slices} format={euros} />
          </div>
        )}
      </Card>

      <Card span={5} to="/reporting">
        <Figure
          label="Unbilled work"
          value={euros(overview?.unbilled?.totalValueCents)}
          note="Hours logged and billable that no invoice has picked up yet."
        />
      </Card>
    </>
  );
}
