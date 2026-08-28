import { Link } from 'react-router-dom';
import { clock, dayFraction, isoDateOf } from '../../lib/dates.js';
import { bandSpan, itemsOnDay, type AgendaItem } from './agendaItems.js';

/**
 * The week: hours down, days across.
 *
 * Three registers on one surface, which is the whole design problem here. A meeting occupies
 * hours; a sprint occupies days; a deadline occupies a moment. Drawing all three as blocks on
 * the hour grid is what makes most calendars unreadable once anything but meetings is on them
 * — an invoice is not due between two and three.
 *
 * So each gets its own band of the layout: sprints above the grid, deadlines in the day header
 * under the date, and only things with a real start and end inside the grid itself.
 */

/** 07:00–21:00. Outside it nothing is scheduled, and fourteen rows is what fits without scroll. */
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 21;
const HOURS = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => DAY_START_HOUR + i);

const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const DAYNUM = new Intl.DateTimeFormat(undefined, { day: 'numeric' });

/**
 * Where a timed item sits in its column, as percentages of the visible window.
 *
 * Built on `dayFraction`, which measures against the day's real midnights, so the two days a
 * year that are 23 and 25 hours long place their afternoons correctly instead of an hour out.
 * Clamped to the window at both ends: an item starting at 06:00 is drawn from the top edge
 * rather than above it, and one running past 21:00 stops at the bottom.
 */
function place(item: AgendaItem, iso: string): { top: string; height: string } | null {
  const windowFrom = DAY_START_HOUR / 24;
  const windowTo = DAY_END_HOUR / 24;
  const span = windowTo - windowFrom;

  const rawStart = dayFraction(item.at, iso);
  const rawEnd = item.until ? dayFraction(item.until, iso) : rawStart + 1 / 24;
  if (rawEnd <= windowFrom || rawStart >= windowTo) return null;

  const start = Math.max(rawStart, windowFrom);
  const end = Math.min(rawEnd, windowTo);
  return {
    top: `${((start - windowFrom) / span) * 100}%`,
    // A floor, or a fifteen-minute entry renders as a line with no room for its own label.
    height: `${Math.max(((end - start) / span) * 100, 2.5)}%`,
  };
}

function Block({ item, iso }: { item: AgendaItem; iso: string }) {
  const pos = place(item, iso);
  if (!pos) return null;
  const body = (
    <>
      <span className="agenda-block-time">{clock(item.at)}</span>
      <span className="agenda-block-title">{item.title}</span>
    </>
  );
  return (
    <div
      className="agenda-block"
      data-kind={item.kind}
      data-tone={item.tone}
      style={pos}
      title={`${clock(item.at)}${item.until ? `–${clock(item.until)}` : ''} · ${item.title}`}
    >
      {item.href ? (
        <Link to={item.href} className="agenda-block-hit">
          {body}
        </Link>
      ) : (
        <span className="agenda-block-hit">{body}</span>
      )}
    </div>
  );
}

/**
 * @param days The columns, in order. Seven for a week, one for a day — the day view is this
 *             same grid with a single column, not a second component that would drift from it.
 */
export function AgendaGrid({
  days,
  items,
  today,
}: {
  days: string[];
  items: AgendaItem[];
  today: string;
}) {
  const from = days[0]!;
  const to = days[days.length - 1]!;

  const bands = items
    .filter((i) => i.shape === 'band')
    .map((item) => ({ item, span: bandSpan(item, from, to) }))
    .filter((b): b is { item: AgendaItem; span: NonNullable<ReturnType<typeof bandSpan>> } => b.span !== null);

  const nowIso = isoDateOf(new Date());
  const nowFraction = dayFraction(new Date(), nowIso);
  const nowTop =
    (nowFraction - DAY_START_HOUR / 24) / ((DAY_END_HOUR - DAY_START_HOUR) / 24);

  return (
    // The column count drives the grid template and the band track alike, so a one-day view and
    // a seven-day view are the same component with a different number in it.
    <div className="agenda-week" style={{ ['--agenda-days' as string]: days.length }}>
      {/* Day headers: the date, and the deadlines that belong to the day rather than an hour. */}
      <div className="agenda-gutter" aria-hidden="true" />
      {days.map((iso) => {
        const markers = itemsOnDay(items, iso).filter((i) => i.shape === 'marker');
        return (
          <div key={iso} className="agenda-dayhead" data-today={iso === today || undefined}>
            <div className="agenda-dayhead-date">
              <span className="agenda-dayname">{WEEKDAY.format(new Date(`${iso}T12:00:00`))}</span>
              <b>{DAYNUM.format(new Date(`${iso}T12:00:00`))}</b>
            </div>
            {markers.length > 0 && (
              <ul className="agenda-markers">
                {markers.map((m) => (
                  <li key={m.id} data-kind={m.kind} data-tone={m.tone}>
                    {m.href ? (
                      <Link to={m.href} title={m.detail ? `${m.title} · ${m.detail}` : m.title}>
                        {m.title}
                      </Link>
                    ) : (
                      <span title={m.title}>{m.title}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {/* Sprints, as bars over the days they cover rather than as events inside them. */}
      {bands.length > 0 && (
        <>
          <div className="agenda-gutter agenda-bandlabel">In flight</div>
          <div className="agenda-bands">
            {bands.map(({ item, span }) => (
              <Link
                key={item.id}
                to={item.href ?? '#'}
                className="agenda-band"
                data-tone={item.tone}
                data-clip-start={span.clippedStart || undefined}
                data-clip-end={span.clippedEnd || undefined}
                style={{ gridColumn: `${span.offset + 1} / span ${span.days}` }}
                title={`${item.title} · ${item.at} → ${item.until ?? item.at}`}
              >
                {item.title}
              </Link>
            ))}
          </div>
        </>
      )}

      {/* The hour grid. */}
      <div className="agenda-gutter agenda-hours">
        {HOURS.map((h) => (
          <div key={h} className="agenda-hour">
            <span>{String(h).padStart(2, '0')}:00</span>
          </div>
        ))}
      </div>

      {days.map((iso) => {
        const timed = itemsOnDay(items, iso).filter((i) => i.shape === 'timed');
        return (
          <div key={iso} className="agenda-col" data-today={iso === today || undefined}>
            {HOURS.map((h) => (
              <div key={h} className="agenda-slot" />
            ))}
            {/*
              Logged hours behind, scheduled things in front.

              Two orderings in one stack: what you did, and what you meant to do. Drawing the
              record of the day behind the plan for it is what lets the two be compared at a
              glance rather than fighting for the same pixels.
            */}
            {timed
              .slice()
              .sort((a, b) => Number(b.kind === 'logged') - Number(a.kind === 'logged'))
              .map((item) => (
                <Block key={item.id} item={item} iso={iso} />
              ))}
            {iso === nowIso && nowTop >= 0 && nowTop <= 1 && (
              <div className="agenda-now" style={{ top: `${nowTop * 100}%` }} aria-hidden="true" />
            )}
          </div>
        );
      })}
    </div>
  );
}
