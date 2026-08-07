import type { ReactNode } from 'react';

/**
 * How a cell should be read, which decides how it is set.
 *
 * `num` is the one that matters: figures right-align and use tabular figures, so a column of
 * amounts lines up on the decimal and can be scanned rather than read. Proportional digits in
 * a money column are the single most common reason a table looks unfinished.
 *
 * `action` replaces the nine `style={{ width: '1%' }}` hacks — the trick where a cell is given
 * an impossible width so the browser shrinks it to its content. It worked; it just meant every
 * table carried an inline style explaining nothing.
 */
export type Align = 'text' | 'num' | 'action';

export interface Column<Row> {
  key: string;
  /** Omitted for an action column, which has nothing worth announcing. */
  header?: ReactNode;
  align?: Align;
  /** Hide below this container width, for columns that are context rather than content. */
  hideBelow?: 'sm' | 'md';
  render: (row: Row) => ReactNode;
}

/**
 * A table that looks like somebody meant it.
 *
 * Fifteen files emitted a bare `<table>` and there was no `td` or `th` styling anywhere in
 * 4,500 lines of CSS, so every one of them rendered at browser defaults — the strongest
 * "unfinished" signal an interface can send, and three of the five blocks on the dashboard
 * were doing it.
 *
 * Still a real `<table>`. The app already emits them, screen readers already understand them,
 * and a grid of divs pretending to be one is a lot of work to arrive back where we started.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  empty,
  loading,
  caption,
}: {
  columns: Array<Column<Row>>;
  rows: Row[];
  rowKey: (row: Row) => string;
  /** What to say when there is nothing — a sentence, not a shrug. */
  empty?: ReactNode;
  loading?: boolean;
  caption?: string;
}) {
  if (loading) {
    return (
      <div className="table-wrap">
        <table className="data-table">
          {caption && <caption className="sr-only">{caption}</caption>}
          <Head columns={columns} />
          <tbody>
            {/* Rows rather than a spinner: the page keeps its shape while it fills, so
                nothing jumps when the data lands. */}
            {[0, 1, 2].map((i) => (
              <tr key={i} aria-hidden="true">
                {columns.map((c) => (
                  <td key={c.key} data-align={c.align ?? 'text'}>
                    <span className="skeleton" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (rows.length === 0 && empty) return <div className="table-empty">{empty}</div>;

  return (
    <div className="table-wrap">
      <table className="data-table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <Head columns={columns} />
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} data-align={c.align ?? 'text'} data-hide={c.hideBelow}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Head<Row>({ columns }: { columns: Array<Column<Row>> }) {
  // A head of nothing but action columns is a grey bar with no words in it.
  if (!columns.some((c) => c.header)) return null;
  return (
    <thead>
      <tr>
        {columns.map((c) => (
          <th key={c.key} scope="col" data-align={c.align ?? 'text'} data-hide={c.hideBelow}>
            {c.header}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/**
 * A number, and the word for what it is.
 *
 * There were two of these, with incompatible props — one in `shell/ui` and a second declared
 * privately inside the reporting page with inline `fontSize` styles. This is the one.
 *
 * The label is deliberately smaller than the figure. That inversion is most of what separates
 * a dashboard from a form: a heading that happens to be numeric reads as a heading, and a
 * figure with a whisper above it reads as a measurement.
 */
export function StatTile({
  label,
  value,
  unit,
  hint,
  tone,
  emphasis,
  wrap,
}: {
  label: string;
  value: string | number;
  /** Set beside the figure at label size — "h", "€", "cards". */
  unit?: string;
  hint?: ReactNode;
  tone?: 'urgent' | 'ok';
  /** The one figure a page is about, if it has one. */
  emphasis?: 'hero';
  /**
   * Wrap the tile in a link.
   *
   * A function rather than an element, because an element would have to be handed the body as
   * children and there is no way to type "an element I will put my content inside" — the
   * previous shape took a `ReactNode` and rendered it *instead of* the tile, so a caller who
   * passed a link got an empty link and lost the number. This file stays free of the router
   * either way, which is the point.
   */
  wrap?: (body: ReactNode) => ReactNode;
}) {
  /*
   * Zero is quiet.
   *
   * "Overdue: 0" is good news, and rendering it in the same weight as "Overdue: 4" makes a
   * clean board look as alarming as a bad one. The tone only applies when there is something
   * to be alarmed about.
   */
  const zero = value === 0 || value === '0';

  const body = (
    <>
      <div className="stat-label">{label}</div>
      <div className="stat-figure" data-tone={zero ? undefined : tone} data-emphasis={emphasis}>
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      {hint && <div className="stat-hint">{hint}</div>}
    </>
  );

  return (
    <div className="stat" data-zero={zero || undefined}>
      {wrap ? wrap(body) : body}
    </div>
  );
}

/** A row of tiles. The grid the dashboard's tiles were missing when they stacked. */
export function MetricRow({ children }: { children: ReactNode }) {
  return <div className="stat-row">{children}</div>;
}

/**
 * A placeholder with the shape of the thing that is coming.
 *
 * Loading was `<p className="muted">Loading…</p>`, hand-written in every module, which tells
 * the reader nothing about what is about to appear and moves the whole page when it does.
 */
export function Skeleton({ width = '100%', height }: { width?: string; height?: string }) {
  return <span className="skeleton" style={{ width, height }} />;
}
