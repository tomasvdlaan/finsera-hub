import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Card } from '../../shell/ui/card.js';
import { Block, PageHeader } from '../../shell/ui/layout.js';
import { Empty } from '../../shell/ui/primitives.js';
import { useDocumentTitle } from '../../shell/useDocumentTitle.js';
import { PeoplePicker } from './PeoplePicker.js';

/**
 * One person at a client, rather than one row in a list of who has access.
 *
 * The portal has always known these people individually — an address, a name, when they were
 * last in — and had nowhere to say so. Everything about somebody was a cell in a table on
 * their client's page, which is why "does Bob see the margin report?" and "has anyone from
 * DocHorse actually signed in since we sent that quote?" were both questions you asked by
 * opening the database.
 *
 * Three panels, because there are three questions and they are genuinely different: who this
 * is, what they may see, and what they have done. The last two are the ones the client rings
 * about.
 */

interface PortalUser {
  id: string;
  clientId: string;
  email: string;
  displayName: string | null;
  oidcSubject: string | null;
  disabledAt: string | null;
  seesInvoices: boolean;
  seesQuotes: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

interface Session {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
  ip: string | null;
  userAgent: string | null;
  status: 'active' | 'ended' | 'expired';
}

interface Detail {
  user: PortalUser;
  sessions: Session[];
}

/** One report or shared document at this client, and who may open it. */
interface Artefact {
  kind: 'page' | 'document';
  id: string;
  title: string;
  enabled: boolean;
  mode: 'everyone' | 'restricted';
  userIds: string[];
}

/** What only the identity provider knows: the attempts that never became a session. */
type IdentityEvents =
  | { ok: true; events: Array<{ type: string; at: string; editor: string | null }> }
  | { ok: false; reason: string };

const stamp = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(iso),
      )
    : '—';

/**
 * A user agent, shortened to the part anybody reads.
 *
 * Not parsed — a browser's own string is neither stable nor honest, and a wrong "Safari on
 * Windows" is worse than the raw text. This keeps the whole string in the title attribute and
 * shows the first recognisable name, so the column stays a column.
 */
function browser(ua: string | null): string {
  if (!ua) return '—';
  const name = /Edg|OPR|Chrome|Firefox|Safari/.exec(ua)?.[0];
  const os = /Windows|Macintosh|iPhone|iPad|Android|Linux/.exec(ua)?.[0];
  if (!name) return ua.slice(0, 40);
  return [name === 'Edg' ? 'Edge' : name === 'OPR' ? 'Opera' : name, os].filter(Boolean).join(' · ');
}

