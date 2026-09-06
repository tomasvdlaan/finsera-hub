import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { TimelineEntry } from '@platform/contracts';
import { api } from '../lib/api.js';

/**
 * The activity timeline (Master §13).
 *
 * This component knows nothing about demo items, clients, or projects — it renders
 * whatever the core returns. Every future module's entities appear here automatically,
 * because the core assembles the view from registry entries, links, and events.
 */
export function Timeline({ entityId, refreshKey }: { entityId: string; refreshKey?: number }) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<TimelineEntry[]>(`/core/timeline/${entityId}`)
      .then(setEntries)
      .catch((e: Error) => setError(e.message));
  }, [entityId, refreshKey]);

  if (error) return <p className="error">{error}</p>;
  if (entries.length === 0) return <p className="muted">No activity yet.</p>;

  return (
    <ol className="timeline">
      {entries.map((e) => (
        <li key={e.eventId}>
          <span className="timeline-event">{e.eventName}</span>
          <Link to={e.subject.urlPath} className={e.subject.deleted ? 'deleted' : ''}>
            {e.subject.displayName}
          </Link>
          <span className="muted">
            {/* An outsider — a client signing in to their portal — has no user row to
                resolve, so the event names them itself. "by system" for a person who was
                plainly there is worse than saying nothing. */}
            {` by ${e.actor?.displayName ?? e.actorLabel ?? 'system'}`} ·{' '}
            {new Date(e.createdAt).toLocaleString()}
          </span>
        </li>
      ))}
    </ol>
  );
}
