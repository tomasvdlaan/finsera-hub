import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from 'oidc-client-ts';
import { getUser, login, logout, userManager } from '../lib/auth.js';

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  error: null,
  login,
  logout,
});

export const useAuth = () => useContext(AuthContext);

/**
 * Resolve the session exactly once per page load.
 *
 * An authorization code is single-use, so the callback must not be redeemed twice —
 * and React StrictMode deliberately double-invokes effects in development. Memoizing
 * the promise at module scope makes the second invocation await the same result
 * instead of replaying (and failing) the exchange.
 */
let sessionPromise: Promise<User | null> | null = null;

function resolveSession(): Promise<User | null> {
  sessionPromise ??= (async () => {
    if (window.location.pathname === '/auth/callback') {
      const user = await userManager.signinRedirectCallback();
      window.history.replaceState({}, '', '/');
      return user;
    }
    return getUser();
  })();
  return sessionPromise;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    resolveSession()
      .then((u) => {
        if (active) setUser(u);
      })
      .catch((e: Error) => {
        // Surfaced, never swallowed — a silent auth failure is indistinguishable
        // from "not signed in", which is what made this hard to see the first time.
        console.error('Auth failed:', e);
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const onLoaded = (u: User) => setUser(u);
    const onUnloaded = () => setUser(null);
    userManager.events.addUserLoaded(onLoaded);
    userManager.events.addUserUnloaded(onUnloaded);
    return () => {
      active = false;
      userManager.events.removeUserLoaded(onLoaded);
      userManager.events.removeUserUnloaded(onUnloaded);
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
