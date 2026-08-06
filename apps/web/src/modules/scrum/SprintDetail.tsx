import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import type { EntityRef } from '@platform/contracts';
import { Links } from '../../shell/Links.js';
import { Timeline } from '../../shell/Timeline.js';
import { Empty } from '../../shell/ui/primitives.js';
import { useDocumentTitle } from '../../shell/useDocumentTitle.js';
import {
  deliveredFraction,
  deliveredLabel,
  hours,
  sprintFraction,
  sprintProgressLabel,
  type Sprint,
  type Task,
} from './types.js';

const ref = (id: string, entityType: string, displayName: string, urlPath: string): EntityRef => ({
  id,
  entityType,
  displayName,
  urlPath,
  deleted: false,
});

/**
 * One sprint.
 *
 * The manifest has advertised `/scrum/sprints/:id` since the module was written and nothing
 * ever registered a sprint, so the URL resolved to the shell's not-found page. Now that a
 * sprint is a real entity — searchable, linkable, on a timeline — it needs somewhere to land.
 *
 * What it shows is what the sprint history could not: the cards themselves. History answers
 * "how did the last four go"; this answers "what is in this one, and what happened to it".
 */
export function SprintDetail() {
  const { id } = useParams<{ id: string }>();
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [candidates, setCandidates] = useState<EntityRef[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string>();
  useDocumentTitle(sprint?.name ?? 'Sprint');

  const load = useCallback(() => {
    if (!id) return;
    api
      .get<Sprint>(`/scrum/sprints/${id}`)
      .then((s) => {
        setSprint(s);
        return api.get<Task[]>(
          `/scrum/tasks?projectId=${s.projectId}&includeCompleted=true&sprintId=${id}`,
        );
      })
      .then(setTasks)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(load, [load]);

  // What a sprint is worth linking to: the meetings that planned and reviewed it, and the
  // documents behind them. Cards already belong to it through sprint_id.
  useEffect(() => {
    Promise.all([
      api.get<Array<{ id: string; title: string }>>('/meetings/notes'),
      api.get<Array<{ id: string; name: string }>>('/crm/projects'),
    ])
      .then(([notes, projects]) =>
        setCandidates([
          ...notes.map((n) => ref(n.id, 'meeting_note', n.title, `/meetings/${n.id}`)),
          ...projects.map((p) => ref(p.id, 'project', p.name, `/crm/projects/${p.id}`)),
        ]),
      )
      .catch(() => setCandidates([]));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!sprint || !id) return <p className="muted">Loading…</p>;

  const { progress, summary } = sprint;
  /*
   * A finished sprint reads from its frozen summary, a running one from live progress.
   *
   * They are not the same question. Closing a sprint detaches everything unfinished, so the
   * live tables afterwards can only ever report a clean sweep — the summary is the record of
   * what was actually missed.
   */
  const fraction = summary ? deliveredFraction(summary) : sprintFraction(progress);

  return (
    <>
      <p>
        <Link to={`/scrum/sprints?projectId=${sprint.projectId}`}>← Sprints</Link>
      </p>
      <h1>{sprint.name}</h1>
      <p className="muted">
        {sprint.startsOn} → {sprint.endsOn} · {sprint.state}
      </p>
      {sprint.goal ? <p>{sprint.goal}</p> : <p className="muted">No goal was written.</p>}

      <section>
        <h2>{summary ? 'Delivered' : 'Progress'}</h2>
        <span className="meter" aria-label={summary ? deliveredLabel(summary) : sprintProgressLabel(progress)}>
          <span className="meter-fill" style={{ width: `${(fraction ?? 0) * 100}%` }} />
        </span>
        <p>{summary ? deliveredLabel(summary) : sprintProgressLabel(progress)}</p>
        {summary && summary.returnedToBacklog > 0 && (
          <p className="muted">
            {summary.returnedToBacklog} went back to the backlog when it closed.
          </p>
        )}
        {!summary && progress.blocked > 0 && (
          <p className="error">{progress.blocked} blocked.</p>
        )}
      </section>

      <section>
        <h2>Cards</h2>
        {tasks.length === 0 ? (
          <Empty>
            Nothing is in this sprint. Pull cards in from the backlog on the board.
          </Empty>
        ) : (
          <ul className="flow-list">
            {tasks.map((t) => (
              <li key={t.id}>
                <span className={`tag${t.completedAt ? '' : ' overdue'}`}>
                  {t.completedAt ? 'done' : t.status.replace(/_/g, ' ')}
                </span>
                <Link to={`/scrum/tasks/${t.id}`}>{t.title}</Link>
                {t.estimateMinutes != null && (
                  <span className="muted"> · {hours(t.estimateMinutes)}h</span>
                )}
                {t.blockedReason && <span className="error"> · blocked</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* The two panels every registered entity gets, and the reason registering mattered. */}
      <section>
        <h2>Links</h2>
        <Links
          entityId={id}
          candidates={candidates}
          onChange={() => {
            load();
            setRefreshKey((k) => k + 1);
          }}
        />
      </section>
      <section>
        <h2>Timeline</h2>
        <Timeline entityId={id} refreshKey={refreshKey} />
      </section>
    </>
  );
}
