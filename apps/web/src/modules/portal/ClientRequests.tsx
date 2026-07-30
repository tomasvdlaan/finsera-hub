import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Empty } from '../../shell/ui/primitives.js';

interface OpenRequest {
  id: string;
  subject: string;
  body: string;
  created_at: string;
  client_id: string;
  client_name: string;
  asked_by: string | null;
  project_id: string | null;
}

interface Project {
  id: string;
  name: string;
  clientId: string;
}

const day = (iso: string) =>
  new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

/**
 * Client requests waiting to be dealt with.
 *
 * The body is shown as a quotation rather than as a heading or a task title, because it is
 * text written by someone outside the business. Deciding what it becomes — and which
 * project it belongs to — is the whole reason a request is not a task on arrival.
 */
export function ClientRequests() {
  const [rows, setRows] = useState<OpenRequest[]>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const load = () => {
    api
      .get<OpenRequest[]>('/portal-preview/requests')
      .then(setRows)
      .catch((err: Error) => setError(err.message));
  };

  useEffect(() => {
    load();
    api.get<Project[]>('/crm/projects').then(setProjects).catch(() => setProjects([]));
  }, []);

  const act = (id: string, run: Promise<unknown>) => {
    setError(undefined);
    setBusy(id);
    run
      .then(load)
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(undefined));
  };

  if (error) return <p className="error">{error}</p>;
  if (!rows) return <p className="muted">Loading…</p>;
  if (rows.length === 0) return <Empty>No open client requests.</Empty>;

  return (
    <div>
      {rows.map((r) => {
        const theirs = projects.filter((p) => p.clientId === r.client_id);
        const projectId = chosen[r.id] ?? r.project_id ?? theirs[0]?.id ?? '';
        return (
          <div
            key={r.id}
            style={{
              border: '1px solid var(--line, #e4e4e7)',
              borderRadius: '.5rem',
              padding: '.9rem',
              marginBottom: '.75rem',
              background: '#fff',
            }}
          >
            <strong>{r.subject}</strong>
            <p className="muted" style={{ margin: '.25rem 0' }}>
              <Link to={`/crm/clients/${r.client_id}`}>{r.client_name}</Link>
              {r.asked_by ? ` · ${r.asked_by}` : ''} · {day(r.created_at)}
            </p>
            <blockquote
              style={{
                margin: '.5rem 0',
                paddingLeft: '.75rem',
                borderLeft: '3px solid var(--line, #e4e4e7)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {r.body}
            </blockquote>
            <div className="row" style={{ gap: '.5rem', alignItems: 'center' }}>
              <select
                value={projectId}
                onChange={(e) => setChosen((c) => ({ ...c, [r.id]: e.target.value }))}
              >
                <option value="">Pick a project…</option>
                {theirs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                disabled={!projectId || busy === r.id}
                onClick={() =>
                  act(r.id, api.post(`/portal-preview/requests/${r.id}/convert`, { projectId }))
                }
              >
                Make a task
              </button>
              <button
                disabled={busy === r.id}
                onClick={() => act(r.id, api.post(`/portal-preview/requests/${r.id}/decline`, {}))}
              >
                Dismiss
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
