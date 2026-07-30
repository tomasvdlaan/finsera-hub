import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Icon } from './Icon.js';
import { Count } from './ui/primitives.js';
import { TimerWidget } from './TimerWidget.js';
import type { NavItem } from '../modules/types.js';

/**
 * How the seven declared sections become three visual blocks.
 *
 * The manifests group navigation by subject — today, work, time, clients, money, record,
 * setup — which is the right way to *declare* it and the wrong way to draw it. Four of those
 * seven held a single item, so the labels cost more rows than they saved: fourteen
 * destinations rendered as twenty lines, and the eye had to read a heading to find out that
 * the thing under it was "Timesheet".
 *
 * Blocks are ordered by how often you go there rather than by what kind of thing it is, and
 * only the last one is labelled — because it is the only one that is collapsed, and a
 * collapsed group is the one case where you cannot see what is inside.
 */
const BLOCKS: Array<{ sections: string[]; label?: string; collapsed?: boolean }> = [
  { sections: ['today', 'work', 'time'] },
  { sections: ['clients', 'money', 'record'] },
  { sections: ['setup', 'more'], label: 'Settings', collapsed: true },
];

export interface SidebarCounts {
  /** Things wanting a decision. Shown on Needs attention, in the alarming tone. */
  attention?: number;
  /** Client requests waiting on you. */
  requests?: number;
}

/**
 * The rail.
 *
 * Its job changed when the command bar arrived. It used to be an index — every page listed,
 * because scanning it was the only way to find anything — and it was crowded for exactly that
 * reason. ⌘K now reaches every page *and* every record, so nothing becomes unreachable by
 * being left off. What stays is what you go to daily, in the order you go to it.
 *
 * Two things went with the old rail. "Ask assistant" opened a panel that ⌘K replaced, and it
 * was the only button competing with the navigation for attention. And the group labels went,
 * for the reason in BLOCKS above.
 */
