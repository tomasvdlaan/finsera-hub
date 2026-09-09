import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Empty } from '../../shell/ui/primitives.js';
import { inviteEmail } from './inviteEmail.js';

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
  const [issued, setIssued] = useState<{ email: string; name?: string; url: string } | null>(null);
  /** Optional, and only for the greeting and the Zitadel profile. */
  const [name, setName] = useState('');

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
    const person = name.trim();
    api
      .post<InviteResult>(`/portal-admin/clients/${clientId}/users`, {
        email: address,
        displayName: person || undefined,
      })
      .then((result) => {
        setEmail('');
        setName('');
        // The access exists either way. A missing link is a sentence about configuration,
        // not a failed invitation, so it is a warning beside the row rather than an error
        // that implies nothing happened.
        if (result.invite) setIssued({ email: address, name: person, url: result.invite.url });
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
        if (result.invite) {
          setIssued({ email: user.email, name: user.displayName ?? undefined, url: result.invite.url });
        }
        if (result.warning) setError(result.warning);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  // Revoking and restoring are the same gesture with a different verb, so they are the
  // same function: the row already says which of the two is on offer.
  /**
   * Release the Zitadel account this login bound to.
   *
   * Confirmed, because it is not obvious from the button what it costs: the next person to
   * sign in with this address takes the invitation, and if that is not who you meant, the
   * only way back is to unbind again. Rare enough to be worth a sentence and a click.
   */
  const unbind = (user: PortalUser) => {
    const ok = window.confirm(
      `Ontkoppel ${user.email} van het account waarmee is ingelogd?\n\n` +
        'De uitnodiging blijft bestaan. De eerstvolgende aanmelding met dit adres koppelt ' +
        'zich opnieuw — gebruik dit als het Zitadel-account opnieuw is aangemaakt.',
    );
    if (!ok) return;
    setError(undefined);
    setBusy(true);
    api
      .post(`/portal-admin/users/${user.id}/unbind`, {})
      .then(load)
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

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
      {/* A heading inside the client page's portal panel, which supplies the h2 — the
          address, who may sign in, and what they can see are one subject in three parts. */}
      <h3 className="panel-part">Who can sign in</h3>
      <p className="muted">
        Anyone here can sign in to the client portal and see this client&rsquo;s projects,
        quotes, invoices and shared documents. They still need an account in Zitadel; the
        invitation binds to them the first time they sign in with this address.
      </p>
      {/* The address itself is printed twice above — in the page's subtitle and as the field
          that sets it — so it is not printed a third time here. What is worth saying is what
          is missing when there is none. */}
      {!portalSlug && (
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
          name={issued.name}
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
                      {/*
                        Only on a login that has actually bound to an account. On a pending
                        row there is nothing to release, and offering it would invite the
                        reading that this is how you resend an invitation.
                      */}
                      {!u.pending && (
                        <button
                          disabled={busy}
                          title="Releases the Zitadel account this login is tied to, so the next sign-in with this address binds afresh. For an account that was re-created."
                          onClick={() => unbind(u)}
                        >
                          Unlink
                        </button>
                      )}
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
        {/* Optional: it greets them by name in the mail and names them in Zitadel. */}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Naam (optioneel)"
          aria-label="Naam"
          disabled={!portalSlug}
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
 * Three ways to take it, because three things happen in practice: somebody pastes the styled
 * mail into Outlook and sends it as it is, somebody is already writing a message and wants
 * only the link, and somebody's mail client refuses rich paste and needs the plain text.
 *
 * The preview is an iframe rather than a div. The email's HTML is written for Outlook — bare
 * tables, inline styles, its own fonts — and rendering it inside the app would both inherit
 * our stylesheet and leak into it, so what you would be checking is not what the client sees.
 */
function InviteMessage({
  email,
  name,
  url,
  clientName,
  portalHost,
  onDone,
}: {
  email: string;
  name?: string;
  url: string;
  clientName: string;
  portalHost: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState<'link' | 'mail' | 'text' | null>(null);
  const [fallback, setFallback] = useState(false);
  const mail = inviteEmail({ name, clientName, portalHost, url });

  const flash = (what: 'link' | 'mail' | 'text') => {
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  };

  const copyText = async (what: 'link' | 'text', text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flash(what);
    } catch {
      // Clipboard access needs a secure context. The fields below are selectable, so a
      // refused copy leaves somebody able to select the text rather than stuck.
      setFallback(true);
    }
  };

  /**
   * Copy as formatted mail.
   *
   * `text/html` on the clipboard is what makes Outlook paste the styled version rather than
   * a wall of markup; `text/plain` rides along for anywhere that will not take HTML. Older
   * browsers have no `ClipboardItem`, and there the plain text is the honest answer — said
   * out loud rather than silently pasting something that looks broken.
   */
  const copyMail = async () => {
    try {
      if (typeof ClipboardItem === 'undefined') throw new Error('no rich clipboard');
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([mail.html], { type: 'text/html' }),
          'text/plain': new Blob([mail.text], { type: 'text/plain' }),
        }),
      ]);
      flash('mail');
    } catch {
      await copyText('text', mail.text);
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
        <button onClick={() => void copyText('link', url)}>
          {copied === 'link' ? 'Gekopieerd' : 'Kopieer link'}
        </button>
      </div>

      <label className="field">
        <span>Onderwerp</span>
        <input readOnly value={mail.subject} onFocus={(e) => e.target.select()} />
      </label>

      <div className="invite-preview">
        <iframe
          title="Voorbeeld van de e-mail"
          srcDoc={mail.html}
          sandbox=""
          scrolling="no"
        />
      </div>

      <div className="row">
        <button data-variant="primary" onClick={() => void copyMail()}>
          {copied === 'mail' ? 'Gekopieerd — plak in Outlook' : 'Kopieer opgemaakte e-mail'}
        </button>
        <button onClick={() => void copyText('text', mail.text)}>
          {copied === 'text' ? 'Gekopieerd' : 'Kopieer platte tekst'}
        </button>
      </div>
      {fallback && (
        <p className="muted">
          Kopiëren via de knop lukt niet in deze browser — selecteer de tekst hierboven en
          kopieer met Cmd+C.
        </p>
      )}
      {fallback && (
        <label className="field">
          <span>Bericht als platte tekst</span>
          <textarea readOnly rows={14} value={mail.text} onFocus={(e) => e.target.select()} />
        </label>
      )}
    </div>
  );
}
