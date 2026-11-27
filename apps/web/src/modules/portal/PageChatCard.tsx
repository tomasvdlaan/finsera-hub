import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import type { ChatWidgetProps } from '../types.js';

interface Page {
  id: string;
  title: string;
  slug: string;
  kind: 'proxy' | 'redirect';
  enabled: boolean;
  clientId: string;
  clientName: string;
  /** Where the client would open it, or null if they have no portal address. */
  address: string | null;
}

/**
 * A custom content page, as the assistant shows it after adding one.
 *
 * The line that earns this card is **whether it is switched on**. The assistant creates a
 * page disabled, so the useful thing to say back is not "done" — it is that a client cannot
 * see this yet and here is where you turn it on. A card that only repeated the title would
 * be a link with extra padding.
 *
 * Two destinations, because they answer different questions. *Open* is the real address on
 * the client's own subdomain: what they will see, worth looking at before you enable it.
 * *Custom content* is the panel in hub where the switch lives.
 */
export function PageChatCard({ id, displayName, urlPath }: ChatWidgetProps) {
  const [page, setPage] = useState<Page | null>(null);

  useEffect(() => {
    api
      .get<Page>(`/portal-admin/pages/${id}`)
      // A card that cannot load its record still renders as a link: the fallback below uses
      // the display name the registry already resolved.
      .then(setPage)
      .catch(() => setPage(null));
  }, [id]);

  return (
    <div className="chat-card">
      <div className="chat-card-head">
        <span className="badge">report</span>
        <Link to={urlPath}>{page?.title ?? displayName}</Link>
        {page && !page.enabled && <span className="badge priority-urgent">not visible yet</span>}
      </div>
      {page && (
        <div className="muted">
          {page.clientName}
          {page.address ? ` · ${page.address.replace(/^https:\/\//, '')}` : ' · no portal address'}
          {page.kind === 'redirect' && ' · redirect'}
        </div>
      )}
      <div className="chat-card-actions">
        {page?.address && (
          // The client's own view of it. `noreferrer` as well as `noopener`: which hub page
          // somebody opened a report from is nobody else's business.
          <a href={page.address} target="_blank" rel="noopener noreferrer">
            open
          </a>
        )}
        {page && <Link to={`/clients/${page.clientId}/access`}>custom content</Link>}
      </div>
    </div>
  );
}
