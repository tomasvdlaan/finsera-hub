import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Count } from './ui/primitives.js';
import { Icon } from './Icon.js';
import { visibleAnchors, type NavCounts } from './TopNav.js';
import type { NavItem } from '../modules/types.js';

/**
 * Which anchors earn a thumb slot on a phone.
 *
 * Four, because five slots is what a bar holds at 360px before the labels truncate, and the
 * fifth is More. These are the four the owner said they open on a phone — the queue of things
 * waiting, what is on today, a client looked up in a corridor, and the notes from the meeting
 * just left. Everything else in the pill is in the More sheet, one tap further, never hidden.
 */
const TABS = ['/insights', '/agenda', '/clients', '/meetings'];

/**
 * The phone's navigation: a bar under the thumb, and a sheet for the rest.
 *
 * The pill in the top bar wrapped to three rows at 390px and took a third of the screen on
 * every page. It is the same set of destinations here, filtered by the same function, so a
 * module that is not installed is missing from both or neither.
 */
export function BottomNav({ nav, counts }: { nav: NavItem[]; counts: NavCounts }) {
  const { pathname } = useLocation();
  const [more, setMore] = useState(false);

  const anchors = visibleAnchors(nav);
  const tabs = anchors.filter((a) => TABS.includes(a.path));
  const rest = anchors.filter((a) => !TABS.includes(a.path));
  const under = (path: string) => pathname === path || pathname.startsWith(`${path}/`);
  const moreActive = rest.some((a) => under(a.path));

  // Arriving somewhere closes the sheet — including arriving by the back button.
  useEffect(() => setMore(false), [pathname]);

  useEffect(() => {
    if (!more) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setMore(false);
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [more]);

  const attention = counts.attention ?? 0;

  return (
    <>
      {more && (
        <div className="more-scrim" onClick={() => setMore(false)}>
          <div
            className="more-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="All sections"
            onClick={(e) => e.stopPropagation()}
          >
            <i className="more-grip" aria-hidden="true" />
            <nav className="more-grid" aria-label="More sections">
              {rest.map((a) => (
                <NavLink
                  key={a.path}
                  to={a.path}
                  className={({ isActive }) => (isActive ? 'more-item on' : 'more-item')}
                >
                  <Icon name={a.icon} size={22} />
                  <span>{a.label}</span>
                </NavLink>
              ))}
            </nav>
          </div>
        </div>
      )}

      <nav className="bottomnav" aria-label="Sections">
        {tabs.map((a) => (
          <NavLink
            key={a.path}
            to={a.path}
            className={({ isActive }) => (isActive ? 'tab on' : 'tab')}
          >
            <span className="tab-glyph">
              <Icon name={a.icon} size={22} />
              {a.path === '/insights' && attention > 0 && <Count value={attention} tone="danger" />}
            </span>
            <span className="tab-label">{a.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className={more || moreActive ? 'tab on' : 'tab'}
          aria-expanded={more}
          aria-haspopup="dialog"
          onClick={() => setMore((o) => !o)}
        >
          <span className="tab-glyph">
            <Icon name="grid" size={22} />
          </span>
          <span className="tab-label">More</span>
        </button>
      </nav>
    </>
  );
}
