import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from './lib/api.js';
import { getUser, login, logout, userManager } from './lib/auth.js';
import { Documents } from './pages/Documents.js';
import { Invoices } from './pages/Invoices.js';
import { Projects } from './pages/Projects.js';
import { Quotes } from './pages/Quotes.js';

/** The OIDC redirect lands here; nothing else routes to it. */
function Callback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string>();

  useEffect(() => {
    userManager
      .signinRedirectCallback()
      .then(() => navigate('/', { replace: true }))
      .catch((err: Error) => setError(err.message));
  }, [navigate]);

  return <div className="signin">{error ? <p className="error">{error}</p> : <p>Bezig…</p>}</div>;
}

export function App() {
  const [email, setEmail] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading');
  const [error, setError] = useState<string>();

  useEffect(() => {
    // The callback route resolves its own session; running this there too would race it.
    if (window.location.pathname === '/auth/callback') return;

    void getUser().then(async (user) => {
      if (!user || user.expired) {
        setState('out');
        return;
      }
      try {
        // Not from the token: the server decides who this is. A client that has signed in
        // but was never invited gets a clear refusal here rather than an empty portal.
        const me = await api.me();
        setEmail(me.email);
        setState('in');
      } catch (err) {
        setError((err as Error).message);
        setState('out');
      }
    });
  }, []);

  if (window.location.pathname === '/auth/callback') {
    return (
      <Routes>
        <Route path="/auth/callback" element={<Callback />} />
      </Routes>
    );
  }

  if (state === 'loading') return <div className="signin">Bezig…</div>;

  if (state === 'out') {
    return (
      <div className="signin">
        <h1>Finsera</h1>
        <p className="tag">Klantportaal</p>
        {error && <p className="error">{error}</p>}
        <button onClick={() => void login()}>Inloggen</button>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="bar">
        <h1>Finsera</h1>
        <nav className="tabs">
          <NavLink to="/projecten">Projecten</NavLink>
          <NavLink to="/offertes">Offertes</NavLink>
          <NavLink to="/facturen">Facturen</NavLink>
          <NavLink to="/documenten">Documenten</NavLink>
        </nav>
        <span className="tag">
          {email} · <button className="link" onClick={() => void logout()}>uitloggen</button>
        </span>
      </header>

      <Routes>
        <Route path="/" element={<Navigate to="/projecten" replace />} />
        <Route path="/projecten" element={<Projects />} />
        <Route path="/offertes" element={<Quotes />} />
        <Route path="/facturen" element={<Invoices />} />
        <Route path="/documenten" element={<Documents />} />
        <Route path="*" element={<Navigate to="/projecten" replace />} />
      </Routes>
    </div>
  );
}
