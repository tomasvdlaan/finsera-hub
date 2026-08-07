import { Card, Figure } from '../../shell/ui/card.js';
import { Skeleton } from '../../shell/ui/data.js';
import { Split, Legend, type Slice } from '../../shell/ui/viz.js';
import { useShared } from '../../lib/useShared.js';
import type { WidgetDef } from '../types.js';

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
};
