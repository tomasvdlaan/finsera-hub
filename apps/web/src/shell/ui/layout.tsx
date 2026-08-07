import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * How wide a page is allowed to be, decided by what kind of page it is.
 *
 * A single cap on `main` could only ever be wrong for one of them: 1600px is a hike across a
 * form and a cage around a five-column board. So the cap moves onto the page, and the page
 * says which kind it is.
 *
 * - `default` — a mixed page of panels and lists. Most things.
 * - `wide` — a page whose job is a table or a board. Uses the screen it is given.
 * - `read` — a document or a form. Capped at a comfortable measure, because a 1400px line of
 *   prose is unreadable however much room there is for it.
 */
export type PageWidth = 'default' | 'wide' | 'read';

/**
 * The page.
 *
 * A twelve-column grid, so a block can say it wants five columns instead of every block being
 * full-width and stacked. `container-type: inline-size` is on it rather than on the viewport
 * because two things change `main`'s width without touching the window — the assistant rail
 * and the board's preview panel — and a block that asked the viewport would get the wrong
 * answer in both.
 */
export function Page({
  width = 'default',
  children,
}: {
  width?: PageWidth;
  children: ReactNode;
}) {
  return (
    <div className="page" data-width={width}>
      {children}
    </div>
  );
}

/**
 * The top of a page: where you came from, what this is, and what you can do to it.
 *
 * Every page hand-rolled this, and they disagreed. List pages opened on an `<h1>` followed by
 * a muted paragraph; detail pages opened on a paragraph of `←` links and put the title
 * second; actions turned up in a `.row` below the fold on some pages and beside the title on
 * others. None of that was a decision — it was thirty separate authors of the same component.
 *
 * `meta` is for facts about the record (a status, a date, a client). `actions` is for verbs.
 * Keeping them apart is what stops a page header becoming a toolbar with a title in it.
 */
export function PageHeader({
  title,
  subtitle,
  back,
  meta,
  actions,
  tabs,
}: {
  title: ReactNode;
  /** One line on what this page is for. Not a paragraph — those belong in the body. */
  subtitle?: ReactNode;
  /** Where up is. A detail page almost always has one; a list page almost never does. */
  back?: { to: string; label: string };
  /** Facts about the thing: status, dates, who it belongs to. */
  meta?: ReactNode;
  /** Verbs. The primary one goes last, where the eye finishes. */
  actions?: ReactNode;
  /** Sub-navigation within this page, when it has modes rather than sub-pages. */
  tabs?: ReactNode;
}) {
  return (
    <header className="page-header">
      {back && (
        <Link to={back.to} className="page-back">
          <span aria-hidden="true">←</span> {back.label}
        </Link>
      )}

      <div className="page-header-row">
        <div className="page-header-title">
          <h1>{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>

      {meta && <div className="page-meta">{meta}</div>}
      {tabs && <nav className="page-tabs">{tabs}</nav>}
    </header>
  );
}

/**
 * A block on the page grid.
 *
 * `span` is in grid columns out of twelve. It collapses to full width below the container's
 * breakpoint rather than shrinking, because five columns of a 400px container is not a layout,
 * it is a column of single words.
 */
export function Block({
  span = 12,
  plane,
  className,
  children,
}: {
  span?: number;
  /** `2` lifts it. One per page — see the plane tokens for why that rule exists. */
  plane?: '2' | 'sunk';
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={className}
      data-span={span}
      data-plane={plane}
    >
      {children}
    </section>
  );
}
