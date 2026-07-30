import { useEffect, useState } from 'react';
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  Outlet,
  useLocation,
} from 'react-router-dom';
import type { CurrentUser } from '@platform/contracts';
import { api } from '../lib/api.js';
import { webModules } from '../modules/index.js';
import { Assistant } from './Assistant.js';
import { Icon } from './Icon.js';
import { LiveMeetingProvider } from './LiveMeeting.js';
import { LivePill } from './LivePill.js';
import { MeetingChatProvider } from './MeetingChat.js';
import { Modules } from './Modules.js';
import { Settings } from './Settings.js';
import { StatusBar } from './StatusBar.js';
import { DialogProvider } from './ui/Dialog.js';
import { ToastProvider } from './ui/Toast.js';
import { useDocumentTitle } from './useDocumentTitle.js';
import { AuthProvider, useAuth } from './AuthProvider.js';

interface NavItem {
  label: string;
  path: string;
  module: string;
  icon?: string;
  section?: string;
  /** Lower sorts first within a section. Ties fall back to the label. */
  order?: number;
  /** Routed and reachable, but reached from a hub rather than from the rail. */
  hidden?: boolean;
}

/**
 * The rail's sections, named here because they cross module boundaries.
 *
 * Money is billing plus two of sales plus reporting; Work is scrum plus meetings plus
 * portal. No per-module declaration can express that, so the shell owns the vocabulary and
 * a manifest only says which section it belongs in. `more` catches anything that declares
 * no section, so a module written before this existed still appears.
 */
const SECTIONS: Array<{ key: string; label: string | null }> = [
  // Ordered as a workday reads: what today needs, then the work, then the hours it took,
  // then who it was for, then the money, then the record. Work sat below Clients when this
  // was a finance tool; it is a productivity tool that also tracks time, so it moved up.
  { key: 'today', label: null },
  { key: 'work', label: 'Work' },
  { key: 'time', label: null },
  { key: 'clients', label: 'Clients' },
  { key: 'money', label: 'Money' },
  { key: 'record', label: 'Record' },
  { key: 'setup', label: 'Setup' },
  { key: 'more', label: 'More' },
];

/**
 * Destinations the shell owns outright.
 *
 * Today has no module behind it — it is composed from several — and the two settings pages
 * are shell routes. Declaring them here rather than inventing a manifest for the shell
 * keeps "a module self-registers" true, and keeps "the shell names no module" true too:
 * these name no module either.
 */
const SHELL_ITEMS: NavItem[] = [
  { label: 'Today', path: '/today', module: 'shell', icon: 'home', section: 'today', order: 1 },
  // "All work" rather than "Work": it sits in a section called Work, next to a page called
  // Board, and three of the four things in there are work. The name has to say which one.
  { label: 'All work', path: '/work', module: 'shell', icon: 'columns', section: 'work', order: 3 },
  { label: 'Money', path: '/money', module: 'shell', icon: 'receipt', section: 'money', order: 1 },
  { label: 'Organisation', path: '/platform/settings', module: 'shell', icon: 'settings', section: 'setup', order: 1 },
  { label: 'Platform modules', path: '/platform/modules', module: 'shell', icon: 'columns', section: 'setup', order: 3 },
];

export function App() {
  return (
    <AuthProvider>
      {/* Outside the router so a confirmation survives the navigation it may trigger. */}
      <ToastProvider>
        <DialogProvider>
          <Shell />
        </DialogProvider>
      </ToastProvider>
    </AuthProvider>
  );
}

/** Nothing matched. Says so, and offers the way back rather than leaving a dead end. */
function NotFound({ home }: { home: string }) {
  useDocumentTitle('Not found');
  return (
    <div>
      <h1>Not found</h1>
      <p className="muted">
        There is no page at this address. It may have been renamed, or the link that brought
        you here may be stale.
      </p>
      <p>
        <Link to={home}>Go back to the start</Link>
      </p>
    </div>
  );
}

/**
 * Names the tab after the current section.
 *
 * A fallback, not a replacement: a page that knows its own subject — an invoice number, a
 * client name — should call `useDocumentTitle` itself and win, because this only knows
 * which navigation entry the path starts with.
 */
function RouteTitle({ nav }: { nav: NavItem[] }) {
  const { pathname } = useLocation();
  const match = nav
    .filter((n) => pathname === n.path || pathname.startsWith(`${n.path}/`))
    // Longest prefix wins, so /sales/contracts beats /sales.
    .sort((a, b) => b.path.length - a.path.length)[0];
  useDocumentTitle(match?.label ?? null);
  return null;
}

/**
 * Layer 3 — the application shell.
 *
 * Navigation comes from the API, which assembles it from module manifests; routes come
 * from the frontend module registry. The shell names no module in either case, so
 * adding one touches its own folder plus a single line in modules/index.ts.
 */
