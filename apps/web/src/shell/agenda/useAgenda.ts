import { useMemo } from 'react';
import { useShared } from '../../lib/useShared.js';
import { todayIso } from '../../lib/dates.js';
import {
  fromActions,
  fromInvoices,
  fromMeetings,
  fromQuotes,
  fromSprints,
  fromTasks,
  fromTimeDays,
  sortItems,
  type AgendaItem,
} from './agendaItems.js';

/**
 * Seven reads, seven independent failures.
 *
 * No composite endpoint, for two reasons. The shell may not import a module's service — the
 * `shell-no-modules` rule in `.dependency-cruiser.cjs` — and the registry that the shell *can*
 * query holds no dates, so there is nothing server-side to compose from. And the elevation
 * plan is explicit that these blocks want independent load and independent failure rather than
 * a `Promise.all` that turns one slow module into a blank page.
 *
 * `useShared` collapses the duplicate requests this creates across the page, which is exactly
 * what it was built for: the tasks call here and the tasks call in a dashboard widget are one
 * round trip.
 *
 * Every source is optional in the strict sense — if quotes fail, the agenda is an agenda
 * without quote expiry on it, and it says so in the rail rather than refusing to draw.
 */

interface Source {
  key: string;
  label: string;
  error?: string;
}

export interface Agenda {
  items: AgendaItem[];
  today: string;
  /** True until every source has answered one way or the other. */
  loading: boolean;
  /** The sources that failed, named, so the page can say what is missing rather than lie. */
  failed: Source[];
}

const money = (cents: number) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(cents / 100);

/**
 * @param from  inclusive `YYYY-MM-DD` — the window the hour-grid sources are asked for
 * @param to    inclusive `YYYY-MM-DD`
 */
export function useAgenda(from: string, to: string): Agenda {
  const today = todayIso();

  /*
   * Meetings, sprints, tasks, quotes and invoices are asked for whole.
   *
   * None of these endpoints takes a date range today, and adding five range parameters across
   * four modules to serve one page is a change to four public APIs for a business with three
   * clients and thirteen open cards. When the volume makes it worth it, the parameters go on
   * the endpoints and the only thing that changes here is the path strings.
   */
  const meetings = useShared<
    Array<{
      id: string;
      title: string;
      meetingDate: string;
      startedAt: string | null;
      endedAt: string | null;
      status: string;
      clientName?: string | null;
    }>
  >('/meetings');

  const actions = useShared<
    Array<{ id: string; text: string; dueOn: string | null; noteId: string; noteTitle: string }>
  >('/meetings/open-actions');

  const sprints = useShared<
    Array<{ id: string; name: string; startsOn: string; endsOn: string; state: 'planned' | 'active' | 'completed' }>
  >('/scrum/sprints');

  const tasks = useShared<
    Array<{ id: string; title: string; dueOn: string | null; completedAt: string | null; flow: string }>
  >('/scrum/tasks');

  const invoices = useShared<
    Array<{ id: string; number: string | null; status: string; dueOn: string | null; totalCents: number }>
  >('/billing/invoices');

  const quotes = useShared<
    Array<{ id: string; number: string | null; title: string; status: string; validUntil: string | null }>
  >('/sales/quotes');

  // The one source that is asked for a window, because it is the one that grows without bound.
  const hours = useShared<{
    days: Array<{
      date: string;
      entries: Array<{
        id: string;
        startedAt: string | null;
        endedAt: string | null;
        projectName: string;
        description: string | null;
        billable: boolean;
        running: boolean;
      }>;
    }>;
  }>(`/time/recent?from=${from}&to=${to}`);

  const items = useMemo(
    () =>
      sortItems([
        ...fromMeetings(meetings.data ?? []),
        ...fromActions(actions.data ?? [], today),
        ...fromSprints(sprints.data ?? []),
        ...fromTasks(tasks.data ?? [], today),
        ...fromInvoices(invoices.data ?? [], today, money),
        ...fromQuotes(quotes.data ?? [], today),
        ...fromTimeDays(hours.data?.days ?? []),
      ]),
    [meetings.data, actions.data, sprints.data, tasks.data, invoices.data, quotes.data, hours.data, today],
  );

  const sources: Array<Source & { loading: boolean }> = [
    { key: 'meetings', label: 'Meetings', error: meetings.error, loading: meetings.loading },
    { key: 'actions', label: 'Action points', error: actions.error, loading: actions.loading },
    { key: 'sprints', label: 'Sprints', error: sprints.error, loading: sprints.loading },
    { key: 'tasks', label: 'Cards', error: tasks.error, loading: tasks.loading },
    { key: 'invoices', label: 'Invoices', error: invoices.error, loading: invoices.loading },
    { key: 'quotes', label: 'Quotes', error: quotes.error, loading: quotes.loading },
    { key: 'hours', label: 'Logged hours', error: hours.error, loading: hours.loading },
  ];

  return {
    items,
    today,
    loading: sources.some((s) => s.loading),
    failed: sources.filter((s) => s.error).map(({ key, label, error }) => ({ key, label, error })),
  };
}
