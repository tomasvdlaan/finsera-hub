import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { PageHeader } from '../../shell/ui/layout.js';
import { Panel } from '../../shell/ui/primitives.js';
import { useDocumentTitle } from '../../shell/useDocumentTitle.js';

interface Page {
  id: string;
  title: string;
  slug: string;
  kind: 'proxy' | 'redirect';
  enabled: boolean;
  sourceUrl: string;
  hasSecret: boolean;
  timeoutSeconds?: number;
  clientId: string;
  clientName: string;
  address: string | null;
}

/**
 * Where a page's own id leads.
 *
 * A record needs an address, and this is it — reached from a search result, a link in a
 * note, or the card the assistant renders. Deliberately a reading screen rather than a
 * second editor: everything about a page is changed under *Custom content* on the client,
 * where it sits beside the others and the admin already knows the way. Two screens that
 * both edit one row is how they disagree.
 *
 * What it does say is the thing nothing else shows in one place: whether a client can see
 * this, where it really comes from, and whether a bypass secret is stored — never the
 * secret, only that there is one.
 */
export function PortalPageDetail() {
  const { id } = useParams<{ id: string }>();
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    api
      .get<Page>(`/portal-admin/pages/${id}`)
      .then(setPage)
      .catch((err: Error) => setError(err.message));
  }, [id]);

  useDocumentTitle(page ? page.title : 'Report');

  if (error) return <p className="error">{error}</p>;
  if (!page) return <p className="muted">Loading…</p>;

  return (
    <>
      <PageHeader
        title={page.title}
        subtitle={`Custom content for ${page.clientName}`}
      />
      <Panel span={6} title="Where it lives">
        <p className="row">
          <span className="muted">Client:</span>
          <Link to={`/clients/${page.clientId}/access`}>{page.clientName}</Link>
        </p>
        <p className="row">
          <span className="muted">Address:</span>
          {page.address ? (
            <a href={page.address} target="_blank" rel="noopener noreferrer">
              {page.address}
            </a>
          ) : (
            <span>This client has no portal address yet, so the page is unreachable.</span>
          )}
        </p>
        <p className="row">
          <span className="muted">Status:</span>
          {page.enabled ? (
            <span>Visible to the client</span>
          ) : (
            // The sentence this screen exists to say plainly.
            <span>
              Not visible yet — turn it on under{' '}
              <Link to={`/clients/${page.clientId}/access`}>Custom content</Link>.
            </span>
          )}
        </p>
      </Panel>
      <Panel span={6} title="Where it comes from">
        <p className="row">
          <span className="muted">Source:</span>
          <span style={{ wordBreak: 'break-all' }}>{page.sourceUrl}</span>
        </p>
        <p className="row">
          <span className="muted">Served:</span>
          <span>
            {page.kind === 'proxy'
              ? 'Proxied — the client never sees this address'
              : 'Redirect — the client is sent to this address and can see it'}
          </span>
        </p>
        <p className="row">
          <span className="muted">Bypass secret:</span>
          {/* Whether one is stored, never what it is: a write-only field that reads back as
              "set" is the only shape that shows the state without showing the credential. */}
          <span>{page.hasSecret ? 'stored' : 'none'}</span>
        </p>
        <p className="row">
          <span className="muted">Waits for it:</span>
          <span>{page.timeoutSeconds ?? 10} seconds</span>
        </p>
      </Panel>
    </>
  );
}