function Shell() {
  const { user, loading, error: authError, login, logout } = useAuth();
  const [nav, setNav] = useState<NavItem[]>([]);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([api.get<NavItem[]>('/core/navigation'), api.get<CurrentUser>('/core/me')])
      .then(([n, m]) => {
        setNav(n);
        setMe(m);
      })
      .catch((e: Error) => setError(e.message));
  }, [user]);

  if (loading) return <div className="centered">Loading…</div>;

  if (!user) {
    return (
      <div className="centered">
        <h1>Finsera Platform</h1>
        <button onClick={login}>Sign in</button>
        {authError && <p className="error">Sign-in failed: {authError}</p>}
      </div>
    );
  }

  const routes = webModules.flatMap((m) => m.routes);
  const chromed = routes.filter((r) => r.chrome !== 'bare');
  const bare = routes.filter((r) => r.chrome === 'bare');

  /**
   * Where "/" goes.
   *
   * A destination that was chosen, rather than `nav[0].path` — which landed on the client
   * list only because CrmModule is registered first in app.module.ts. Today is a shell
   * route, so it resolves even when GET /core/navigation fails and the rail is empty.
   */
  const home = '/today';

  return (
    <BrowserRouter>
      <RouteTitle nav={nav} />
      {/*
        Above both layouts on purpose.

        A meeting has to outlive the page you started it from: the panel used to own the
        socket, and closing that socket from the audio source is how the server learns the
        meeting is over — so navigating away ended and finalised it. See LiveMeeting.tsx.
      */}
      <LiveMeetingProvider>
      <MeetingChatProvider>
      <Routes>
        {/*
          Two layouts, one router.

          Almost every page wants the rail, the status bar and the assistant. The meeting
          room wants the viewport: it puts notes, an AI rail and a live transcript on screen
          at once and needs the full height to do it, which is impossible inside a padded,
          max-width `<main>`. Layout routes are how react-router expresses that, and they
          cost less than the alternative — a page that hides the rail with CSS leaves it
          mounted and still consuming layout.
        */}
        <Route
          element={
            <ChromeLayout
              nav={nav}
              me={me}
              error={error}
              assistantOpen={assistantOpen}
              onToggleAssistant={() => setAssistantOpen((o) => !o)}
              onCloseAssistant={() => setAssistantOpen(false)}
              onLogout={logout}
            />
          }
        >
          <Route path="/" element={<Navigate to={home} replace />} />
          {chromed.map(({ path, Component }) => (
            <Route key={path} path={path} element={<Component />} />
          ))}
          <Route path="/platform/modules" element={<Modules />} />
          <Route path="/platform/settings" element={<Settings />} />
          <Route path="*" element={<NotFound home={home} />} />
        </Route>

        {bare.map(({ path, Component }) => (
          <Route key={path} path={path} element={<Component />} />
        ))}
      </Routes>
      </MeetingChatProvider>
      </LiveMeetingProvider>
    </BrowserRouter>
  );
}

/**
 * The ordinary chrome: rail, status bar, page, assistant.
 *
 * Declared at module level rather than inside Shell, because a component defined during
 * render is a new type on every render and React would remount its whole subtree — which
 * would take the assistant's conversation with it on every keystroke of shell state.
 *
 * The assistant is mounted here, so entering the meeting room does end the conversation.
 * That is the trade: the room has an AI rail of its own with the meeting as its context, and
 * carrying a second assistant into it would be two AI panels arguing over the same screen.
 */
function ChromeLayout({
  nav,
  me,
  error,
  assistantOpen,
  onToggleAssistant,
  onCloseAssistant,
  onLogout,
}: {
  nav: NavItem[];
  me: CurrentUser | null;
  error: string | null;
  assistantOpen: boolean;
  onToggleAssistant: () => void;
  onCloseAssistant: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">Finsera Platform</div>
        <nav>
          {SECTIONS.map(({ key, label }) => {
            /*
             * Sorted here as well as on the server.
             *
             * GET /core/navigation orders what the manifests declare, but the shell's own
             * entries are merged in afterwards and knew nothing about that order — so a shell
             * item always landed first in its section whatever it said. That is how "All work"
             * ended up above Meetings after Meetings was deliberately promoted.
             */
            const items = [...SHELL_ITEMS, ...nav]
              .filter((i) => (i.section ?? 'more') === key && !i.hidden)
              .sort((a, b) => {
                const byOrder = (a.order ?? 100) - (b.order ?? 100);
                return byOrder !== 0 ? byOrder : a.label.localeCompare(b.label);
              });
            if (items.length === 0) return null;
            return (
              <div key={key} className="nav-section">
                {label && <div className="nav-section-label">{label}</div>}
                {items.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={({ isActive }) => (isActive ? 'active' : '')}
                  >
                    <Icon name={item.icon} />
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <button onClick={onToggleAssistant} style={{ marginTop: 'var(--space-3)' }}>
          {assistantOpen ? 'Hide assistant' : 'Ask assistant'}
        </button>

        <div className="sidebar-footer">
          {me && (
            <>
              <div>{me.displayName}</div>
              <div className="muted">{me.role}</div>
            </>
          )}
          <button onClick={onLogout} style={{ marginTop: 'var(--space-2)' }}>
            Sign out
          </button>
        </div>
      </aside>

      <main>
        {error && (
          <p className="error">
            API error: {error}
            {nav.length === 0 && ' — navigation could not be loaded, so the sidebar is empty.'}
          </p>
        )}
        <StatusBar />
        <LivePill />
        <Outlet />
      </main>

      {/*
        Mounted always, hidden when closed.

        It used to be `{assistantOpen && <Assistant/>}`, which unmounts the component on
        close and takes the turns and the conversationId with it — so "hide" was
        indistinguishable from "discard", and reopening started a new conversation with no
        way back to the old one. Keeping it mounted is the smallest fix that makes the
        panel behave like a panel.
      */}
      <Assistant hidden={!assistantOpen} onClose={onCloseAssistant} />
    </div>
  );
}
