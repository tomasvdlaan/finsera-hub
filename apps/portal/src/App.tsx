import { createContext, useContext, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { PortalError, api, type PortalMe } from './lib/api.js';
import { login, logout } from './lib/auth.js';
import { Documents } from './pages/Documents.js';
import { Pages } from './pages/Pages.js';
import { Invoices } from './pages/Invoices.js';
import { Overview } from './pages/Overview.js';
import { Projects } from './pages/Projects.js';
import { Quotes } from './pages/Quotes.js';
import { Tasks } from './pages/Tasks.js';
import { Requests } from './pages/Requests.js';

/**
 * Who is looking, for the handful of places that must not offer a client's own actions to
 * an employee.
 *
 * The server refuses those actions regardless — `@CurrentVisitor()` on the write routes
 * cannot be satisfied by a staff session. This only decides what to *show*, so that a
 * colleague is not offered a button that would fail, and so that nobody accepts a quote
 * believing they are doing the client a favour.
 */
const ViewerContext = createContext<PortalMe>({
  email: '',
  name: null,
  staff: false,
  clientName: null,
  welcome: null,
  logo: false,
  contact: null,
  tabs: { projects: false, tasks: false, quotes: false, invoices: false, documents: false, pages: false },
});
export const useViewer = () => useContext(ViewerContext);

/**
 * Signed in, signed out, or refused — and the shell for the first of those.
 *
 * There is no callback route any more: Zitadel returns to the API, which sets the session
 * cookie and sends the browser back to whatever page it was on (Phase 8, P1/P2). All this
 * has to do is ask the server who we are.
 */
function Session() {
  const [me, setMe] = useState<PortalMe | null>(null);
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading');
  const [error, setError] = useState<string>();
  // Signed in at Zitadel but refused by us is a distinct situation from signed out, and
  // it is the one where the only useful button is the one that lets you leave.
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    let live = true;

    api
      .me()
      .then((who) => {
        if (!live) return;
        setMe(who);
        setState('in');
      })
      .catch((err: Error) => {
        if (!live) return;
        const status = err instanceof PortalError ? err.status : 0;
        // 401 is "no session" — the ordinary signed-out state, and not an error to show.
        // 403 is "a session, but not for this portal": the host belongs to another client,
        // or the login was revoked. Only that one gets a message.
        if (status === 403) {
          setRefused(true);
          setError('Dit account heeft geen toegang tot dit klantportaal.');
        } else if (status !== 401) {
          setError(err.message);
        }
        setState('out');
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
        {refused ? (
          // "Inloggen" here would reuse the session that was just refused and land straight
          // back on this screen — a loop with no exit.
          <button onClick={() => void logout()}>Uitloggen</button>
        ) : (
          <button onClick={() => login()}>Inloggen</button>
        )}

      </div>
    );
  }

  return (
    <ViewerContext.Provider value={me!}>
      <div className="shell">
      {me?.staff && (
        // Said plainly and kept on screen. Somebody reading a client's portal should never
        // have to work out from context whose it is, or forget that it is not their own.
        <p className="staff-bar">
          Finsera — u bekijkt het portaal van {me.clientName ?? 'een klant'} als medewerker.
          Acties van de klant zijn uitgeschakeld.
        </p>
      )}
      <header className="bar">
        <h1>
          {/* Their logo beside our name, not instead of it. The portal is Finsera's, at
              their address; a page wearing only their branding would say otherwise. */}
          {me?.logo && <img className="client-logo" src="/api/portal/logo" alt="" />}
          Finsera
        </h1>
        <nav className="tabs">
          <NavLink to="/overzicht">Overzicht</NavLink>
          {/*
            A tab exists when there is something behind it.
            An empty Offertes tab reads as neglect, and a per-client list of switches to
            keep in step with reality reads as a settings screen nobody updates. Vragen is
            always here whatever it holds — hiding it when a client has asked nothing would
            take away the one thing they came to do.
          */}
          {me?.tabs.projects && <NavLink to="/projecten">Projecten</NavLink>}
          {me?.tabs.tasks && <NavLink to="/taken">Taken</NavLink>}
          {me?.tabs.quotes && <NavLink to="/offertes">Offertes</NavLink>}
          {me?.tabs.invoices && <NavLink to="/facturen">Facturen</NavLink>}
          {me?.tabs.documents && <NavLink to="/documenten">Documenten</NavLink>}
          {me?.tabs.pages && <NavLink to="/rapporten">Rapporten</NavLink>}
          <NavLink to="/vragen">Vragen</NavLink>
        </nav>
        <span className="tag">
          {me?.email} ·{' '}
          <button className="link" onClick={() => void logout()}>
            uitloggen
          </button>
        </span>
      </header>

      <Routes>
        <Route path="/" element={<Navigate to="/overzicht" replace />} />
        <Route path="/overzicht" element={<Overview />} />
        <Route path="/projecten" element={<Projects />} />
        <Route path="/taken" element={<Tasks />} />
        <Route path="/offertes" element={<Quotes />} />
        <Route path="/facturen" element={<Invoices />} />
        <Route path="/documenten" element={<Documents />} />
        <Route path="/rapporten" element={<Pages />} />
        <Route path="/vragen" element={<Requests />} />
        <Route path="*" element={<Navigate to="/overzicht" replace />} />
      </Routes>
      </div>
    </ViewerContext.Provider>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="*" element={<Session />} />
    </Routes>
  );
}
