import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { EntityRef } from '@platform/contracts';
import { api } from '../../lib/api.js';
import { Links } from '../../shell/Links.js';
import { Timeline } from '../../shell/Timeline.js';

interface Item {
  id: string;
  title: string;
  note: string | null;
}

/**
 * The screen that demonstrates the whole architecture: a module's own record, plus two
 * core-driven panels (links and timeline) that the module contributed no code to.
 */
export function DemoDetail() {
  const { id = '' } = useParams();
  const [item, setItem] = useState<Item | null>(null);
  const [candidates, setCandidates] = useState<EntityRef[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Item>(`/demo/items/${id}`)
      .then(setItem)
      .catch((e: Error) => setError(e.message));

    // Link candidates. A real module would use global search; the demo lists its own.
    api
      .get<{ items: Array<{ id: string; title: string }> }>('/demo/items')
      .then((r) =>
        setCandidates(
          r.items.map((i) => ({
            id: i.id,
            entityType: 'demo_item',
            displayName: i.title,
            urlPath: `/demo/items/${i.id}`,
            deleted: false,
          })),
        ),
      )
      .catch(() => setCandidates([]));
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!item) return <p className="muted">Loading…</p>;

  return (
    <>
      <p>
        <Link to="/demo/items">← Demo items</Link>
      </p>
      <h1>{item.title}</h1>
      {item.note && <p>{item.note}</p>}

      <section>
        <h2>Links</h2>
        <p className="muted">
          Contextual links live in the core, so any entity can link to any other — a link
          is visible only if you may see both ends.
        </p>
        <Links
          entityId={id}
          candidates={candidates}
          onChange={() => setRefreshKey((k) => k + 1)}
        />
      </section>

      <section>
        <h2>Timeline</h2>
        <p className="muted">
          Assembled by the core from registry entries, links, and events — this module
          contributed no code to this view. Linked entities&rsquo; activity appears here too.
        </p>
        <Timeline entityId={id} refreshKey={refreshKey} />
      </section>
    </>
  );
}
