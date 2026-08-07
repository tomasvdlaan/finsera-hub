import { Card, Figure } from '../../shell/ui/card.js';
import { Skeleton } from '../../shell/ui/data.js';
import { Rhythm, Meter } from '../../shell/ui/viz.js';
import { useShared } from '../../lib/useShared.js';
import type { SettingDef, WidgetDef } from '../types.js';

interface Day {
  date: string;
  totalMinutes: number;
}

const hours = (minutes = 0) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;

/**
 * How far back a rhythm looks.
 *
 * A count rather than free text, and capped at a quarter: past about ninety bars each one is
 * under three pixels wide and the chart has stopped being readable in the way that matters.
 */
const DAYS: SettingDef = { key: 'days', label: 'Days to show', type: 'count', min: 7, max: 90, default: 14 };

/**
 * Fill in the days nothing was logged.
 *
 * `/time/recent` returns only days that have an entry, so plotting it directly draws a solid
 * run of bars and says the opposite of the truth. The gaps are the finding — a fortnight where
 * two days carry everything is the shape that predicts a month-end scramble.
 */
function fill(days: Day[], count: number) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (count - 1 - i));
    const date = d.toISOString().slice(0, 10);
    return { date, value: (days.find((r) => r.date === date)?.totalMinutes ?? 0) / 60 };
  });
}

export const timeWidgets: Record<string, WidgetDef> = {
  'time:logged-today': {
    title: 'Logged today',
    description: 'Hours written down so far today.',
    slot: 'dashboard',
    defaultSpan: 3,
    minSpan: 3,
    permission: 'time.read',
    Component: () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data, loading } = useShared<{ entries: Array<{ effectiveMinutes: number }> }>(
        `/time/day?date=${today}`,
      );
      const total = (data?.entries ?? []).reduce((n, e) => n + (e.effectiveMinutes ?? 0), 0);
      return (
        <Card to="/time">
          {loading ? (
            <Skeleton height="3rem" />
          ) : (
            <Figure label="Logged today" value={hours(total)} note={total === 0 ? 'nothing yet' : undefined} />
          )}
        </Card>
      );
    },
  },

  'time:fortnight': {
    title: 'Your rhythm',
    description: 'Hours per day, including the days with none — which is the part worth seeing.',
    slot: 'dashboard',
    defaultSpan: 6,
    minSpan: 4,
    permission: 'time.read',
    settings: [DAYS],
    Component: ({ settings }) => {
      const count = Math.max(7, Math.min(90, Number(settings.days) || 14));
      const { data, loading } = useShared<{ days: Day[] }>('/time/recent');
      const days = fill(data?.days ?? [], count);
      const total = days.reduce((n, d) => n + d.value, 0);
      const worked = days.filter((d) => d.value > 0).length;
      return (
        <Card
          title="Your rhythm"
          sub={`${total.toFixed(1).replace('.', ',')} h over ${worked} of ${count} days`}
          to="/time"
        >
          <div className="card-fill">{loading ? <Skeleton height="5rem" /> : <Rhythm days={days} />}</div>
        </Card>
      );
    },
  },

  /** Contributed to CRM's project page — declared in the manifest since the module was written. */
  'time:project-burn': {
    title: 'Budget burn',
    description: 'Hours spent against the hours sold, for one project.',
    slot: 'entity-page',
    defaultSpan: 6,
    permission: 'time.read',
    Component: ({ entityId }) => {
      const { data, loading } = useShared<{ spentMinutes: number; budgetMinutes: number | null }>(
        entityId ? `/time/projects/${entityId}/burn` : null,
      );
      const spent = data?.spentMinutes ?? 0;
      const budget = data?.budgetMinutes ?? null;
      return (
        <Card title="Budget burn" to="/time">
          {loading ? (
            <Skeleton height="3rem" />
          ) : (
            <>
              <Figure
                label="Spent"
                value={hours(spent)}
                note={budget ? `of ${hours(budget)} sold` : 'no budget set on this project'}
              />
              {/*
                No bar without a denominator.

                A budget nobody has entered is not a budget of zero and it is not one of forty
                hours a week. A bar drawn against an invented target looks authoritative and is
                fiction, which is worse than the absence it papers over.
              */}
              {budget !== null && (
                <div className="card-fill">
                  <Meter
                    value={spent}
                    of={budget}
                    tone={spent > budget ? 'var(--danger)' : 'var(--accent)'}
                  />
                </div>
              )}
            </>
          )}
        </Card>
      );
    },
  },
};
