import { SubNav } from '../../shell/ui/layout.js';

/**
 * The four ways of looking at one board.
 *
 * Carried in the query string rather than the path, because every one of these pages is about
 * a *project* and losing which project you were looking at is the one thing a tab strip must
 * never do. `/board/flow` with no project is a page that has to ask you again.
 *
 * These were four muted links in a row at the top of the board and nowhere at all on the other
 * three, so once you left the board there was no way back except the browser. A strip that
 * renders identically on all four is what makes them one place with modes.
 */
export function BoardTabs({ projectId }: { projectId: string }) {
  const q = projectId ? `?projectId=${projectId}` : '';
  return (
    <SubNav
      items={[
        { label: 'Board', to: `/board${q}` },
        { label: 'Flow', to: `/board/flow${q}` },
        { label: 'Sprints', to: `/board/sprints${q}` },
        { label: 'Columns', to: `/board/settings${q}` },
      ]}
    />
  );
}