export function PortalUserDetail() {
  const { id = '' } = useParams();
  const [detail, setDetail] = useState<Detail>();
  const [identity, setIdentity] = useState<IdentityEvents>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [artefacts, setArtefacts] = useState<Artefact[]>();
  /** The artefact whose people are being chosen, or null. */
  const [picking, setPicking] = useState<Artefact | null>(null);

  const load = useCallback(() => {
    api
      .get<Detail>(`/portal-admin/users/${id}`)
      .then((d) => {
        setDetail(d);
        setName(d.user.displayName ?? '');
      })
      .catch((err: Error) => setError(err.message));
  }, [id]);

  useEffect(load, [load]);

  // Keyed on the client rather than the person: it is the client's list of artefacts, and
  // every one of their people is asked the same question of it.
  const clientId = detail?.user.clientId;
  const loadArtefacts = useCallback(() => {
    if (!clientId) return;
    api
      .get<Artefact[]>(`/portal-admin/clients/${clientId}/artefacts`)
      .then(setArtefacts)
      .catch((err: Error) => setError(err.message));
  }, [clientId]);

  useEffect(loadArtefacts, [loadArtefacts]);

  // Fetched apart from the rest, because it is a call to somebody else's server: the page
  // should render without it and should not disappear when Zitadel is having an afternoon.
  useEffect(() => {
    api
      .get<IdentityEvents>(`/portal-admin/users/${id}/identity-events`)
      .then(setIdentity)
      .catch((err: Error) => setIdentity({ ok: false, reason: err.message }));
  }, [id]);

  useDocumentTitle(detail ? (detail.user.displayName ?? detail.user.email) : 'Portal login');

  const save = (patch: { displayName?: string; seesInvoices?: boolean; seesQuotes?: boolean }) => {
    setError(undefined);
    setBusy(true);
    api
      .patch<PortalUser>(`/portal-admin/users/${id}`, patch)
      .then((user) => setDetail((d) => (d ? { ...d, user } : d)))
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  /** Whether this person can open it — everyone's, or named on it. */
  const canSee = (a: Artefact) => a.mode === 'everyone' || a.userIds.includes(id);

  /**
   * Add or remove this person from something already restricted.
   *
   * Only reachable when it is restricted: for an artefact shared with everyone the tick is
   * disabled, because unticking would mean "everybody except them", which this model cannot
   * express — a restriction names who may, never who may not.
   */
  const toggleArtefact = (a: Artefact) => {
    const userIds = a.userIds.includes(id)
      ? a.userIds.filter((u) => u !== id)
      : [...a.userIds, id];
    if (userIds.length === 0) {
      // The server refuses this too. Said here as a sentence rather than as a failed request,
      // because the person clicking has a reasonable next move and the error would not name it.
      setError(
        `${a.title} is only shared with them — share it with everyone at this client first.`,
      );
      return;
    }
    saveVisibility(a, { mode: 'restricted', userIds });
  };

  const saveVisibility = (a: Artefact, next: { mode: 'restricted'; userIds: string[] }) => {
    setError(undefined);
    setBusy(true);
    api
      .patch(`/portal-admin/visibility/${a.kind}/${a.id}`, next)
      .then(loadArtefacts)
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const endSession = (sessionId: string) => {
    setError(undefined);
    setBusy(true);
    api
      .post(`/portal-admin/users/${id}/sessions/${sessionId}/end`, {})
      .then(load)
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const user = detail?.user;

  return (
    <>
      <PageHeader
        title={user ? (user.displayName ?? user.email) : '…'}
        subtitle={
          user
            ? [
                user.email,
                user.disabledAt
                  ? 'access revoked'
                  : user.oidcSubject
                    ? 'active'
                    : 'invited, not signed in yet',
              ].join(' · ')
            : undefined
        }
        back={
          user
            ? { to: `/clients/${user.clientId}`, label: 'Client' }
            : { to: '/clients', label: 'Clients' }
        }
      />

      {error && <p className="error">{error}</p>}

      <Block span={5}>
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <Card title="The person">
            <dl className="terms">
              <dt>Email</dt>
              {/* Read-only, and not an oversight: the address is what an invitation binds to
                  and what a verified address is matched against, so changing it would either
                  strand them or hand their access to whoever holds the new one. */}
              <dd>{user?.email ?? '…'}</dd>
              <dt>Invited</dt>
              <dd>{user ? stamp(user.createdAt) : '…'}</dd>
              <dt>Last signed in</dt>
              <dd>{user ? stamp(user.lastSeenAt) : '…'}</dd>
            </dl>
            <label className="field">
              <span>Name</span>
              <input
                value={name}
                disabled={busy || !user}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => {
                  if (user && name.trim() !== (user.displayName ?? '')) save({ displayName: name });
                }}
                placeholder={user?.email}
              />
            </label>
            <p className="field-hint">
              How they are greeted in their portal, and how they are named anywhere this
              person is mentioned.
            </p>
          </Card>

          <Card title="What they see">
            {/*
              Two grains, deliberately. Reports and documents are given out one at a time,
              because "this report and not that one" is exactly how it is asked. Invoices and
              quotes are all or nothing: a client shown half their invoices has a total that
              does not add up, which is worse than not seeing the section at all.
            */}
            <label className="row" style={{ gap: '.5rem' }}>
              <input
                type="checkbox"
                checked={user?.seesInvoices ?? true}
                disabled={busy || !user}
                onChange={(e) => save({ seesInvoices: e.target.checked })}
              />
              <span>Invoices</span>
            </label>
            <label className="row" style={{ gap: '.5rem' }}>
              <input
                type="checkbox"
                checked={user?.seesQuotes ?? true}
                disabled={busy || !user}
                onChange={(e) => save({ seesQuotes: e.target.checked })}
              />
              <span>Quotes</span>
            </label>
            <p className="field-hint">
              Projects, tasks and tickets are shared with everyone at this client. Reports and
              documents are set on the report or document itself.
            </p>
          </Card>

          <Card
            title="Reports and documents"
            sub={artefacts ? `${artefacts.filter((a) => canSee(a)).length} of ${artefacts.length}` : undefined}
          >
            {/*
              Asked from this person's side, which is the other half of the same decision the
              client page makes from the artefact's side. Both write the same rows; this one is
              the view you want when somebody joins or leaves a client and you are going down a
              list of what they should have.
            */}
            {!artefacts ? (
              <p className="muted">Loading…</p>
            ) : artefacts.length === 0 ? (
              <Empty>This client has no reports or shared documents yet.</Empty>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {artefacts.map((a) => (
                  <li key={`${a.kind}:${a.id}`} style={{ padding: '.3rem 0' }}>
                    <label className="row" style={{ gap: '.5rem' }}>
                      <input
                        type="checkbox"
                        checked={canSee(a)}
                        // Shared with everyone: they can see it, and unticking here would mean
                        // "restrict this to everybody except them", which is not a thing this
                        // model can express — restricting names who may, never who may not.
                        // The link beside it is the way to change that.
                        disabled={busy || a.mode === 'everyone' || Boolean(user?.disabledAt)}
                        onChange={() => toggleArtefact(a)}
                      />
                      <span>
                        {a.title}{' '}
                        <span className="muted">
                          {a.kind === 'page' ? 'report' : 'document'}
                          {!a.enabled && ' · off'}
                          {a.mode === 'everyone'
                            ? ' · everyone'
                            : ` · ${a.userIds.length} ${a.userIds.length === 1 ? 'person' : 'people'}`}
                        </span>
                      </span>
                    </label>
                    <button
                      className="link-button"
                      disabled={busy}
                      style={{ marginLeft: '1.4rem' }}
                      onClick={() => setPicking(a)}
                    >
                      {a.mode === 'everyone' ? 'restrict to some people' : 'change who'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {artefacts && artefacts.some((a) => a.mode === 'restricted' && a.userIds.length === 1 && canSee(a)) && (
              // The one move this card cannot make on its own: they are the only person on
              // something, and taking them off would leave it visible to nobody.
              <p className="field-hint">
                Where they are the only person named, share it with everyone first — an
                artefact restricted to nobody is one nobody can open.
              </p>
            )}
          </Card>

          {picking && user && (
            <PeoplePicker
              clientId={user.clientId}
              title={picking.title}
              /*
               * Opened from *their* page, so restricting something that is currently shared
               * with everyone starts with them ticked: doing it from here and leaving them
               * off would take away access they have, which is the opposite of what the
               * action reads as. Changing who can see something already restricted shows the
               * truth instead, because there the list is the thing being edited.
               */
              initial={
                picking.mode === 'everyone' ? [...new Set([...picking.userIds, id])] : picking.userIds
              }
              onSave={(userIds) => {
                const target = picking;
                setPicking(null);
                saveVisibility(target, { mode: 'restricted', userIds });
              }}
              onClose={() => setPicking(null)}
            />
          )}
        </div>
      </Block>

      <Block span={7}>
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <Card
            title="Sign-ins"
            sub={detail ? `${detail.sessions.length} recorded` : undefined}
            loading={!detail && !error}
          >
            {/* These rows have been written since Phase 8 and read by nothing, which is the
                ordinary way a system ends up unable to say who has been in. */}
            {detail?.sessions.length === 0 ? (
              <Empty>This person has never signed in.</Empty>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Browser</th>
                    <th>From</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {detail?.sessions.map((s) => (
                    <tr key={s.id}>
                      <td>{stamp(s.createdAt)}</td>
                      <td title={s.userAgent ?? undefined}>{browser(s.userAgent)}</td>
                      <td>{s.ip ?? '—'}</td>
                      <td>
                        {s.status === 'active' ? (
                          <span>active</span>
                        ) : (
                          <span className="muted">
                            {s.status === 'ended' ? 'ended' : 'expired'}
                          </span>
                        )}
                      </td>
                      <td>
                        {s.status === 'active' && (
                          // The narrow gesture: a laptop left at a client's office. Revoking
                          // the person lives on the client page and takes their access with it.
                          <button
                            disabled={busy}
                            title="Signs this browser out. Their access is unchanged and they can sign in again."
                            onClick={() => endSession(s.id)}
                          >
                            End
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="At the identity provider">
            {/* Our own tables can only record sign-ins that worked — a session row exists
                because a session was created. The password that was wrong four times, the
                account that locked, the second factor set up last week: all of that happens
                inside Zitadel, and it is the half somebody asks about when they cannot get in. */}
            {!identity ? (
              <p className="muted">Loading…</p>
            ) : !identity.ok ? (
              <Empty>{identity.reason}</Empty>
            ) : identity.events.length === 0 ? (
              <Empty>Zitadel has nothing recorded for this account.</Empty>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Event</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {identity.events.map((e, i) => (
                    <tr key={`${e.at}-${i}`}>
                      <td>{stamp(e.at || null)}</td>
                      {/* The provider's own event names, not ours. Renaming them here would
                          mean maintaining a translation of somebody else's vocabulary and
                          being quietly wrong about anything new. */}
                      <td>{e.type}</td>
                      <td className="muted">{e.editor ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {user && (
            <p className="field-hint">
              Revoking or restoring this login, and issuing a new registration link, are on the{' '}
              <Link to={`/clients/${user.clientId}`}>client&rsquo;s page</Link> beside everyone
              else who can sign in.
            </p>
          )}
        </div>
      </Block>
    </>
  );
}
