import { daysBetween, isoDateOf, isWithin, shiftDay } from '../../lib/dates.js';

/**
 * Seven kinds of dated record, one timeline.
 *
 * The platform has known when things happen since each module was built — `tasks.due_on`,
 * `sprints.starts_on`, `notes.meeting_date`, `action_items.due_on`, `invoices.due_on`,
 * `quotes.valid_until`, `entries.started_at` — and no screen has ever read any of them as a
 * date. The two `due_on` columns are the sharpest case: both are written, and the only surface
 * that looks at them is the Inbox, which shows them once they are already late.
 *
 * This file is the whole of the translation, and it is pure on purpose. The agenda is mostly
 * date arithmetic and mostly the kind that is wrong in ways nobody notices for six months —
 * a sprint band a day short, a deadline drawn as an hour, a task that is "due today" at 23:00
 * in the wrong zone. Pure functions mean all of that is testable without a browser, a database
 * or a clock.
 */

/** What a row came from. Kept distinct from `shape` — the two answer different questions. */
export type AgendaKind =
  | 'meeting'
  | 'logged'
  | 'sprint'
  | 'task'
  | 'action'
  | 'invoice'
  | 'quote';

/**
 * How a row is drawn, which is not the same as what it is.
 *
 * The distinction is the one thing that makes the week readable rather than a pile:
 *
 * - `timed` occupies real hours and is drawn as a block on the grid.
 * - `band` spans whole days and is drawn above the grid, because a sprint is not at 09:00.
 * - `marker` is a moment with no duration and is drawn as a dot in the day header. A deadline
 *   drawn as an hour-long block is a lie — an invoice is not due *between two and three*.
 */
export type AgendaShape = 'timed' | 'band' | 'marker';

/** Maps to the semantic tokens, so a status reads the same here as it does everywhere else. */
export type AgendaTone = 'neutral' | 'accent' | 'ok' | 'warning' | 'danger' | 'info';

export interface AgendaItem {
  /** Unique across the assembled list — prefixed by kind, since ids are only unique per table. */
  id: string;
  kind: AgendaKind;
  shape: AgendaShape;
  title: string;
  /** `timed`: an ISO instant. `band` and `marker`: a `YYYY-MM-DD`. */
  at: string;
  /** `timed`: the end instant. `band`: the last day, inclusive. `marker`: absent. */
  until?: string;
  tone: AgendaTone;
  /** Where clicking goes. Absent for a row with nowhere to go, rather than a dead link. */
  href?: string;
  /** The second line: a client, a project, an amount. */
  detail?: string;
}

/* ── The shapes this reads, declared locally ────────────────────────────────────────────
 *
 * Structural, and narrowed to the fields actually used. The shell does not import a module's
 * types — that is the same discipline the API keeps — and a wider type here would claim this
 * file knows things about a task that it does not.
 */

interface NoteLike {
  id: string;
  title: string;
  meetingDate: string;
  startedAt: string | null;
  endedAt: string | null;
  status: string;
  clientName?: string | null;
}

interface SprintLike {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  state: 'planned' | 'active' | 'completed';
}

interface TaskLike {
  id: string;
  title: string;
  dueOn: string | null;
  completedAt: string | null;
  flow: string;
}

interface ActionLike {
  id: string;
  text: string;
  dueOn: string | null;
  noteId: string;
  noteTitle: string;
}

interface InvoiceLike {
  id: string;
  number: string | null;
  status: string;
  dueOn: string | null;
  totalCents: number;
}

interface QuoteLike {
  id: string;
  number: string | null;
  title: string;
  status: string;
  validUntil: string | null;
}

interface EntryLike {
  id: string;
  startedAt: string | null;
  endedAt: string | null;
  projectName: string;
  description: string | null;
  billable: boolean;
  running: boolean;
}

interface TimeDayLike {
  date: string;
  entries: EntryLike[];
}

/**
 * How late something is, said in colour.
 *
 * Three states and no more. Past is `danger`, today is `warning`, and everything else is
 * plain — a deadline three weeks out that shouted would teach people to stop looking.
 */
export function dueTone(dueOn: string, today: string): AgendaTone {
  if (dueOn < today) return 'danger';
  if (dueOn === today) return 'warning';
  return 'neutral';
}

