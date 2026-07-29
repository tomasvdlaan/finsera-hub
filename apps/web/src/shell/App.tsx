import { useEffect, useState } from 'react';
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import type { CurrentUser } from '@platform/contracts';
import { api } from '../lib/api.js';
import { webModules } from '../modules/index.js';
import { Assistant } from './Assistant.js';
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
}

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

  /**
   * Where "/" goes.
   *
   * Falls back to the first registered route rather than to "/", because `<Navigate to="/">`
   * rendered at "/" is a redirect to itself — so a failed or empty `GET /core/navigation`
   * did not merely leave the sidebar blank, it hung the app on its own front page.
   */
  const home = nav[0]?.path ?? routes[0]?.path ?? null;

  return (
    <BrowserRouter>
      <RouteTitle nav={nav} />
      <div className="layout">
        <aside className="sidebar">
          <div className="brand">Finsera Platform</div>
          <nav>
            {nav.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                {item.label}
              </NavLink>
            ))}

            {/* Inside <nav>, finally. These two lived outside it, so `.sidebar nav a.active`
                could never match them — their active-state className has been dead code
                since it was written, and they rendered as loose blue anchors. */}
            <div className="sidebar-secondary">
              <NavLink
                to="/platform/modules"
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                Platform modules
              </NavLink>
              <NavLink
                to="/platform/settings"
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                Organisation
              </NavLink>
            </div>
          </nav>

          <button onClick={() => setAssistantOpen((o) => !o)} style={{ marginTop: '0.75rem' }}>
            {assistantOpen ? 'Hide assistant' : 'Ask assistant'}
          </button>

          <div className="sidebar-footer">
            {me && (
              <>
                <div>{me.displayName}</div>
                <div className="muted">{me.role}</div>
              </>
            )}
            <button onClick={logout} style={{ marginTop: '0.5rem' }}>
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
          <Routes>
            {home && <Route path="/" element={<Navigate to={home} replace />} />}
            {routes.map(({ path, Component }) => (
              <Route key={path} path={path} element={<Component />} />
            ))}
            <Route path="/platform/modules" element={<Modules />} />
            <Route path="/platform/settings" element={<Settings />} />
            <Route path="*" element={<NotFound home={home ?? '/platform/settings'} />} />
          </Routes>
        </main>

        {/*
          Mounted always, hidden when closed.

          It used to be `{assistantOpen && <Assistant/>}`, which unmounts the component on
          close and takes the turns and the conversationId with it — so "hide" was
          indistinguishable from "discard", and reopening started a new conversation with no
          way back to the old one. Keeping it mounted is the smallest fix that makes the
          panel behave like a panel.
        */}
        <Assistant hidden={!assistantOpen} onClose={() => setAssistantOpen(false)} />
      </div>
    </BrowserRouter>
  );
}
