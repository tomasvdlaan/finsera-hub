import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../../shell/ui/layout.js';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { EntityRef } from '@platform/contracts';
import { api } from '../../lib/api.js';
import { Comments } from '../../shell/Comments.js';
import { useDialog } from '../../shell/ui/Dialog.js';
import { Links } from '../../shell/Links.js';
import { Timeline } from '../../shell/Timeline.js';
import { MarkdownEditor } from '../../shell/ui/MarkdownEditor.js';
import { EditableField } from '../crm/EditableField.js';
import type { Project } from '../crm/types.js';
import {
  PRIORITIES,
  TASK_TYPES,
  daysBlocked,
  hours,
  toMinutes,
  type Board,
  type Sprint,
  type TaskDetail as Detail,
} from './types.js';

export function TaskDetail() {
  const { ask } = useDialog();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState<Detail | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [people, setPeople] = useState<Array<{ id: string; displayName: string }>>([]);
  const [candidates, setCandidates] = useState<EntityRef[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const t = await api.get<Detail>(`/scrum/tasks/${id}`);
      setTask(t);
      const [b, p, s] = await Promise.all([
        api.get<Board>(`/scrum/boards/${t.projectId}`),
        api.get<Project>(`/crm/projects/${t.projectId}`),
        // A card can only join a sprint of its own project, so this waits for the task.
        api.get<Sprint[]>(`/scrum/sprints?projectId=${t.projectId}`).catch(() => []),
      ]);
      setBoard(b);
      setProject(p);
      setSprints(s);
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
          ...ps.map((p) => ref(p.id, 'project', p.name, `/projects/${p.id}`)),
          ...ts.map((t) => ref(t.id, 'task', t.title, `/tasks/${t.id}`)),
        ]),
      )
      .catch(() => setCandidates([]));
    api
      .get<Array<{ id: string; displayName: string }>>('/core/users')
      .then(setPeople)
      .catch(() => setPeople([]));
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
    navigate(`/board?projectId=${task?.projectId ?? ''}`);
  };

  if (!task) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;

  const estimate = hours(task.estimateMinutes);
  const logged = hours(task.loggedMinutes);
  const over = estimate != null && logged != null && logged > estimate;

  return (
    <>
      <PageHeader
        title={task.title}
        back={{ to: `/board?projectId=${task.projectId}`, label: 'Board' }}
        meta={
          <>
          {project && (
            <Link to={`/projects/${project.id}`}>{project.name}</Link>
          )}
          </>
        }
      />

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
        <select
          value={task.priority}
          onChange={(e) => void patch({ priority: e.target.value })}
          aria-label="Priority"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        {/* Type sits with status and priority because it is the same kind of fact — what this
            card *is* — and because velocity that counts bug-fixing as delivered value is a
            lie nobody notices until the sprint after. */}
        <select
          value={task.type}
          onChange={(e) => void patch({ type: e.target.value })}
          aria-label="Type"
        >
          {TASK_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
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
      {/*
        The description, in the same Markdown the meeting notes are written in.

        Rich rather than plain because a card is usually explained with a screenshot, a
        checklist or a snippet, and a plain textarea forces all three into prose. Saved when it
        loses focus rather than on every keystroke — this is a field on a form, not a
        collaborative document, and a PATCH per character is a write nobody asked for.
      */}
      {/* A div rather than a label: a contenteditable is not a labelable control, and
          wrapping one in a <label> makes the browser redirect the click at nothing, so the
          editor never takes focus and the field silently refuses to be typed in. */}
      <div className="field">
        <span className="field-label" id="task-description-label">
          Description
        </span>
        <MarkdownEditor
          value={task.description ?? ''}
          label="Description"
          placeholder="What needs doing? Paste a screenshot straight in."
          onSave={(markdown) => void patch({ description: markdown || null })}
        />
      </div>
      <EditableField
        label="Estimate (hours)"
        value={estimate?.toString() ?? null}
        onSave={(v) => patch({ estimateMinutes: v ? toMinutes(v) : null })}
      />
      <EditableField
        label="Due"
        value={task.dueOn}
        placeholder="YYYY-MM-DD"
        onSave={(v) => patch({ dueOn: v })}
      />

      <div className="row">
        <label className="field">
          <span className="field-label">Assignee</span>
          <select
            value={task.assigneeId ?? ''}
            onChange={(e) => void patch({ assigneeId: e.target.value || null })}
          >
            {/* Unassigned is a real state — the backlog is mostly made of it — so it is an
                option rather than the absence of one. */}
            <option value="">Unassigned</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        </label>

        {/*
          Optional, and only offered once the project has a sprint to join.

          A card that belongs to no sprint is the backlog, which is where most cards should be
          — so this never nags, and a project running a flow board never sees it at all.
        */}
        {sprints.length > 0 && (
          <label className="field">
            <span className="field-label">Sprint</span>
            <select
              value={task.sprintId ?? ''}
              onChange={(e) => void patch({ sprintId: e.target.value || null })}
            >
              <option value="">Backlog — no sprint</option>
              {sprints.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.state === 'active' ? ' (active)' : s.state === 'completed' ? ' (done)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

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
        {/* Where it is and how long it has been there — measured from the last move, not the
            last edit, so correcting a typo does not make a stalled card look fresh. The
            column's own label rather than its key, or "in_progress" reads as "In in progress". */}
        <p className="muted">
          In {board?.columns.find((c) => c.key === task.status)?.label ?? task.status} for{' '}
          {task.daysInColumn} {task.daysInColumn === 1 ? 'day' : 'days'}
        </p>
      </section>

      {task.children.length > 0 && (
        <section data-span={6}>
          <h2>Subtasks</h2>
          <ul className="cards">
            {task.children.map((child) => (
              <li key={child.id}>
                <Link to={`/tasks/${child.id}`}>{child.title}</Link>{' '}
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

      <section data-span={6}>
        <h2>Links</h2>
        <Links entityId={id} candidates={candidates} onChange={() => setRefreshKey((k) => k + 1)} />
      </section>

      <section data-span={6}>
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
