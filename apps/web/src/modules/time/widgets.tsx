import { Card, Figure } from '../../shell/ui/card.js';
import { Skeleton } from '../../shell/ui/data.js';
import { Rhythm, Meter, Heatmap, Bullet, Split, Legend, type Slice } from '../../shell/ui/viz.js';
import { useShared } from '../../lib/useShared.js';
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { Act, ActRow } from '../../shell/ui/act.js';
import { elapsed, useRunningTimer } from '../../shell/useRunningTimer.js';
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
    permission: 'time.entries.write_own',
    Component: () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data, loading, error } = useShared<{ entries: Array<{ effectiveMinutes: number }> }>(
        `/time/day?date=${today}`,
      );
      // The fortnight behind today, so the figure can be compared with itself. Already shared
      // with four other widgets, so this costs no request.
      const recent = useShared<{ days: Day[] }>('/time/recent');
      const total = (data?.entries ?? []).reduce((n, e) => n + (e.effectiveMinutes ?? 0), 0);
      return (
        <Card to="/time" error={error}>
          {loading ? (
            <Skeleton height="3rem" />
          ) : (
            <Figure
              label="Logged today"
              value={hours(total)}
              note={total === 0 ? 'nothing yet' : undefined}
              trail={fill(recent.data?.days ?? [], 14).map((d) => d.value)}
            />
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
    permission: 'time.entries.write_own',
    settings: [DAYS],
    Component: ({ settings }) => {
      const count = Math.max(7, Math.min(90, Number(settings.days) || 14));
      const { data, loading, error } = useShared<{ days: Day[] }>('/time/recent');
      const days = fill(data?.days ?? [], count);
      const total = days.reduce((n, d) => n + d.value, 0);
      const worked = days.filter((d) => d.value > 0).length;
      return (
        <Card
          error={error}
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
    permission: 'time.entries.write_own',
    Component: ({ entityId }) => {
      const { data, loading, error } = useShared<{ spentMinutes: number; budgetMinutes: number | null }>(
        entityId ? `/time/projects/${entityId}/burn` : null,
      );
      const spent = data?.spentMinutes ?? 0;
      const budget = data?.budgetMinutes ?? null;
      return (
        <Card title="Budget burn" to="/time" error={error}>
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
    permission: 'time.entries.write_own',
    Component: () => {
      const { data, loading, error } = useShared<{ days: Array<{ date: string; entries?: Array<{ projectName?: string; effectiveMinutes: number }> }> }>(
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
        <Card title="Where the week went" sub={`${rows.length} projects`} to="/time/week" error={error}>
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
    // Hidden until there is something to show: a quarter-grid of three days is decoration.
    needs: ['worked_days', 20],
    slot: 'dashboard',
    defaultSpan: 4,
    minSpan: 3,
    permission: 'time.entries.write_own',
    Component: () => {
      const { data, loading, error } = useShared<{ days: Day[] }>('/time/recent');
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
        <Card title="Working pattern" sub={`${worked} of ${span} days had an hour on them`} to="/time" error={error}>
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
    permission: 'time.entries.write_own',
    Component: () => {
      const { data, loading, error } = useShared<{ days: Array<{ entries?: Array<{ taskId: string | null; effectiveMinutes: number; billable: boolean }> }> }>(
        '/time/recent',
      );
      const all = (data?.days ?? []).flatMap((d) => d.entries ?? []);
      const loose = all.filter((e) => !e.taskId && e.billable);
      const minutes = loose.reduce((n, e) => n + (e.effectiveMinutes ?? 0), 0);
      return (
        <Card tone={loose.length > 0 ? 'warning' : undefined} to="/time" error={error}>
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
    // Hidden until there is something to show: a comparison between people needs two people.
    needs: ['people_logging', 2],
    slot: 'dashboard',
    defaultSpan: 6,
    minSpan: 4,
    permission: 'time.entries.read_all',
    Component: () => {
      // `everyone`, or this only ever returns the viewer's own hours and draws one row.
      const { data, loading, error } = useShared<{
        days: Array<{ entries?: Array<{ personId: string; personName?: string; effectiveMinutes: number }> }>;
      }>('/time/recent?everyone=true');
      const capacity = useShared<Array<{ id: string; displayName: string; weeklyHours: number | null }>>(
        '/core/capacities',
      );
      // Keyed on the id, not the name. Two colleagues can share a display name, and the join
      // to contracted hours has to survive somebody changing theirs in Zitadel.
      const byPerson = new Map<string, { name: string; minutes: number }>();
      for (const d of data?.days ?? []) {
        for (const e of d.entries ?? []) {
          const at = byPerson.get(e.personId) ?? { name: e.personName ?? 'Someone', minutes: 0 };
          at.minutes += e.effectiveMinutes ?? 0;
          byPerson.set(e.personId, at);
        }
      }
      /*
       * A denominator at last, for the people who have one.
       *
       * This shipped with `of: null` hardcoded and a comment explaining that a capacity nobody
       * entered is not forty hours a week. That reasoning still holds — it is why the fallback
       * below is `null` and not a default — but contracted hours are now a real field on a
       * person, so anyone it is set on gets a bar and anyone it is not stays a bare number.
       *
       * Two weeks of hours against a weekly figure, so the denominator matches the window.
       */
      const rows = [...byPerson.entries()]
        .sort((a, b) => b[1].minutes - a[1].minutes)
        .map(([id, who]) => {
          const weekly = capacity.data?.find((c) => c.id === id)?.weeklyHours ?? null;
          return {
            label: who.name,
            value: who.minutes,
            // Two weeks of hours against a weekly figure, so the denominator matches the window.
            of: weekly === null ? null : weekly * 60 * 2,
          };
        });
      return (
        <Card
          error={error}
          title="Load per person"
          sub="Last fortnight. A bar appears only where contracted hours are set."
          to="/time/week"
        >
          {loading ? (
            <Skeleton height="4rem" />
          ) : rows.length === 0 ? (
            <Empty>Nobody has logged an hour in the last fortnight.</Empty>
          ) : (
            <Bullet rows={rows} format={hours} missing="no hours contracted" />
          )}
        </Card>
      );
    },
  },

  /* ── Compound cards, with actions that reach a real endpoint ──────────── */

  'time:timer': {
    title: 'Timer',
    description: 'The running clock, what it is against, and stop or switch without leaving the page.',
    slot: 'dashboard',
    defaultSpan: 4,
    minSpan: 3,
    permission: 'time.entries.write_own',
    Component: () => {
      const { running, needsDuration, busy, stop, start } = useRunningTimer();
      const projects = useShared<Array<{ id: string; name: string }>>('/crm/projects');
      const [picking, setPicking] = useState(false);

      /*
       * Idle is a state with an action in it, not an empty card.
       *
       * A timer widget that shows nothing when nothing is running is a widget you cannot start
       * a timer from, which is most of what a timer widget is for — and for a business that
       * bills by the hour the gap between starting work and remembering to start the clock is
       * where the money goes.
       */
      if (!running) {
        return (
          <Card title="Timer">
            <div className="card-clock" style={{ color: 'var(--faint)' }}>0:00:00</div>
            <div className="card-meta" style={{ marginTop: 'var(--space-2)' }}>Nothing running</div>
            {picking ? (
              <div className="card-foot">
                <select
                  aria-label="Project"
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) void start({ projectId: e.target.value });
                    setPicking(false);
                  }}
                >
                  <option value="">Pick a project…</option>
                  {(projects.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="card-foot">
                <Act variant="primary" run={async () => setPicking(true)}>Start a timer</Act>
              </div>
            )}
          </Card>
        );
      }

      return (
        <Card title="Timer" live>
          <div className="card-clock">{elapsed(running.startedAt)}</div>
          <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-sm)' }}>
            {running.description || running.projectName}
          </div>
          <div className="card-meta" style={{ marginTop: '3px' }}>
            {running.projectName}
            {running.taskId ? ' · against a card' : ' · no card'}
          </div>
          <div className="card-foot">
            {/* Over a day, stopping needs a duration — only the tracker asks for one. */}
            {needsDuration ? (
              <a className="btn" href="/time">Stop on the Time page</a>
            ) : (
              <Act variant="primary" run={stop}>Stop</Act>
            )}
            <Act run={async () => setPicking(true)} variant="quiet">Switch</Act>
          </div>
          {picking && (
            <div className="card-foot" style={{ borderTop: 0, paddingTop: 'var(--space-2)' }}>
              <select
                aria-label="Switch to project"
                defaultValue=""
                disabled={busy}
                onChange={(e) => {
                  // switchTo stops the running clock and starts the new one in one call, which
                  // is the whole reason it exists — doing it as stop-then-start leaves a gap
                  // that gets billed to nobody.
                  if (e.target.value) void start({ projectId: e.target.value });
                  setPicking(false);
                }}
              >
                <option value="">Switch to…</option>
                {(projects.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}
        </Card>
      );
    },
  },

  'time:timesheet-health': {
    title: 'Timesheet health',
    description: 'This week day by day, and the billable hours carrying no card — with a card picker on each one.',
    slot: 'dashboard',
    defaultSpan: 6,
    minSpan: 4,
    permission: 'time.entries.write_own',
    Component: () => {
      const { data, loading, error } = useShared<{
        days: Array<{ date: string; totalMinutes: number; entries?: Array<{ id: string; taskId: string | null; description: string | null; effectiveMinutes: number; billable: boolean; projectId: string }> }>;
      }>('/time/recent');
      const tasks = useShared<Array<{ id: string; title: string; projectId: string }>>('/scrum/tasks');
      const [fixed, setFixed] = useState<string[]>([]);

      /*
       * This week's five weekdays, including the ones with nothing on them.
       *
       * `/time/recent` returns only days that have an entry, so slicing it gives however many
       * days happened to be worked and calls them the week — a Wednesday with nothing logged
       * would simply not appear, which is the exact day this widget exists to point at.
       */
      const monday = new Date();
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      const week = Array.from({ length: 5 }, (_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const date = d.toISOString().slice(0, 10);
        const found = (data?.days ?? []).find((x) => x.date === date);
        return { date, totalMinutes: found?.totalMinutes ?? 0, entries: found?.entries ?? [] };
      });
      const peak = Math.max(...week.map((d) => d.totalMinutes), 1);
      const loose = week
        .flatMap((d) => d.entries ?? [])
        .filter((e) => e.billable && !e.taskId && !fixed.includes(e.id));

      return (
        <Card title="Timesheet health" tone={loose.length > 0 ? 'warning' : undefined} error={error}>
          {loading ? (
            <Skeleton height="4rem" />
          ) : (
            <>
              <div className="weekblocks">
                {week.map((d) => (
                  <div key={d.date}>
                    <i
                      style={{
                        background:
                          d.totalMinutes === 0
                            ? undefined
                            : `color-mix(in srgb, var(--accent) ${Math.round(30 + 70 * (d.totalMinutes / peak))}%, var(--surface-sunken))`,
                      }}
                      title={hours(d.totalMinutes)}
                    />
                    <span>{new Date(d.date).toLocaleDateString('en-GB', { weekday: 'short' })}</span>
                  </div>
                ))}
              </div>

              {loose.length === 0 ? (
                <p className="card-sub">Every billable hour this week is against a card.</p>
              ) : (
                <>
                  <p className="card-sub">
                    {hours(loose.reduce((n, e) => n + e.effectiveMinutes, 0))} billable with no card —
                    nothing can be invoiced from these.
                  </p>
                  <ul className="act-rows">
                    {loose.slice(0, 3).map((e) => (
                      <ActRow
                        key={e.id}
                        title={e.description || 'Untitled hour'}
                        meta={hours(e.effectiveMinutes)}
                      >
                        {/*
                          Fixed here rather than by sending you to the timesheet.
                          
                          The whole failure this widget names is that assigning a card is a
                          separate errand nobody runs. A picker on the row is the errand.
                        */}
                        <select
                          aria-label="Attach to a card"
                          defaultValue=""
                          onChange={(ev) => {
                            const taskId = ev.target.value;
                            if (!taskId) return;
                            void api
                              .patch(`/time/entries/${e.id}`, { taskId })
                              .then(() => setFixed((all) => [...all, e.id]))
                              .catch(() => undefined);
                          }}
                        >
                          <option value="">Attach to…</option>
                          {(tasks.data ?? [])
                            .filter((t) => t.projectId === e.projectId)
                            .map((t) => (
                              <option key={t.id} value={t.id}>{t.title}</option>
                            ))}
                        </select>
                      </ActRow>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </Card>
      );
    },
  },

  /* ── Approval ─────────────────────────────────────────────────────────── */

  'time:approvals': {
    title: 'Waiting on you',
    description: "Weeks somebody has submitted and nobody has decided on. Approving one releases its hours to be invoiced.",
    // Hidden until there is something to show: nothing to approve is a state; a permanent one is not.
    needs: ['pending_weeks', 1],
    slot: 'dashboard',
    defaultSpan: 6,
    minSpan: 4,
    permission: 'time.approve',
    Component: () => {
      const { data, loading, error } = useShared<
        Array<{
          id: string; personId: string; personName: string; weekOf: string;
          minutes: number; entries: number; withoutTask: number;
        }>
      >('/time/approvals');
      const [gone, setGone] = useState<string[]>([]);
      const rows = (data ?? []).filter((r) => !gone.includes(r.id));

      const sendBack = (r: { personId: string; weekOf: string }) => async () => {
        // Prompted rather than a silent reject: the server refuses a return with no reason,
        // and a week sent back without one gives the person a badge and no idea what to fix.
        const note = window.prompt('What needs changing before this can be approved?');
        if (!note?.trim()) throw new Error('A week sent back needs a reason');
        return api.post('/time/timesheet/decide', { ...r, approve: false, note });
      };

      return (
        <Card
          error={error}
          title="Waiting on you"
          sub={loading || rows.length === 0 ? undefined : 'Approving releases the hours to be invoiced'}
          tone={rows.length > 0 ? 'info' : undefined}
        >
          {loading ? (
            <Skeleton height="4rem" />
          ) : rows.length === 0 ? (
            <Empty>No week is waiting on a decision.</Empty>
          ) : (
            <ul className="act-rows">
              {rows.map((r) => (
                <ActRow
                  key={r.id}
                  title={`${r.personName} · week of ${r.weekOf}`}
                  meta={
                    // The count that decides most rejections, said before it is asked for.
                    `${hours(r.minutes)} · ${r.entries} ${r.entries === 1 ? 'entry' : 'entries'}` +
                    (r.withoutTask > 0 ? ` · ${r.withoutTask} with no card` : '')
                  }
                >
                  <Act
                    variant="primary"
                    run={() =>
                      api.post('/time/timesheet/decide', {
                        personId: r.personId,
                        weekOf: r.weekOf,
                        approve: true,
                      })
                    }
                    onDone={() => setGone((all) => [...all, r.id])}
                  >
                    Approve
                  </Act>
                  <Act
                    variant="danger"
                    run={sendBack({ personId: r.personId, weekOf: r.weekOf })}
                    onDone={() => setGone((all) => [...all, r.id])}
                  >
                    Send back
                  </Act>
                </ActRow>
              ))}
            </ul>
          )}
        </Card>
      );
    },
  },

  'time:my-week': {
    title: 'My week',
    description: 'Where your own week stands — open, waiting on somebody, approved, or sent back with a reason.',
    slot: 'dashboard',
    defaultSpan: 4,
    minSpan: 3,
    permission: 'time.entries.write_own',
    Component: () => {
      const sheet = useShared<{ status: string; note: string | null } | null>('/time/timesheet');
      const recent = useShared<{ days: Array<{ date: string; totalMinutes: number }> }>('/time/recent');

      const monday = new Date();
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      const week = (recent.data?.days ?? []).filter((d) => d.date >= monday.toISOString().slice(0, 10));
      const minutes = week.reduce((n, d) => n + d.totalMinutes, 0);
      /*
       * The server's answer, with no local override on top of it.
       *
       * The first version held the new status in component state after submitting, which then
       * shadowed every later refetch — so approving the week in the card beside this one left
       * this one saying "submitted" for as long as the page stayed open, with the two on
       * screen disagreeing. `Act` refreshes every shared read on success, so the state was
       * both unnecessary and the reason the refresh could not be seen.
       */
      const status = sheet.data?.status ?? 'open';

      const tone = status === 'returned' ? 'danger' : status === 'approved' ? 'ok' : undefined;
      const says =
        status === 'approved'
          ? 'Approved — these hours can be invoiced.'
          : status === 'submitted'
            ? 'Submitted. Waiting on a decision.'
            : status === 'returned'
              ? (sheet.data?.note ?? 'Sent back.')
              : 'Not submitted yet.';

      return (
        <Card title="My week" tone={tone}>
          {sheet.loading ? (
            <Skeleton height="3rem" />
          ) : (
            <>
              <Figure label="Logged this week" value={hours(minutes)} note={says} />
              {/* Approved is the one state with nothing to do, so it is the one with no button. */}
              {status !== 'approved' && status !== 'submitted' && (
                <div className="card-foot">
                  <Act variant="primary" run={() => api.post('/time/timesheet/submit', {})}>
                    {status === 'returned' ? 'Send it again' : 'Submit the week'}
                  </Act>
                </div>
              )}
            </>
          )}
        </Card>
      );
    },
  },
};
