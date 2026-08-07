import { Navigate, useLocation } from 'react-router-dom';

/**
 * Where the old addresses went.
 *
 * The URLs were named after the module that happened to own the code — `/crm/clients`,
 * `/scrum/tasks/:id`, `/billing` — which is an implementation detail the person typing the
 * address has no reason to know. A client is a client whether or not CRM is the module that
 * stores it.
 *
 * The old ones cannot simply stop working. `core.entities.url_path` is a denormalised string
 * written at registration and read by search, the timeline, the link picker and every assistant
 * citation; a migration rewrote the rows that exist, but the answers the assistant has already
 * given are stored text, and so is anything anyone has bookmarked or pasted into a message.
 * Those have to keep landing somewhere.
 *
 * Longest prefix first: `/sales/contracts` must be recognised before `/sales`.
 */
export const MOVED: ReadonlyArray<readonly [string, string]> = [
  ['/crm/clients', '/clients'],
  ['/crm/projects', '/projects'],
  ['/scrum/tasks', '/tasks'],
  ['/scrum/flow', '/board/flow'],
  ['/scrum/settings', '/board/settings'],
  ['/scrum/sprints', '/board/sprints'],
  ['/scrum', '/board'],
  ['/sales/contracts', '/money/contracts'],
  ['/sales/quotes', '/money/quotes'],
  ['/sales/rate-cards', '/money/rate-cards'],
  ['/sales', '/money/quotes'],
  ['/billing/invoices', '/money/invoices'],
  ['/billing', '/money/invoices'],
  ['/platform/settings', '/settings'],
  ['/platform/modules', '/settings/modules'],
  // An hour was never readable on a page of its own; it is read in its day.
  ['/time/entries', '/time'],
  ['/time/day', '/time'],
];

/** The old prefixes, deduplicated to their first segment — one catch-all route each. */
export const MOVED_ROOTS = [...new Set(MOVED.map(([from]) => from.split('/')[1]))];

/** `/crm/clients/abc?tab=notes` → `/clients/abc?tab=notes`, or null if nothing moved. */
export function relocate(pathname: string): string | null {
  for (const [from, to] of MOVED) {
    if (pathname === from || pathname.startsWith(`${from}/`)) return to + pathname.slice(from.length);
  }
  return null;
}

/**
 * Send an old address to its new one, keeping the query string.
 *
 * `replace` because the old URL should not sit in history: pressing Back from the page you
 * landed on would bounce you straight forward again.
 */
export function Moved() {
  const { pathname, search } = useLocation();
  const to = relocate(pathname);
  // Nothing matched — fall through to whatever the router would otherwise have shown, which
  // is the not-found page. A redirect to itself would loop.
  if (!to) return <Navigate to="/" replace />;
  return <Navigate to={to + search} replace />;
}
