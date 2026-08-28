import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import type { CurrentUser } from '@platform/contracts';
import { Count } from './ui/primitives.js';
import { elapsed, useRunningTimer } from './useRunningTimer.js';
import { useCan } from './useCan.js';
import type { NavItem } from '../modules/types.js';

export interface NavCounts {
  /** Things wanting a decision. Shown on Inbox, in the alarming tone. */
  attention?: number;
}

/**
 * The anchors, and how many of them there are allowed to be.
 *
 * Nine. Not because nine is a magic number but because a horizontal pill has a width, and
 * the moment the anchors need two rows or a scrollbar it has stopped being a glanceable set
 * and become a menu. Everything else in the product is reachable — by ⌘K, which reaches every
 * page *and* every record, and by the tab strip on the section it belongs to.
 *
 * So the test for a ninth anchor is not "is this page important", it is "do I go here without
 * first going somewhere else". Settings fails it and lives under the avatar. Rate cards fails
 * it and is a tab on Money. Sprints and flow fail it and are tabs on Board.
 *
 * Agenda passes it and is the ninth, so the number above is now nine and the paragraph above
 * is owed an answer rather than a quiet edit. Two things changed. The pill wraps now instead
 * of scrolling — it used to clip its last anchor below 1280px with the scrollbar suppressed,
 * so "eight" was really "as many as fit, and silence about the rest" — and a calendar is the
 * one destination nobody reaches via somewhere else, because the question it answers ("what is
 * today") is the one you ask before you know where you are going.
 *
 * That is an argument for nine, not for an open-ended list. The set is still a set, and the
 * honest next step if a tenth is proposed is that two of these merge: Time and Agenda are
 * closer to one question than either is to Board.
 */
const ANCHORS: Array<{ label: string; path: string }> = [
  { label: 'Today', path: '/today' },
  { label: 'Inbox', path: '/insights' },
  { label: 'Agenda', path: '/agenda' },
  { label: 'Board', path: '/board' },
  { label: 'Time', path: '/time' },
  { label: 'Clients', path: '/clients' },
  { label: 'Money', path: '/money' },
  { label: 'Meetings', path: '/meetings' },
  { label: 'Docs', path: '/docs' },
];

/**
 * The bar.
 *
 * It replaced a 232px left rail, and the width is only half the reason. The rail was an index
 * — every destination listed, because scanning it was the only way to find anything — and it
 * kept growing because there was no cost to adding a row. A pill has a cost, visibly, which
 * is the property that keeps navigation honest.
 *
 * The clock lives here rather than in a rail widget for the same reason it lived in the rail:
 * it has to be visible from every page, and for a business that bills by the hour the gap
 * between "I started working" and "I remembered to start the clock" is where money goes
 * missing. Here it is also *next to* where you are, so starting one is a glance away.
 */
