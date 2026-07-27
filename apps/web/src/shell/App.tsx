import { useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import type { CurrentUser } from '@platform/contracts';
import { api } from '../lib/api.js';
import { webModules } from '../modules/index.js';
import { Assistant } from './Assistant.js';
import { Modules } from './Modules.js';
import { AuthProvider, useAuth } from './AuthProvider.js';

interface NavItem {
  label: string;
  path: string;
  module: string;
}

export function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
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
  const home = nav[0]?.path ?? '/';

  return (
    <BrowserRouter>
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
          </nav>
          <button onClick={() => setAssistantOpen((o) => !o)} style={{ marginTop: '0.75rem' }}>
            {assistantOpen ? 'Hide assistant' : 'Ask assistant'}
          </button>

          <NavLink
            to="/platform/modules"
            className={({ isActive }) => (isActive ? 'active' : '')}
            style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}
          >
            Platform modules
          </NavLink>

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
          {error && <p className="error">API error: {error}</p>}
          <Routes>
            <Route path="/" element={<Navigate to={home} replace />} />
            {routes.map(({ path, Component }) => (
              <Route key={path} path={path} element={<Component />} />
            ))}
            <Route path="/platform/modules" element={<Modules />} />
            <Route path="*" element={<p className="muted">Not found.</p>} />
          </Routes>
        </main>

        {assistantOpen && <Assistant onClose={() => setAssistantOpen(false)} />}
      </div>
    </BrowserRouter>
  );
}