/** A meeting: timed when the room was open, an all-day marker when it was only written up. */
export function fromMeetings(notes: NoteLike[]): AgendaItem[] {
  return notes.map((n) => {
    const timed = Boolean(n.startedAt);
    return {
      id: `meeting:${n.id}`,
      kind: 'meeting' as const,
      // A note written up afterwards has no start and no end — an ordinary case, not a defect.
      // Inventing 09:00 for it would put a fact on the grid that nothing in the record supports.
      shape: timed ? ('timed' as const) : ('marker' as const),
      title: n.title,
      at: timed ? n.startedAt! : n.meetingDate,
      ...(timed && n.endedAt ? { until: n.endedAt } : {}),
      tone: n.status === 'final' ? ('neutral' as const) : ('accent' as const),
      href: `/meetings/${n.id}`,
      ...(n.clientName ? { detail: n.clientName } : {}),
    };
  });
}

/**
 * A sprint, as a band across every day it covers.
 *
 * `startsOn`/`endsOn` rather than `startedAt`/`completedAt`: the band answers "what are we in
 * the middle of", which is the plan. The schema's own comment draws this distinction and the
 * sprint bar already relies on it.
 */
export function fromSprints(sprints: SprintLike[]): AgendaItem[] {
  return sprints.map((s) => ({
    id: `sprint:${s.id}`,
    kind: 'sprint' as const,
    shape: 'band' as const,
    title: s.name,
    at: s.startsOn,
    until: s.endsOn,
    tone: s.state === 'active' ? ('accent' as const) : ('neutral' as const),
    href: `/board/sprints/${s.id}`,
  }));
}

/** A task deadline. Finished cards drop out — a met deadline is not news. */
export function fromTasks(tasks: TaskLike[], today: string): AgendaItem[] {
  return tasks
    .filter((t) => t.dueOn && !t.completedAt && t.flow !== 'done')
    .map((t) => ({
      id: `task:${t.id}`,
      kind: 'task' as const,
      shape: 'marker' as const,
      title: t.title,
      at: t.dueOn!,
      tone: dueTone(t.dueOn!, today),
      href: `/tasks/${t.id}`,
    }));
}

/** An action point somebody agreed to in a meeting, and its date. */
export function fromActions(actions: ActionLike[], today: string): AgendaItem[] {
  return actions
    .filter((a) => a.dueOn)
    .map((a) => ({
      id: `action:${a.id}`,
      kind: 'action' as const,
      shape: 'marker' as const,
      title: a.text,
      at: a.dueOn!,
      tone: dueTone(a.dueOn!, today),
      href: `/meetings/${a.noteId}`,
      detail: a.noteTitle,
    }));
}

/**
 * An invoice falling due.
 *
 * Paid and void drop out. A paid invoice's due date is a fact about the past, and leaving it
 * on the calendar in red is how a screen teaches people that its red does not mean anything.
 */
export function fromInvoices(
  invoices: InvoiceLike[],
  today: string,
  money: (cents: number) => string,
): AgendaItem[] {
  return invoices
    .filter((i) => i.dueOn && (i.status === 'issued' || i.status === 'draft'))
    .map((i) => ({
      id: `invoice:${i.id}`,
      kind: 'invoice' as const,
      shape: 'marker' as const,
      title: i.number ? `Invoice ${i.number}` : 'Draft invoice',
      at: i.dueOn!,
      // A draft is never overdue: nobody has been asked to pay it, so it cannot be late. It
      // shows as a plain marker so an unsent invoice past its own date is still visible.
      tone: i.status === 'draft' ? ('info' as const) : dueTone(i.dueOn!, today),
      href: `/money/invoices/${i.id}`,
      detail: money(i.totalCents),
    }));
}

/** A quote running out of time. Only one that has been sent and not yet decided can expire. */
export function fromQuotes(quotes: QuoteLike[], today: string): AgendaItem[] {
  return quotes
    .filter((q) => q.validUntil && q.status === 'sent')
    .map((q) => ({
      id: `quote:${q.id}`,
      kind: 'quote' as const,
      shape: 'marker' as const,
      title: q.title || (q.number ? `Quote ${q.number}` : 'Quote'),
      at: q.validUntil!,
      tone: dueTone(q.validUntil!, today),
      href: `/money/quotes/${q.id}`,
    }));
}

/**
 * Hours already logged, drawn behind everything else.
 *
 * Only entries that carry a start and an end. A manual entry is a number of minutes against a
 * day with no position on the clock, and placing it at an invented hour is the one thing that
 * makes a data product untrustworthy — the elevation plan says exactly this about the same
 * data. Those are counted in the rail instead, where the day total lives.
 */
