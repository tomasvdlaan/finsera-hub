import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useDocumentTitle } from '../../shell/useDocumentTitle.js';

interface Task {
  id: string;
  projectId: string;
  title: string;
  status: string;
  priority: string;
  dueOn: string | null;
  estimateMinutes: number | null;
  labels: string[];
  blockedReason: string | null;
}

interface Project {
  id: string;
  name: string;
  clientName?: string;
}

/**
 * The columns a cross-project board groups by.
 *
 * Boards are per project — `boards` is keyed by projectId with its own `columns` jsonb — so
 * "the columns from the board config" has no referent once two projects diverge. This uses
 * the canonical set every board starts from, plus an Other lane so a task in a bespoke column
 * is visible rather than silently missing. Nothing is dropped, which is the only property that
 * matters for a board you plan from.
 */
const COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'to_do', label: 'To do' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'waiting_on_client', label: 'Waiting on client' },
  { key: 'review', label: 'Review' },
];

const OTHER = 'other';

/**
 * Every open card, everywhere.
 *
 * The per-project board at /scrum still exists and is still where you drag things within one
 * project. This answers the different question — what is on my plate across all of them —
 * which is the one you actually ask on a Monday and which no screen answered.
 *
 * Read-only on purpose. Dragging across projects would mean moving a card into a column its
 * own project may not have, and the server rightly refuses that; a board that offers a drag
 * which sometimes bounces is worse than one that does not offer it.
 */
export function Work() {
  useDocumentTitle('Work');
  const [tasks, setTasks] = useState<Task[]>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectFilter, setProjectFilter] = useState('');
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    // Every open status at once — the widened endpoint takes a repeated param, which is why
    // this page needed it before it could exist.
    const statuses = [...COLUMNS.map((c) => c.key)].map((s) => `status=${s}`).join('&');
    api
      .get<Task[]>(`/scrum/tasks?${statuses}`)
      .then(setTasks)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    api.get<Project[]>('/crm/projects').then(setProjects).catch(() => setProjects([]));
  }, [load]);

  const projectName = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );

  const visible = (tasks ?? []).filter((t) => !projectFilter || t.projectId === projectFilter);

  /** Anything in a column this board does not name still has to appear somewhere. */
  const columnOf = (t: Task) => (COLUMNS.some((c) => c.key === t.status) ? t.status : OTHER);
  const inColumn = (key: string) => visible.filter((t) => columnOf(t) === key);
  const other = inColumn(OTHER);

  const lanes = [...COLUMNS, ...(other.length > 0 ? [{ key: OTHER, label: 'Other' }] : [])];

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>Work</h1>
      <p className="muted">
        Every open card across all projects. Drag within a project on its own board — this is
        for seeing the whole plate at once.
      </p>

      <div className="row">
        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {tasks && (
          <span className="muted">
            {visible.length} open {visible.length === 1 ? 'card' : 'cards'}
          </span>
        )}
      </div>

      {tasks === undefined ? (
        <p className="muted">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="muted">
          Nothing open{projectFilter ? ' on this project' : ''}. Cards appear here from any
          project&rsquo;s board, and from meeting action points once you accept them.
        </p>
      ) : (
        <div className="work-board">
          {lanes.map(({ key, label }) => {
            const cards = inColumn(key);
            return (
              <div key={key} className="work-lane">
                <div className="work-lane-head">
                  {label} <span className="muted">{cards.length}</span>
                </div>
                {cards.map((t) => (
                  <Link key={t.id} to={`/scrum/tasks/${t.id}`} className="work-card">
                    <div>{t.title}</div>
                    {/* The reason a card is not moving outranks everything else about it. */}
                    {t.blockedReason && (
                      <div className="task-blocked">
                        <span className="tag overdue">blocked</span> {t.blockedReason}
                      </div>
                    )}
                    <div className="muted work-card-meta">
                      {projectName.get(t.projectId) ?? 'Project'}
                      {t.dueOn && ` · due ${t.dueOn}`}
                      {t.priority !== 'normal' && ` · ${t.priority}`}
                      {/* Shown because they are stored and indexed and no screen has ever
                          displayed them — every task's label array is empty in practice. */}
                      {t.labels?.length > 0 && ` · ${t.labels.join(', ')}`}
                    </div>
                  </Link>
                ))}
                {cards.length === 0 && <p className="muted work-lane-empty">—</p>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
