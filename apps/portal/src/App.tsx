import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { PortalError, api } from './lib/api.js';
import { getUser, login, logout, userManager } from './lib/auth.js';
import { Documents } from './pages/Documents.js';
import { Invoices } from './pages/Invoices.js';
import { Projects } from './pages/Projects.js';
import { Quotes } from './pages/Quotes.js';

/**
 * Where Zitadel sends the browser back to. Nothing else routes here.
 *
 * On success it navigates to `/`, which unmounts this and mounts `Session` — so the
 * session check runs fresh, after the tokens exist, rather than having to be re-triggered.
 */
function Callback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const redeemed = useRef(false);

  useEffect(() => {
    // StrictMode runs effects twice in development, and an authorization code may be
    // redeemed exactly once. Without this guard the second attempt fails and paints an
    // error over a session that is in fact perfectly good.
    if (redeemed.current) return;
    redeemed.current = true;

    userManager
      .signinRedirectCallback()
      .then(() => navigate('/', { replace: true }))
      .catch((err: Error) => setError(err.message));
  }, [navigate]);

  return (
    <div className="signin">
      {error ? <p className="error">{error}</p> : <p>Bezig met inloggen…</p>}
    </div>
  );
}

/** Signed in, signed out, or refused — and the shell for the first of those. */
function Session() {
  const [email, setEmail] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading');
  const [error, setError] = useState<string>();
  // Signed in at Zitadel but refused by us is a distinct situation from signed out, and
  // it is the one where the only useful button is the one that lets you leave.
  const [signedInElsewhere, setSignedInElsewhere] = useState(false);

  useEffect(() => {
    let live = true;

    void getUser().then(async (user) => {
      if (!user || user.expired) {
        if (live) setState('out');
        return;
      }
      try {
        // Who this is comes from the server, not from the token. Someone who signed in
        // successfully but was never invited gets a clear refusal rather than an empty
        // portal that looks broken.
        const me = await api.me();
        if (!live) return;
        setEmail(me.email);
        setState('in');
      } catch (err) {
        if (!live) return;
        // A 401 on a token that has not expired is not a session problem, and telling
        // someone to log in again sends them round a loop that cannot terminate. It
        // means the sign-in worked and this account is not entitled to the portal —
        // missing role, or an account that was never invited.
        const status = err instanceof PortalError ? err.status : 0;
        setSignedInElsewhere(status === 401 || status === 403);
        setError(
          status === 401 && !user.expired
            ? 'U bent ingelogd, maar dit account heeft geen toegang tot het klantportaal. Neem contact met ons op.'
            : (err as Error).message,
        );
        setState('out');
      }
    });

    return () => {
      live = false;
    };
  }, []);

  if (state === 'loading') return <div className="signin">Bezig…</div>;

  if (state === 'out') {
    return (
      <div className="signin">
        <h1>Finsera</h1>
        <p className="tag">Klantportaal</p>
        {error && <p className="error">{error}</p>}
        {signedInElsewhere && (
          // Internal accounts are refused here by design, and without saying so the
          // refusal reads as a bug — the only button offers a sign-in that cannot ever
          // succeed for them. Static copy rather than detection: the guard cannot tell an
          // internal account from any other refused one, and should not learn to.
          <p className="tag">
            Bent u van Finsera? Het klantportaal is alleen voor klanten — bekijk het
            portaal van een klant via het dashboard, bij de klant zelf.
          </p>
        )}
        {signedInElsewhere ? (
          // "Inloggen" here would reuse the Zitadel session that was just refused and
          // land straight back on this screen — a loop with no exit. Signing out is the
          // only move that changes anything, including switching to another account.
          <button onClick={() => void logout()}>Uitloggen</button>
        ) : (
          <button onClick={() => void login()}>Inloggen</button>
        )}
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
          {email} ·{' '}
          <button className="link" onClick={() => void logout()}>
            uitloggen
          </button>
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

/**
 * One router, one source of truth about where we are.
 *
 * An earlier version branched on `window.location.pathname` *and* rendered `<Routes>`,
 * which meant two things disagreed the moment the callback navigated away: the router
 * was at `/` while the branch still rendered a route table containing only
 * `/auth/callback`. Nothing matched, React rendered nothing, and the result was a white
 * screen with no error — the failure only showed up as a routing warning in the console.
 */
export function App() {
  return (
    <Routes>
      <Route path="/auth/callback" element={<Callback />} />
      <Route path="*" element={<Session />} />
    </Routes>
  );
}
