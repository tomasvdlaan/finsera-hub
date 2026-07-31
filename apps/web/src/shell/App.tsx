import { useEffect, useState } from 'react';
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  Outlet,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import type { CurrentUser } from '@platform/contracts';
import { api } from '../lib/api.js';
import { webModules } from '../modules/index.js';
import type { NavItem } from '../modules/types.js';
import { AssistantPage } from './AssistantPage.js';
import { StarredAnswers } from './StarredAnswers.js';
import { CommandBar } from './CommandBar.js';
import { Sidebar, type SidebarCounts } from './Sidebar.js';
import { LiveMeetingProvider } from './LiveMeeting.js';
import { RunningTimerProvider } from './useRunningTimer.js';
import { LivePill } from './LivePill.js';
import { MeetingChatProvider } from './MeetingChat.js';
import { Modules } from './Modules.js';
import { Settings } from './Settings.js';
import { DialogProvider } from './ui/Dialog.js';
import { ToastProvider } from './ui/Toast.js';
import { useDocumentTitle } from './useDocumentTitle.js';
import { AuthProvider, useAuth } from './AuthProvider.js';


/**
 * The rail's sections, named here because they cross module boundaries.
 *
 * Money is billing plus two of sales plus reporting; Work is scrum plus meetings plus
 * portal. No per-module declaration can express that, so the shell owns the vocabulary and
 * a manifest only says which section it belongs in. `more` catches anything that declares
 * no section, so a module written before this existed still appears.
 */

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
  const [searchOpen, setSearchOpen] = useState(false);
  const [counts, setCounts] = useState<SidebarCounts>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([api.get<NavItem[]>('/core/navigation'), api.get<CurrentUser>('/core/me')])
      .then(([n, m]) => {
        setNav(n);
        setMe(m);
      })
      .catch((e: Error) => setError(e.message));

    /*
     * Counts for the rail, and failing quietly on purpose.
     *
     * A badge is an ornament on navigation that has to work — so if the insights sweep is
     * unavailable the rail renders without the number rather than not at all.
     */
    api
      .get<Array<{ status?: string }>>('/insights?status=open')
      .then((rows) => setCounts((c) => ({ ...c, attention: rows.length })))
      .catch(() => undefined);
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
      {/* Above the router: the clock has to survive navigation, and the rail and the tracker
          page must be looking at the same one. */}
      <RunningTimerProvider>
      {/*
        Above both layouts, like the live meeting and for a related reason: it has to be
        reachable from the meeting room, which renders outside the ordinary chrome and is
        exactly where looking something up without losing your place matters most.
      */}
      <CommandBar
        nav={[...SHELL_ITEMS, ...nav]}
        me={me}
        open={searchOpen}
        onOpenChange={setSearchOpen}
      />
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
              counts={counts}
              onSearch={() => setSearchOpen(true)}
              error={error}
              onLogout={logout}
            />
          }
        >
          <Route path="/" element={<Navigate to={home} replace />} />
          {chromed.map(({ path, Component }) => (
            <Route key={path} path={path} element={<Component />} />
          ))}
          <Route path="/assistant" element={<AssistantPage />} />
          {/* Before the :id route, or "starred" is read as a conversation id. */}
          <Route path="/assistant/starred" element={<StarredAnswers />} />
          <Route path="/assistant/:id" element={<AssistantPage />} />
          <Route path="/platform/modules" element={<Modules />} />
          <Route path="/platform/settings" element={<Settings />} />
          <Route path="*" element={<NotFound home={home} />} />
        </Route>

        {bare.map(({ path, Component }) => (
          <Route key={path} path={path} element={<Component />} />
        ))}
      </Routes>
      </RunningTimerProvider>
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
 * The assistant used to be a panel mounted here. It is a page now — /assistant — because a
 * conversation with history, entity cards and a thread wants room, and because a panel that
 * only existed inside this layout could never be reached from the meeting room.
 */
function ChromeLayout({
  nav,
  me,
  counts,
  error,
  onSearch,
  onLogout,
}: {
  nav: NavItem[];
  me: CurrentUser | null;
  counts: SidebarCounts;
  error: string | null;
  onSearch: () => void;
  onLogout: () => void;
}) {
  const navigate = useNavigate();
  return (
    <div className="layout">
      <Sidebar
        nav={nav}
        shellItems={SHELL_ITEMS}
        counts={counts}
        me={me}
        onSearch={onSearch}
        onOpenAssistant={() => navigate('/assistant')}
        onLogout={onLogout}
      />

      <main>
        {error && (
          <p className="error">
            API error: {error}
            {nav.length === 0 && ' — navigation could not be loaded, so the sidebar is empty.'}
          </p>
        )}
        <LivePill />
        <Outlet />
      </main>

    </div>
  );
}
