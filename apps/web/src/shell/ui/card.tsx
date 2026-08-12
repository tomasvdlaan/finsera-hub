import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Meter, Spark } from './viz.js';

/**
 * What a card is about, when it is about something.
 *
 * Not a colour name. `danger` is not "red", it is "something here is late or blocked" — and
 * the fill only goes on when that is true of the content. A card tinted for variety spends
 * the meaning of every other tint on the screen, which is the failure mode a four-hue palette
 * exists to avoid.
 *
 * `hero` is the exception and is not a state: it marks the one thing a page is *for*. A page
 * gets one. Two heroes is none.
 */
export type Tone = 'danger' | 'warning' | 'ok' | 'info' | 'hero';

/**
 * The surface everything sits on.
 *
 * Replaces the `section` / `.panel` pair, which were byte-identical rules 2,800 lines apart
 * and neither of which could say anything about its contents.
 */
export function Card({
  title,
  sub,
  tone,
  span,
  to,
  aside,
  live,
  children,
}: {
  title?: ReactNode;
  /** One line under the title. Not a paragraph — those go in the body. */
  sub?: ReactNode;
  tone?: Tone;
  /** Columns on the twelve-column page grid. */
  span?: 3 | 4 | 5 | 6 | 7 | 8 | 9 | 12;
  /** Makes the whole card a destination, marked by the corner arrow. */
  to?: string;
  /** Anything that belongs at the top right instead of the arrow — a filter, a count. */
  aside?: ReactNode;
  /**
   * Something is happening in here right now — a clock running, a meeting recording.
   *
   * Turns the card's name accent-coloured, which is the one job the accent has that no tone
   * covers: a tone says what a card is *about*, this says it is not at rest. Spending a
   * colour on liveness only works while liveness is rare, so it is a boolean and not a tone.
   */
  live?: boolean;
  children?: ReactNode;
}) {
  const arrow = to ? (
    <Link to={to} className="card-out" aria-label={typeof title === 'string' ? title : 'Open'}>
      <span aria-hidden="true">↗</span>
    </Link>
  ) : null;

  return (
    <div className="card" data-tone={tone} data-span={span} data-live={live || undefined}>
      {(title || aside) && (
        <div className="card-head">
          <div>
            {title && <div className="card-title">{title}</div>}
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          {aside}
          {to && !aside && arrow}
        </div>
      )}
      {/*
        A titled card gives the arrow a row to sit in; an untitled one must not.
        
        A head containing nothing but the arrow is an empty line above the label, which on a
        card whose whole content is a number and a word is a third of the card given to
        whitespace with no reading in it. Cornered instead.
      */}
      {to && !aside && !title && <div className="card-corner">{arrow}</div>}
      {children}
    </div>
  );
}

/**
 * A measured quantity, and the word for what it is.
 *
 * The label is deliberately smaller than the figure, and that inversion is most of what
 * separates a dashboard from a form. `unit` rides at label size inside the figure so
 * "€1.926 · 21,4 h" reads as one number with a qualifier rather than as two competing ones.
 */
export function Figure({
  label,
  value,
  unit,
  note,
  size,
  trail,
  of,
  tone,
}: {
  label: string;
  value: string | number;
  unit?: string;
  note?: ReactNode;
  /** The page's one hero figure, if it has one. */
  size?: 'hero';
  /**
   * The same measure over recent time.
   *
   * A counter answers "how many" and is always asked "is that normal" — a question one number
   * cannot answer at all. Every span-3 tile in this library was label, number, prose, and none
   * of them carried a comparison, which is most of what made a row of them read as flat.
   *
   * Costs nothing to fetch: the widgets that have a trail already hold the series they slice
   * the current value out of.
   */
  trail?: number[];
  /** A denominator, where an honest one exists. Never invented — see Meter. */
  of?: number;
  tone?: string;
}) {
  /*
   * The slot exists whether or not it has anything in it.
   *
   * Reserved rather than conditional so a row of tiles bottom-aligns on one baseline: the
   * previous version let content sit at three different heights while the chart cards below
   * all aligned, and that mismatch is visible even when you cannot name it. A tile with no
   * honest comparison keeps an empty slot and stays a bare number, which is the correct
   * outcome and now a deliberate-looking one.
   */
  const comparison =
    trail && trail.length > 1 ? (
      <Spark points={trail} height={26} fill={false} tone={tone ?? 'var(--accent)'} />
    ) : of !== undefined && of > 0 ? (
      <Meter value={typeof value === 'number' ? value : 0} of={of} tone={tone} />
    ) : null;

  return (
    <>
      <div className="card-label">{label}</div>
      <div className="card-figure" data-size={size}>
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {note && <div className="card-note">{note}</div>}
      <div className="card-compare" data-empty={comparison === null || undefined}>
        {comparison}
      </div>
    </>
  );
}
