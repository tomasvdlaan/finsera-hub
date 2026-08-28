import { Link, useSearchParams } from 'react-router-dom';
import { Block, PageHeader } from '../ui/layout.js';
import { Button, Empty } from '../ui/primitives.js';
import { Card } from '../ui/card.js';
import { useDocumentTitle } from '../useDocumentTitle.js';
import { clock, shiftDay, todayIso, weekDays, weekStart } from '../../lib/dates.js';
import { itemsOnDay, sortItems, withinWindow } from './agendaItems.js';
import { AgendaGrid } from './AgendaGrid.js';
import { AgendaRail } from './AgendaRail.js';
import { useAgenda } from './useAgenda.js';

/**
 * The agenda — one timeline over everything the platform already knows the date of.
 *
 * Seven kinds of dated record existed across five modules before this page and no screen read
 * any of them as a date. `tasks.due_on` and `action_items.due_on` are the sharpest case: both
 * written since their modules were built, and the only surface that looked at either was the
 * Inbox, which shows them once they are already late.
 *
 * A shell page rather than a module, for the reason the shell manifest and `App.tsx` both give
 * about Today and Money: a surface that spans five modules belongs to none of them, and a
 * module that owned it would have to import the other four.
 */

type View = 'week' | 'day' | 'list';
const VIEWS: View[] = ['week', 'day', 'list'];

const RANGE = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' });
const FULL = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** Midday, so a date label can never be dragged over a boundary by a zone offset. */
const noon = (iso: string) => new Date(`${iso}T12:00:00`);

export function Agenda() {
  const [params, setParams] = useSearchParams();

  /*
   * The view and the date live in the URL.
   *
   * Both are the page's whole state, and a calendar you cannot send somebody a link to is a
   * calendar you end up describing over a call instead. Same reasoning `/time` uses for its
   * modes, and the same reason the board keeps `?projectId=` on its tab strip.
   */
  const view: View = VIEWS.includes(params.get('view') as View) ? (params.get('view') as View) : 'week';
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : todayIso();

  const set = (next: Partial<{ view: View; date: string }>) => {
    const merged = new URLSearchParams(params);
    if (next.view) merged.set('view', next.view);
    if (next.date) merged.set('date', next.date);
    setParams(merged, { replace: true });
  };

  // The window each view asks for. `list` looks a fortnight ahead from the anchor.
  const weekOf = weekStart(anchor);
  const [from, to] =
    view === 'week' ? [weekOf, shiftDay(weekOf, 6)]
    : view === 'day' ? [anchor, anchor]
    : [anchor, shiftDay(anchor, 13)];

  const { items, today, loading, failed } = useAgenda(from, to);
  const inWindow = sortItems(withinWindow(items, from, to));

  const title =
    view === 'day' ? FULL.format(noon(anchor))
    : view === 'week' ? `${RANGE.format(noon(weekOf))} – ${RANGE.format(noon(shiftDay(weekOf, 6)))}`
    : 'The next fortnight';

  useDocumentTitle('Agenda');

  const step = (direction: -1 | 1) => {
    const by = view === 'week' ? 7 : view === 'day' ? 1 : 14;
    set({ date: shiftDay(anchor, direction * by) });
  };

  // No <Page> here: the shell wraps its own routes in one, the same way it does for Settings
  // and People. A page that wrapped itself as well would nest two grids.
  return (
    <>
      <PageHeader
        title="Agenda"
        subtitle={title}
        actions={
          <>
            <Button size="sm" onClick={() => step(-1)} aria-label="Previous">
              ←
            </Button>
            <Button size="sm" onClick={() => set({ date: todayIso() })}>
              Today
            </Button>
            <Button size="sm" onClick={() => step(1)} aria-label="Next">
              →
            </Button>
          </>
        }
        tabs={VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            className={v === view ? 'page-tab active' : 'page-tab'}
            onClick={() => set({ view: v })}
          >
            {v === 'week' ? 'Week' : v === 'day' ? 'Day' : 'List'}
          </button>
        ))}
      />

      <Block span={9}>
        {view === 'week' && <AgendaGrid days={weekDays(weekOf)} items={inWindow} today={today} />}
        {view === 'day' && <AgendaGrid days={[anchor]} items={inWindow} today={today} />}
        {view === 'list' && <AgendaList items={inWindow} from={from} to={to} today={today} />}
      </Block>

      <Block span={3}>
        <AgendaRail items={items} today={today} loading={loading} failed={failed} />
      </Block>
    </>
  );
}

/**
 * The same fortnight, read down rather than across.
 *
 * The grid is the right shape for a day with hours in it and the wrong one for a stretch that
 * is mostly deadlines — fourteen mostly-empty columns to show six dots. Days with nothing on
 * them are omitted rather than drawn empty: a list of blanks is not information about a week.
 */
function AgendaList({
  items,
  from,
  to,
  today,
}: {
  items: ReturnType<typeof sortItems>;
  from: string;
  to: string;
  today: string;
}) {
  const days = Array.from({ length: 14 }, (_, i) => shiftDay(from, i)).filter((d) => d <= to);
  const withSomething = days
    .map((iso) => ({ iso, rows: itemsOnDay(items, iso) }))
    .filter((d) => d.rows.length > 0);

  if (withSomething.length === 0) {
    return (
      <Card>
        <Empty>
          Nothing scheduled and nothing due between {RANGE.format(noon(from))} and{' '}
          {RANGE.format(noon(to))}.
        </Empty>
      </Card>
    );
  }

  return (
    <div className="agenda-list">
      {withSomething.map(({ iso, rows }) => (
        <section key={iso} className="agenda-listday" data-today={iso === today || undefined}>
          <h3>{FULL.format(noon(iso))}</h3>
          <ul>
            {rows.map((r) => (
              <li key={r.id} data-kind={r.kind} data-tone={r.tone}>
                <span className="agenda-list-when">
                  {r.shape === 'timed' ? clock(r.at) : '—'}
                </span>
                <span className="agenda-list-title">
                  {r.href ? <Link to={r.href}>{r.title}</Link> : r.title}
                </span>
                {r.detail && <span className="agenda-list-detail">{r.detail}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
