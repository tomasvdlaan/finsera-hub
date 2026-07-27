import { useEffect, useState } from 'react';
import type { CurrentUser } from '@platform/contracts';
import { api } from '../lib/auth.js';
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
 * Layer 3 — the application shell. Navigation comes from the API, which assembles it
 * from module manifests: the shell hard-codes no module.
 */
function Shell() {
  const { user, loading, error: authError, login, logout } = useAuth();
  const [nav, setNav] = useState<NavItem[]>([]);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([api<NavItem[]>('/core/navigation'), api<CurrentUser>('/core/me')])
      .then(([n, m]) => {
        setNav(n);
        setMe(m);
      })
      .catch((e: Error) => setError(e.message));
  }, [user]);

  if (loading) return <Centered>Loading…</Centered>;

  if (!user) {
    return (
      <Centered>
        <h1 style={{ marginBottom: '1rem' }}>Finsera Platform</h1>
        <button onClick={login} style={buttonStyle}>
          Sign in
        </button>
        {authError && (
          <p style={{ color: '#b00', marginTop: '1rem', maxWidth: 420, textAlign: 'center' }}>
            Sign-in failed: {authError}
          </p>
        )}
      </Centered>
    );
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', display: 'flex', minHeight: '100vh' }}>
      <nav
        style={{
          width: 220,
          borderRight: '1px solid #e5e5e5',
          padding: '1rem',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <strong style={{ display: 'block', marginBottom: '1rem' }}>Finsera Platform</strong>
        {nav.map((item) => (
          <a key={item.path} href={item.path} style={{ display: 'block', padding: '0.25rem 0' }}>
            {item.label}
          </a>
        ))}
        <div style={{ marginTop: 'auto', fontSize: '0.85rem', color: '#666' }}>
          {me && (
            <>
              <div>{me.displayName}</div>
              <div style={{ opacity: 0.7 }}>{me.role}</div>
            </>
          )}
          <button onClick={logout} style={{ ...buttonStyle, marginTop: '0.5rem' }}>
            Sign out
          </button>
        </div>
      </nav>
      <main style={{ flex: 1, padding: '2rem' }}>
        <h1>Walking skeleton</h1>
        <p>
          Navigation is assembled from module manifests by the core — the shell references no
          module directly.
        </p>
        {error && <p style={{ color: '#b00' }}>API error: {error}</p>}
      </main>
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  cursor: 'pointer',
  border: '1px solid #ccc',
  borderRadius: 6,
  background: '#fff',
};

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'system-ui, sans-serif',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </div>
  );
}
