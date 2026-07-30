import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Empty } from '../../shell/ui/primitives.js';

interface PortalUser {
  id: string;
  email: string;
  displayName: string | null;
  disabledAt: string | null;
  lastSeenAt: string | null;
  pending: boolean;
}

const when = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium' }).format(new Date(iso)) : '—';

/**
 * Who from this client can sign in, on the client's own page.
 *
 * Lives here rather than on a settings screen because "who at DocHorse can see this" is a
 * question you have while looking at DocHorse, and a permission you have to go somewhere
 * else to grant is one that gets granted by asking someone else to run a query.
 */
export function PortalUsers({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<PortalUser[]>();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = () => {
    api
      .get<PortalUser[]>(`/portal-admin/clients/${clientId}/users`)
      .then(setRows)
      .catch((err: Error) => setError(err.message));
  };

  useEffect(load, [clientId]);

  const invite = (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setBusy(true);
    api
      .post(`/portal-admin/clients/${clientId}/users`, { email: email.trim() })
      .then(() => {
        setEmail('');
        load();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const revoke = (user: PortalUser) => {
    setError(undefined);
    setBusy(true);
    api
      .post(`/portal-admin/users/${user.id}/revoke`, {})
      .then(load)
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <h2>Portal access</h2>
      <p className="muted">
        Anyone here can sign in to the client portal and see this client&rsquo;s projects,
        quotes, invoices and shared documents. They still need an account in Zitadel; the
        invitation binds to them the first time they sign in with this address.
      </p>

      {error && <p className="error">{error}</p>}

      {rows && rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Status</th>
              <th>Last seen</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>
                  {u.disabledAt ? (
                    <span className="muted">revoked {when(u.disabledAt)}</span>
                  ) : u.pending ? (
                    // Worth distinguishing: "invited" and "has actually been in" are
                    // different answers to "why can't they see anything".
                    <span className="muted">invited, not signed in yet</span>
                  ) : (
                    <span>active</span>
                  )}
                </td>
                <td>{when(u.lastSeenAt)}</td>
                <td>
                  {!u.disabledAt && (
                    <button disabled={busy} onClick={() => revoke(u)}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {rows && rows.length === 0 && (
        <Empty>Nobody from this client can sign in yet.</Empty>
      )}

      <form onSubmit={invite} className="row" style={{ gap: '.5rem', marginTop: '.75rem' }}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="their.name@client.nl"
          required
        />
        <button type="submit" disabled={busy || !email.trim()}>
          Give access
        </button>
      </form>
    </>
  );
}
