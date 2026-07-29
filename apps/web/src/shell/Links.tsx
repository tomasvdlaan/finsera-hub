import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import type { EntityRef, Link } from '@platform/contracts';
import { api } from '../lib/api.js';

const KINDS = ['about', 'discussed', 'originated_from', 'relates_to'];

/**
 * Contextual links for an entity, plus a picker to create one.
 *
 * Like the timeline, this is core-driven: it renders registry refs, so it can link a
 * demo item today and an invoice or expense later with no changes.
 */
export function Links({
  entityId,
  candidates,
  onChange,
}: {
  entityId: string;
  candidates: EntityRef[];
  onChange?: () => void;
}) {
  const [links, setLinks] = useState<Link[]>([]);
  const [targetId, setTargetId] = useState('');
  const [kind, setKind] = useState(KINDS[0]!);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .get<Link[]>(`/core/links/${entityId}`)
      .then(setLinks)
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void load();
  }, [entityId]);

  const create = async () => {
    if (!targetId) return;
    setError(null);
    try {
      await api.post('/core/links', { fromId: entityId, toId: targetId, kind });
      setTargetId('');
      await load();
      onChange?.();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (linkId: string) => {
    await api.del(`/core/links/${linkId}`);
    await load();
    onChange?.();
  };

  const others = candidates.filter((c) => c.id !== entityId);

  return (
    <div>
      {links.length === 0 ? (
        <p className="muted">No links yet.</p>
      ) : (
        <ul className="links">
          {links.map((l) => {
            const other = l.from.id === entityId ? l.to : l.from;
            return (
              <li key={l.id}>
                <span className="badge">{l.kind ?? 'linked'}</span>
                <RouterLink to={other.urlPath}>{other.displayName}</RouterLink>
                <button className="link-button destructive" onClick={() => void remove(l.id)}>
                  remove
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="row">
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          <option value="">Link to…</option>
          {others.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName}
            </option>
          ))}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <button onClick={() => void create()} disabled={!targetId}>
          Link
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