export function Sidebar({
  nav,
  shellItems,
  counts,
  me,
  onSearch,
  onOpenAssistant,
  onLogout,
}: {
  nav: NavItem[];
  shellItems: NavItem[];
  counts: SidebarCounts;
  me: { displayName: string; role: string } | null;
  onSearch: () => void;
  onOpenAssistant: () => void;
  onLogout: () => void;
}) {
  const [openSettings, setOpenSettings] = useState(false);
  const [openMenu, setOpenMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  /*
   * Close on a click anywhere else, and on Escape.
   *
   * A menu that only closes by clicking the thing that opened it is a menu people leave open
   * and then click through by accident — which for the one item in here is signing out.
   */
  useEffect(() => {
    if (!openMenu) return;
    const away = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpenMenu(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [openMenu]);

  /*
   * Sorted here as well as on the server.
   *
   * GET /core/navigation orders what the manifests declare, but the shell's own entries are
   * merged in afterwards and knew nothing about that order — so a shell item always landed
   * first in its section whatever it said. That is how "All work" ended up above Meetings
   * after Meetings was deliberately promoted.
   */
  const itemsIn = (sections: string[]) =>
    [...shellItems, ...nav]
      .filter((i) => sections.includes(i.section ?? 'more') && !i.hidden)
      .sort((a, b) => {
        /*
         * Section first, then the order declared within it.
         *
         * Merging several sections into one block flattens them, and sorting the result by
         * `order` alone interleaves them — every section has an item at order 1, so Today,
         * Meetings and Timesheet all claimed the top and landed in whatever order the API
         * happened to return. The block still reads as one list; the sections inside it keep
         * the sequence they were declared in.
         */
        const bySection =
          sections.indexOf(a.section ?? 'more') - sections.indexOf(b.section ?? 'more');
        if (bySection !== 0) return bySection;
        const byOrder = (a.order ?? 100) - (b.order ?? 100);
        return byOrder !== 0 ? byOrder : a.label.localeCompare(b.label);
      });

  const countFor = (path: string) => {
    if (path === '/insights') return { value: counts.attention ?? 0, tone: 'danger' as const };
    if (path === '/portal/requests') return { value: counts.requests ?? 0, tone: 'neutral' as const };
    return null;
  };

  const row = (item: NavItem) => {
    const c = countFor(item.path);
    return (
      <NavLink
        key={item.path}
        to={item.path}
        className={({ isActive }) => (isActive ? 'nav-row active' : 'nav-row')}
      >
        <Icon name={item.icon} />
        <span className="nav-label">{item.label}</span>
        {c && <Count value={c.value} tone={c.tone} />}
      </NavLink>
    );
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        {/*
          Three ascending bars in the brand green: the shortest honest statement of what this
          platform is for. Inline SVG so it inherits the accent and needs no asset pipeline.
        */}
        <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="2" y="14" width="5" height="8" rx="1.5" />
          <rect x="9.5" y="8" width="5" height="14" rx="1.5" />
          <rect x="17" y="2" width="5" height="20" rx="1.5" />
        </svg>
        <span className="brand-name">
          Finsera<span className="brand-suffix">Platform</span>
        </span>
      </div>

      {/*
        The command bar, made visible.

        ⌘K is only a feature for people who know it exists, and a keyboard shortcut nobody
        told you about is indistinguishable from no feature at all. This is the same overlay,
        with its shortcut written on it.
      */}
      <button type="button" className="nav-search" onClick={onSearch}>
        <Icon name="search" />
        <span>Search</span>
        <kbd>⌘K</kbd>
      </button>

      <nav>
        {BLOCKS.map((block, i) => {
          const items = itemsIn(block.sections);
          if (items.length === 0) return null;

          if (!block.collapsed) {
            return (
              <div key={i} className="nav-block">
                {items.map(row)}
              </div>
            );
          }

          return (
            <div key={i} className="nav-block nav-block-collapsible">
              <button
                type="button"
                className="nav-row nav-toggle"
                aria-expanded={openSettings}
                onClick={() => setOpenSettings((o) => !o)}
              >
                <Icon name="settings" />
                <span className="nav-label">{block.label}</span>
                <span className={openSettings ? 'nav-chevron open' : 'nav-chevron'} aria-hidden="true">
                  ⌄
                </span>
              </button>
              {/* The guide line is the affordance: it says these belong to the thing above. */}
              {openSettings && <div className="nav-children">{items.map(row)}</div>}
            </div>
          );
        })}
      </nav>

      {/*
        The assistant panel, which ⌘K does not replace.
        
        Asking a one-off question is now a keystroke, and that covers most of it — but the
        panel holds the *thread*, and a follow-up like "and what did they say about the second
        one?" needs somewhere that remembers the first. Removing the old button without this
        left the panel mounted and unreachable, which is worse than either keeping or deleting
        it. In the footer rather than the navigation: it is a tool, not a destination.
      */}
      {/*
        The clock lives with the navigation, not above the page.
        
        It was a banner that could stop a timer and never start one — so starting meant going
        to the timesheet, picking a project and finding the button. For a business that bills
        by the hour that gap is where hours go missing.
      */}
      <div className="sidebar-timer">
        <TimerWidget />
      </div>

      <div className="sidebar-footer">
        <button type="button" className="nav-row nav-assistant" onClick={onOpenAssistant}>
          <span className="nav-glyph" aria-hidden="true">
            ✦
          </span>
          <span className="nav-label">Assistant</span>
        </button>
        {/*
          Signing out is behind the name rather than beside it.
          
          It was a button of its own in the footer, which gave the least frequent action in
          the whole application the same standing as the navigation above it — and put it one
          stray click from whoever is working. It is where every other product keeps it now:
          under your own name, which is the only thing you would click looking for it.
        */}
        {me && (
          <div className="nav-me-menu" ref={menuRef}>
            <button
              type="button"
              className="nav-me"
              aria-haspopup="menu"
              aria-expanded={openMenu}
              onClick={() => setOpenMenu((o) => !o)}
            >
              <span className="nav-avatar" aria-hidden="true">
                {me.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="nav-me-text">
                <span className="nav-me-name">{me.displayName}</span>
                <span className="nav-me-role">{me.role}</span>
              </span>
              <span className="nav-chevron" aria-hidden="true">
                ⌄
              </span>
            </button>
            {openMenu && (
              <div className="nav-menu" role="menu">
                <button type="button" role="menuitem" className="nav-menu-item" onClick={onLogout}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