export function TopNav({
  nav,
  counts,
  me,
  fallbackName,
  onSearch,
  onLogout,
}: {
  /** From the manifests. Used to hide an anchor whose module is not installed. */
  nav: NavItem[];
  counts: NavCounts;
  me: CurrentUser | null;
  /**
   * Who the token says you are, for when the API will not say.
   *
   * `me` comes from `/core/me`, and gating the avatar on it meant that any failure of that
   * one call — an expired token, a deactivated account, the API being down — removed the
   * only route to Sign out along with it. The session was then unreachable from the UI and
   * could only be cleared through developer tools, which is not a recovery path.
   *
   * This comes from the token already in hand, so it survives every one of those.
   */
  fallbackName?: string;
  onSearch: () => void;
  onLogout: () => void;
}) {
  const navigate = useNavigate();
  const { can } = useCan();
  const { running, busy, stop } = useRunningTimer();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  /* The API's answer when there is one, the token's when there is not. */
  const name = me?.displayName ?? fallbackName;

  /*
   * Close on a click anywhere else, and on Escape.
   *
   * A menu that only closes by clicking what opened it is a menu people leave open and then
   * click through by accident — which for the one destructive item in here is signing out.
   */
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [menu]);

  /*
   * An anchor survives if the manifests know its path, or if the shell owns it outright.
   *
   * Today, Inbox and Money are composed from several modules and belong to no single one, so
   * they can never appear in `nav` — but a module that is genuinely absent should not leave a
   * pill anchor pointing at a page that does not exist.
   */
  const OWNED = new Set(['/today', '/insights', '/money', '/agenda']);
  const known = new Set(nav.map((n) => n.path));
  const anchors = ANCHORS.filter((a) => OWNED.has(a.path) || known.has(a.path));

  return (
    <header className="topbar">
      <div className="topbar-brand">
        {/* Three ascending bars in the brand green: the shortest honest statement of what
            this platform is for. Inline so it inherits the accent and needs no asset. */}
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="2" y="14" width="5" height="8" rx="1.5" />
          <rect x="9.5" y="8" width="5" height="14" rx="1.5" />
          <rect x="17" y="2" width="5" height="20" rx="1.5" />
        </svg>
        <span>Finsera</span>
      </div>

      <nav className="topbar-pill" aria-label="Sections">
        {anchors.map((a) => (
          <NavLink
            key={a.path}
            to={a.path}
            className={({ isActive }) => (isActive ? 'anchor on' : 'anchor')}
          >
            {a.label}
            {a.path === '/insights' && (counts.attention ?? 0) > 0 && (
              <Count value={counts.attention ?? 0} tone="danger" />
            )}
          </NavLink>
        ))}
      </nav>

      <div className="topbar-right">
        {/*
          The clock, in two states and never absent.

          A control that disappears when it is idle cannot be found when you need it, and
          "where do I start a timer" is the question that costs billable hours. Running, it
          is the loudest accent on the screen — which is the one thing the accent is for.
        */}
        {running ? (
          <div className="clock live">
            <button type="button" onClick={() => navigate('/time')} className="clock-open">
              <i aria-hidden="true" />
              <span className="clock-time">{elapsed(running.startedAt)}</span>
              <span className="clock-what">{running.projectName}</span>
            </button>
            {/*
              Stopping is one click, from anywhere.

              The rail widget this replaced could stop a timer without navigating, and losing
              that would be the expensive kind of regression: the gap between finishing and
              remembering to stop is billed to somebody, and every extra step widens it.
            */}
            <button
              type="button"
              className="clock-stop"
              onClick={() => void stop()}
              disabled={busy}
              aria-label="Stop the timer"
            >
              <span aria-hidden="true">■</span>
            </button>
          </div>
        ) : (
          <button type="button" className="clock" onClick={() => navigate('/time')}>
            <span className="clock-what">Start a timer</span>
          </button>
        )}

        <button type="button" className="round" onClick={onSearch} aria-label="Search">
          <span aria-hidden="true">⌕</span>
          <kbd>⌘K</kbd>
        </button>

        <button
          type="button"
          className="round"
          onClick={() => navigate('/assistant')}
          aria-label="Assistant"
        >
          <span aria-hidden="true">✦</span>
        </button>

        {/*
          Always, whenever there is a session at all.

          Sign out is the one control that has to work when everything else has failed —
          it is the way out of a session the server no longer accepts, and it was the first
          thing to disappear when that happened.
        */}
        {name && (
          <div className="me" ref={menuRef}>
            <button
              type="button"
              className="avatar"
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu((o) => !o)}
            >
              {name.slice(0, 1).toUpperCase()}
            </button>
            {menu && (
              <div className="me-menu" role="menu">
                <div className="me-who">
                  <b>{name}</b>
                  {/*
                    The role comes from the API, so when the API is refusing us there is no
                    role to state. Saying so is better than showing a blank line where one
                    was: it explains why the pages behind this menu are empty.
                  */}
                  <span>{me ? me.role : 'Not signed in to the platform'}</span>
                </div>
                {/*
                  The settings pages all read from the API, so they are dead ends while it
                  is refusing us. Offering them would be offering three more error screens.
                */}
                {me && (
                  <>
                    <NavLink to="/settings" role="menuitem" onClick={() => setMenu(false)}>
                      Organisation
                    </NavLink>
                    <NavLink to="/settings/people" role="menuitem" onClick={() => setMenu(false)}>
                      People
                    </NavLink>
                    {can('core.costs.read') && (
                      <NavLink to="/settings/costs" role="menuitem" onClick={() => setMenu(false)}>
                        Platform costs
                      </NavLink>
                    )}
                    <NavLink to="/settings/modules" role="menuitem" onClick={() => setMenu(false)}>
                      Platform modules
                    </NavLink>
                  </>
                )}
                <button type="button" role="menuitem" onClick={onLogout}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