export function fromTimeDays(days: TimeDayLike[]): AgendaItem[] {
  return days.flatMap((d) =>
    d.entries
      .filter((e) => e.startedAt && e.endedAt && !e.running)
      .map((e) => ({
        id: `logged:${e.id}`,
        kind: 'logged' as const,
        shape: 'timed' as const,
        // An entry with no description falls back to its project — at which point the project
        // is already the title, and repeating it as the detail prints the same word twice on
        // one row. Most entries in practice have no description, so this is the common case.
        title: e.description || e.projectName,
        at: e.startedAt!,
        until: e.endedAt!,
        tone: e.billable ? ('ok' as const) : ('neutral' as const),
        href: '/time',
        ...(e.description ? { detail: e.projectName } : {}),
      })),
  );
}

/** Which day a row belongs to. `timed` carries an instant; the rest already name a day. */
export function dayOf(item: AgendaItem): string {
  return item.shape === 'timed' ? isoDateOf(item.at) : item.at;
}

/**
 * Everything on one day.
 *
 * A band matches every day it covers, which is what makes it a band — the other two shapes
 * match the single day they name.
 */
export function itemsOnDay(items: AgendaItem[], iso: string): AgendaItem[] {
  return items.filter((i) =>
    i.shape === 'band' ? isWithin(iso, i.at, i.until ?? i.at) : dayOf(i) === iso,
  );
}

/**
 * How many days a band covers, and where it starts, clipped to a window.
 *
 * Returned rather than computed in the view because it is off-by-one bait: a sprint from
 * Monday to Friday covers five days, not four, and a band running past the edge of the week
 * has to be drawn short without being *reported* short.
 */
export function bandSpan(
  item: AgendaItem,
  windowFrom: string,
  windowTo: string,
): { offset: number; days: number; clippedStart: boolean; clippedEnd: boolean } | null {
  const from = item.at;
  const to = item.until ?? item.at;
  if (to < windowFrom || from > windowTo) return null;
  const visibleFrom = from < windowFrom ? windowFrom : from;
  const visibleTo = to > windowTo ? windowTo : to;
  return {
    offset: daysBetween(windowFrom, visibleFrom),
    days: daysBetween(visibleFrom, visibleTo) + 1,
    clippedStart: from < windowFrom,
    clippedEnd: to > windowTo,
  };
}

/**
 * Sort order within a day: bands, then timed by clock, then markers.
 *
 * Bands first because they are context for the day rather than events in it; markers last
 * because a deadline is a fact about the day as a whole and pretending it has a time would
 * scatter it through the hours.
 */
const SHAPE_ORDER: Record<AgendaShape, number> = { band: 0, timed: 1, marker: 2 };

export function sortItems(items: AgendaItem[]): AgendaItem[] {
  return [...items].sort(
    (a, b) =>
      SHAPE_ORDER[a.shape] - SHAPE_ORDER[b.shape] ||
      a.at.localeCompare(b.at) ||
      a.title.localeCompare(b.title),
  );
}

/** Everything falling in `[from, to]`, bands included when they merely overlap it. */
export function withinWindow(items: AgendaItem[], from: string, to: string): AgendaItem[] {
  return items.filter((i) => {
    if (i.shape === 'band') return (i.until ?? i.at) >= from && i.at <= to;
    return isWithin(dayOf(i), from, to);
  });
}

/**
 * What is coming, for the rail beside the grid.
 *
 * Markers only, and forward-looking with a short memory: an overdue invoice belongs here, and
 * a meeting that already happened does not. Sorted by tone before date, so the thing that is
 * actually late is at the top rather than three weeks down a chronological list.
 */
const TONE_URGENCY: Record<AgendaTone, number> = {
  danger: 0,
  warning: 1,
  info: 2,
  accent: 3,
  ok: 4,
  neutral: 5,
};

/**
 * The kinds that are an obligation, as opposed to a record of something.
 *
 * By kind rather than by shape, which is what this got wrong first time out. A meeting written
 * up after the fact has no start and no end, so it is marker-shaped — and a shape test put four
 * stand-ups from last month under a heading that said "closing in", above a subtitle that said
 * nothing was late. Both were true of the data and neither was true of the reader.
 *
 * A meeting is either on the grid at its hour or it already happened. Nothing about it is due.
 */
const OBLIGATIONS = new Set<AgendaKind>(['task', 'action', 'invoice', 'quote']);

export function upcoming(items: AgendaItem[], today: string, days = 14): AgendaItem[] {
  const horizon = shiftDay(today, days);
  return items
    .filter((i) => OBLIGATIONS.has(i.kind) && dayOf(i) <= horizon)
    .sort(
      (a, b) =>
        TONE_URGENCY[a.tone] - TONE_URGENCY[b.tone] ||
        a.at.localeCompare(b.at) ||
        a.title.localeCompare(b.title),
    );
}
