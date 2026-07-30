import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { EntityRef } from '@platform/contracts';
import { api } from '../../lib/api.js';
import { Comments } from '../../shell/Comments.js';
import { useDialog } from '../../shell/ui/Dialog.js';
import { Links } from '../../shell/Links.js';
import { Timeline } from '../../shell/Timeline.js';
import { EditableField } from '../crm/EditableField.js';
import type { Project } from '../crm/types.js';
import {
  PRIORITIES,
  daysBlocked,
  hours,
  toMinutes,
  type Board,
  type TaskDetail as Detail,
} from './types.js';

export function TaskDetail() {
  const { ask } = useDialog();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState<Detail | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [candidates, setCandidates] = useState<EntityRef[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const t = await api.get<Detail>(`/scrum/tasks/${id}`);
      setTask(t);
      const [b, p] = await Promise.all([
        api.get<Board>(`/scrum/boards/${t.projectId}`),
        api.get<Project>(`/crm/projects/${t.projectId}`),
      ]);
      setBoard(b);
      setProject(p);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
    Promise.all([
      api.get<Array<{ id: string; name: string }>>('/crm/projects'),
      api.get<Array<{ id: string; title: string }>>('/scrum/tasks'),
    ])
      .then(([ps, ts]) =>
        setCandidates([
          ...ps.map((p) => ref(p.id, 'project', p.name, `/crm/projects/${p.id}`)),
          ...ts.map((t) => ref(t.id, 'task', t.title, `/scrum/tasks/${t.id}`)),
        ]),
      )
      .catch(() => setCandidates([]));
  }, [id, load]);

  const patch = async (body: Record<string, unknown>) => {
    try {
      await api.patch(`/scrum/tasks/${id}`, body);
      await load();
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /**
   * Say what is in the way.
   *
   * The reason is required, so this asks for it rather than offering a bare toggle. A card
   * marked blocked with no reason is a red badge nobody can act on, and by the time somebody
   * asks, the answer has been forgotten — which is the failure the whole feature exists for.
   */
  const block = async () => {
    const answer = await ask({
      title: 'What is this blocked on?',
      confirmLabel: 'Mark blocked',
      fields: [
        {
          name: 'reason',
          label: 'Blocked on',
          required: true,
          placeholder: 'Waiting on the Snowflake credentials from IT',
          hint: 'One line. Whoever reads the board in a week should know what to chase.',
        },
      ],
    });
    if (!answer?.reason) return;
    try {
      await api.post(`/scrum/tasks/${id}/block`, { reason: answer.reason });
      await load();
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const unblock = async () => {
    try {
      await api.post(`/scrum/tasks/${id}/unblock`, {});
      await load();
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const startTimer = async () => {
    try {
      await api.post(`/scrum/tasks/${id}/start-timer`, {});
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const archive = async () => {
    await api.del(`/scrum/tasks/${id}`);
    navigate(`/scrum?projectId=${task?.projectId ?? ''}`);
  };

  if (!task) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;

  const estimate = hours(task.estimateMinutes);
  const logged = hours(task.loggedMinutes);
  const over = estimate != null && logged != null && logged > estimate;

  return (
    <>
      <p>
        <Link to={`/scrum?projectId=${task.projectId}`}>← Board</Link>
        {project && (
          <>
            {' · '}
            <Link to={`/crm/projects/${project.id}`}>{project.name}</Link>
          </>
        )}
      </p>
      <h1>{task.title}</h1>

      <div className="row">
        {board && (
          <select value={task.status} onChange={(e) => void patch({ status: e.target.value })}>
            {board.columns.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        )}
        <select value={task.priority} onChange={(e) => void patch({ priority: e.target.value })}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        {task.blockedReason ? (
          <button onClick={() => void unblock()}>Unblock</button>
        ) : (
          <button onClick={() => void block()}>Blocked?</button>
        )}
        <button onClick={() => void startTimer()}>Start timer</button>
        <button className="link-button destructive" onClick={() => void archive()}>
          archive
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {/* Before the fields, because it is the reason nothing is happening to this card. */}
      {task.blockedReason && (
        <div className="task-blocked task-blocked-detail">
          <span className="tag overdue">blocked</span> {task.blockedReason}{' '}
          <span className="muted">
            — for {daysBlocked(task.blockedSince)}{' '}
            {daysBlocked(task.blockedSince) === 1 ? 'day' : 'days'}
          </span>
        </div>
      )}

      <EditableField label="Title" value={task.title} onSave={(v) => patch({ title: v })} />
      <EditableField
        label="Description"
        value={task.description}
        placeholder="What needs doing?"
        multiline
        onSave={(v) => patch({ description: v })}
      />
      <EditableField
        label="Estimate (hours)"
        value={estimate?.toString() ?? null}
        onSave={(v) => patch({ estimateMinutes: v ? toMinutes(v) : null })}
      />
      {/* Beside the hours, not instead of them. Hours are what the budget and the invoice
          read; points are what the sprint reads. Neither converts to the other. */}
      <EditableField
        label="Story points"
        value={task.storyPoints?.toString() ?? null}
        placeholder="How big, relative to the others"
        onSave={(v) => patch({ storyPoints: v ? Number(v) : null })}
      />
      <EditableField
        label="Due"
        value={task.dueOn}
        placeholder="YYYY-MM-DD"
        onSave={(v) => patch({ dueOn: v })}
      />

      <section>
        <h2>Effort</h2>
        {/* The comparison this module exists for: estimated against actually logged. */}
        <p>
          <strong className={over ? 'error' : undefined}>{logged ?? 0}h logged</strong>
          {estimate != null ? (
            <span className="muted"> of {estimate}h estimated</span>
          ) : (
            <span className="muted"> · no estimate</span>
          )}
        </p>
        {task.assignee && <p className="muted">Assigned to {task.assignee.displayName}</p>}
      </section>

      {task.children.length > 0 && (
        <section>
          <h2>Subtasks</h2>
          <ul className="cards">
            {task.children.map((child) => (
              <li key={child.id}>
                <Link to={`/scrum/tasks/${child.id}`}>{child.title}</Link>{' '}
                <span className="muted">{child.status.replace(/_/g, ' ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Discussion</h2>
        <Comments entityId={id} />
      </section>

      <section>
        <h2>Links</h2>
        <Links entityId={id} candidates={candidates} onChange={() => setRefreshKey((k) => k + 1)} />
      </section>

      <section>
        <h2>Timeline</h2>
        <Timeline entityId={id} refreshKey={refreshKey} />
      </section>
    </>
  );
}

const ref = (id: string, entityType: string, displayName: string, urlPath: string): EntityRef => ({
  id,
  entityType,
  displayName,
  urlPath,
  deleted: false,
});
