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

/**
 * Where a slug lives. Read from the page's own host so that development (`localhost:5173`)
 * and production (`hub.finsera.nl`) each point at their own portal: the internal app is
 * `hub.` on the same domain the portals hang off, so stripping `hub.` is the rule.
 */
export const portalHost = (slug: string) =>
  `${slug}.${window.location.host.replace(/^hub\./, '').replace(/:5173$/, ':5174')}`;
export const portalUrl = (slug: string) => `${window.location.protocol}//${portalHost(slug)}`;

const when = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium' }).format(new Date(iso)) : '—';

/**
 * Who from this client can sign in, on the client's own page.
 *
 * Lives here rather than on a settings screen because "who at DocHorse can see this" is a
 * question you have while looking at DocHorse, and a permission you have to go somewhere
 * else to grant is one that gets granted by asking someone else to run a query.
 */
/**
 * Their logo, beside ours in their portal's header.
 *
 * Their mark, our design language. Full white-labelling would say the portal is theirs,
 * and it is Finsera's — at their address, which is the part that matters to them.
 */
function PortalLogo({ clientId }: { clientId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Bumped after a change so the browser fetches the new one rather than the cached old.
  const [version, setVersion] = useState(0);

  const send = async (body: { contentBase64?: string; mimeType?: string } | null) => {
    setError(undefined);
    setBusy(true);
    try {
      await api.post(`/portal-admin/clients/${clientId}/logo`, body ?? {});
      setVersion((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const choose = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      void send({ contentBase64: result.slice(result.indexOf(',') + 1), mimeType: file.type });
    };
    reader.readAsDataURL(file);
  };

  return (
    <p className="row">
      <span className="muted">Logo:</span>
      <input
        type="file"
        accept="image/png,image/jpeg"
        disabled={busy}
        onChange={(e) => choose(e.target.files?.[0])}
      />
      <button className="link-button" disabled={busy} onClick={() => void send(null)}>
        remove
      </button>
      {version > 0 && <span className="muted">saved</span>}
      {error && <span className="error">{error}</span>}
    </p>
  );
}

export function PortalUsers({
  clientId,
  portalSlug,
}: {
  clientId: string;
  /** From the client row. Null means no portal address yet, and no invitations until there is. */
  portalSlug: string | null;
}) {
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
      {portalSlug ? (
        <p className="muted">
          Their portal:{' '}
          <a href={portalUrl(portalSlug)} target="_blank" rel="noreferrer">
            {portalHost(portalSlug)}
          </a>
        </p>
      ) : (
        // The invite form below is disabled for the same reason the API refuses it: a login
        // with nowhere to go is a support ticket. The address field is on this page.
        <p className="muted">
          Set a <strong>portal address</strong> for this client (above) before giving anyone
          access — that is where they will sign in.
        </p>
      )}

      {error && <p className="error">{error}</p>}

      <PortalLogo clientId={clientId} />

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
          disabled={!portalSlug}
          required
        />
        <button type="submit" disabled={busy || !email.trim() || !portalSlug}>
          Give access
        </button>
      </form>
    </>
  );
}
