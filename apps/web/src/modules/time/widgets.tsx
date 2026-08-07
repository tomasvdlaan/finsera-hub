import { Card, Figure } from '../../shell/ui/card.js';
import { Skeleton } from '../../shell/ui/data.js';
import { Rhythm, Meter, Heatmap, Bullet, Split, Legend, type Slice } from '../../shell/ui/viz.js';
import { useShared } from '../../lib/useShared.js';
import { Empty } from '../../shell/ui/primitives.js';
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
    entityTypes: ['project'],
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

  /* ── The team manager ─────────────────────────────────────────────────── */

  'time:where-it-went': {
    title: 'Where the week went',
    description: 'Hours split by project, biggest first — the answer to "what did we actually spend the week on".',
    slot: 'dashboard',
    defaultSpan: 4,
    minSpan: 3,
    permission: 'time.read',
    Component: () => {
      const { data, loading } = useShared<{ days: Array<{ date: string; entries?: Array<{ projectName?: string; effectiveMinutes: number }> }> }>(
        '/time/recent',
      );
      const byProject = new Map<string, number>();
      for (const d of data?.days ?? []) {
        for (const e of d.entries ?? []) {
          const key = e.projectName ?? 'No project';
          byProject.set(key, (byProject.get(key) ?? 0) + (e.effectiveMinutes ?? 0));
        }
      }
      const rows = [...byProject.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
      const slices: Slice[] = rows.map(([label, minutes], i) => ({
        label,
        value: minutes,
        tone: `color-mix(in srgb, var(--accent) ${Math.max(22, 100 - i * 16)}%, var(--surface-sunken))`,
      }));
      return (
        <Card title="Where the week went" sub={`${rows.length} projects`} to="/time/week">
          {loading ? (
            <Skeleton height="4rem" />
          ) : rows.length === 0 ? (
            <Empty>No hours logged in the last fortnight.</Empty>
          ) : (
            <div className="card-fill">
              <Split slices={slices} />
              <Legend slices={slices} format={(m) => hours(m)} />
            </div>
          )}
        </Card>
      );
    },
  },

  'time:calendar-heat': {
    title: 'Working pattern',
    description: 'A quarter of days as a grid. Every Monday in one column, so a habit shows up as a stripe and a holiday as a gap.',
    slot: 'dashboard',
    defaultSpan: 4,
    minSpan: 3,
    permission: 'time.read',
    Component: () => {
      const { data, loading } = useShared<{ days: Day[] }>('/time/recent');
      /*
       * Aligned to weeks, not to the fetch.
       *
       * The grid only means anything if column position is the week and row position is the
       * weekday — a grid filled in fetch order puts Mondays wherever they land and the stripe
       * that carries the whole reading disappears.
       */
      const span = 63;
      const cells = fill(data?.days ?? [], span);
      const first = new Date(cells[0]?.date ?? Date.now()).getDay();
      // Monday-first, and pad the leading days so the first column starts on a Monday.
      const lead = (first + 6) % 7;
      const padded = [
        ...Array.from({ length: lead }, (_, i) => ({ date: `pad-${i}`, value: 0 })),
        ...cells,
      ];
      const worked = cells.filter((c) => c.value > 0).length;
      return (
        <Card title="Working pattern" sub={`${worked} of ${span} days had an hour on them`} to="/time">
          {loading ? (
            <Skeleton height="5rem" />
          ) : (
            <div className="card-fill">
              <Heatmap
                cells={padded}
                weeks={Math.ceil(padded.length / 7)}
                format={(v) => `${v.toFixed(1).replace('.', ',')} h`}
              />
            </div>
          )}
        </Card>
      );
    },
  },

  'time:untracked': {
    title: 'Hours with nowhere to go',
    description: 'Logged time carrying no task, which is the gap between a timesheet that adds up and one that can be invoiced.',
    slot: 'dashboard',
    defaultSpan: 3,
    minSpan: 3,
    permission: 'time.read',
    Component: () => {
      const { data, loading } = useShared<{ days: Array<{ entries?: Array<{ taskId: string | null; effectiveMinutes: number; billable: boolean }> }> }>(
        '/time/recent',
      );
      const all = (data?.days ?? []).flatMap((d) => d.entries ?? []);
      const loose = all.filter((e) => !e.taskId && e.billable);
      const minutes = loose.reduce((n, e) => n + (e.effectiveMinutes ?? 0), 0);
      return (
        <Card tone={loose.length > 0 ? 'warning' : undefined} to="/time">
          {loading ? (
            <Skeleton height="3rem" />
          ) : (
            <Figure
              label="Billable, no task"
              value={hours(minutes)}
              note={
                loose.length === 0
                  ? 'every billable hour is against a card'
                  : `${loose.length} ${loose.length === 1 ? 'entry' : 'entries'} nothing can be billed from`
              }
            />
          )}
        </Card>
      );
    },
  },

  'time:person-load': {
    title: 'Load per person',
    description: 'Hours each person has logged this fortnight. No capacity bar unless a capacity was actually entered.',
    slot: 'dashboard',
    defaultSpan: 6,
    minSpan: 4,
    permission: 'time.read',
    Component: () => {
      const { data, loading } = useShared<{ days: Array<{ entries?: Array<{ personName?: string; effectiveMinutes: number }> }> }>(
        '/time/recent',
      );
      const byPerson = new Map<string, number>();
      for (const d of data?.days ?? []) {
        for (const e of d.entries ?? []) {
          const key = e.personName ?? 'You';
          byPerson.set(key, (byPerson.get(key) ?? 0) + (e.effectiveMinutes ?? 0));
        }
      }
      const rows = [...byPerson.entries()]
        .sort((a, b) => b[1] - a[1])
        // `of: null` on purpose. A capacity nobody entered is not forty hours a week, and a
        // bar against an invented denominator looks authoritative and is fiction.
        .map(([label, minutes]) => ({ label, value: minutes, of: null }));
      return (
        <Card title="Load per person" sub="last fortnight" to="/time/week">
          {loading ? (
            <Skeleton height="4rem" />
          ) : rows.length === 0 ? (
            <Empty>Nobody has logged an hour in the last fortnight.</Empty>
          ) : (
            <Bullet rows={rows} format={hours} />
          )}
        </Card>
      );
    },
  },
};
