import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Empty } from '../../shell/ui/primitives.js';

interface InviteResult {
  id?: string;
  /** Null when Zitadel could not be reached or is not configured; `warning` says which. */
  invite: { url: string } | null;
  warning: string | null;
}

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
  clientName,
  portalSlug,
}: {
  clientId: string;
  /** Named in the message that goes out, so it reads as ours rather than as a system mail. */
  clientName: string;
  /** From the client row. Null means no portal address yet, and no invitations until there is. */
  portalSlug: string | null;
}) {
  const [rows, setRows] = useState<PortalUser[]>();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  /*
   * The link, held on screen and nowhere else.
   *
   * A registration code sets somebody's first password, so it is never stored, never
   * re-fetched and gone on reload — if it is lost, a new one is issued, which is also the
   * only honest thing to offer since issuing invalidates the last.
   */
  const [issued, setIssued] = useState<{ email: string; url: string } | null>(null);

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
    const address = email.trim();
    api
      .post<InviteResult>(`/portal-admin/clients/${clientId}/users`, { email: address })
      .then((result) => {
        setEmail('');
        // The access exists either way. A missing link is a sentence about configuration,
        // not a failed invitation, so it is a warning beside the row rather than an error
        // that implies nothing happened.
        if (result.invite) setIssued({ email: address, url: result.invite.url });
        if (result.warning) setError(result.warning);
        load();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  /** A fresh link for somebody already invited — the old one stops working. */
  const relink = (user: PortalUser) => {
    setError(undefined);
    setBusy(true);
    api
      .post<InviteResult>(`/portal-admin/users/${user.id}/invite-link`, {})
      .then((result) => {
        if (result.invite) setIssued({ email: user.email, url: result.invite.url });
        if (result.warning) setError(result.warning);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  // Revoking and restoring are the same gesture with a different verb, so they are the
  // same function: the row already says which of the two is on offer.
  const setAccess = (user: PortalUser, action: 'revoke' | 'reinstate') => {
    setError(undefined);
    setBusy(true);
    api
      .post(`/portal-admin/users/${user.id}/${action}`, {})
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

      {issued && portalSlug && (
        <InviteMessage
          email={issued.email}
          url={issued.url}
          clientName={clientName}
          portalHost={portalHost(portalSlug)}
          onDone={() => setIssued(null)}
        />
      )}

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
                  {u.disabledAt ? (
                    // The only way back. Re-inviting the address cannot work — the row is
                    // still here and the address is unique per client — so without this
                    // button a revoked login is revoked for good.
                    <button disabled={busy} onClick={() => setAccess(u, 'reinstate')}>
                      Restore
                    </button>
                  ) : (
                    <>
                      <button
                        disabled={busy}
                        title="Issues a new registration link. Any link sent earlier stops working."
                        onClick={() => relink(u)}
                      >
                        {u.pending ? 'Link' : 'New link'}
                      </button>
                      <button disabled={busy} onClick={() => setAccess(u, 'revoke')}>
                        Revoke
                      </button>
                    </>
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

/**
 * The link, and the message it goes in.
 *
 * Written in Dutch and in our own voice, because the whole reason the link comes back here
 * rather than going out from Zitadel is that a client should receive a message from someone
 * they have spoken to, at their own portal's address — not a system mail from an identity
 * provider they have never heard of.
 *
 * Two copy buttons rather than one: the link alone is what somebody pastes into a message
 * they are already writing, and the full text is for when they are not.
 */
function InviteMessage({
  email,
  url,
  clientName,
  portalHost,
  onDone,
}: {
  email: string;
  url: string;
  clientName: string;
  portalHost: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState<'link' | 'message' | null>(null);

  const subject = `Toegang tot uw Finsera-portaal`;
  const body = [
    `Beste,`,
    ``,
    `Hierbij uw persoonlijke toegang tot het klantportaal van ${clientName}.`,
    ``,
    `Stel via onderstaande link uw wachtwoord in:`,
    url,
    ``,
    `Daarna logt u in op ${portalHost} — daar vindt u uw projecten, offertes,`,
    `facturen en gedeelde documenten.`,
    ``,
    `De link is persoonlijk en kan één keer worden gebruikt. Werkt hij niet meer,`,
    `laat het ons weten; dan sturen wij een nieuwe.`,
    ``,
    `Met vriendelijke groet,`,
    `Finsera`,
  ].join('\n');

  /*
   * `navigator.clipboard` needs a secure context, which localhost is and a plain-http LAN
   * address is not. The textarea below is the fallback that always works: it is selectable,
   * so a failed copy leaves somebody able to select the text rather than stuck.
   */
  const copy = async (what: 'link' | 'message', text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className="invite-issued">
      <div className="row">
        <strong>Registratielink voor {email}</strong>
        <button className="link-button" onClick={onDone}>
          klaar
        </button>
      </div>
      <p className="muted">
        Deze link is eenmalig en wordt hier niet bewaard — sluit dit venster pas als de mail
        verstuurd is. Een nieuwe link maken laat de vorige vervallen.
      </p>

      <div className="row">
        <input readOnly value={url} aria-label="Registratielink" onFocus={(e) => e.target.select()} />
        <button onClick={() => void copy('link', url)}>
          {copied === 'link' ? 'Gekopieerd' : 'Kopieer link'}
        </button>
      </div>

      <label className="field">
        <span>Mail — onderwerp</span>
        <input readOnly value={subject} onFocus={(e) => e.target.select()} />
      </label>
      <label className="field">
        <span>Mail — bericht</span>
        <textarea readOnly rows={14} value={body} onFocus={(e) => e.target.select()} />
      </label>
      <button onClick={() => void copy('message', `${subject}\n\n${body}`)}>
        {copied === 'message' ? 'Gekopieerd' : 'Kopieer hele bericht'}
      </button>
    </div>
  );
}
