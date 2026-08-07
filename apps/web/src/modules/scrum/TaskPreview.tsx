import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRunningTimer } from '../../shell/useRunningTimer.js';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Comments } from '../../shell/Comments.js';
import { Avatar, Button } from '../../shell/ui/primitives.js';
import { MarkdownEditor } from '../../shell/ui/MarkdownEditor.js';
import {
  PRIORITIES,
  TASK_TYPES,
  daysBlocked,
  hours,
  toMinutes,
  type BoardColumn,
  type Person,
  type Sprint,
  type Task,
  type TaskDetail,
} from './types.js';

type Tab = 'detail' | 'subtasks' | 'discussion' | 'activity';

const when = (iso: string) =>
  new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

/**
 * A card, opened beside the board rather than instead of it.
 *
 * The board's only way into a task was a link to its own page, so every glance cost a
 * navigation and the loss of the column you were reading — which is why the page accumulated
 * everything and the board stayed a wall of titles. This is the cheap look: the description,
 * who is on it, what is left, what has been said, and where it has been, without leaving the
 * board you opened it from.
 *
 * Every edit here writes through the same PATCH the task page uses, and every change hands
 * control back to the board to reload. Two surfaces onto one record is only safe while
 * exactly one of them owns the data.
 */
export function TaskPreview({
  taskId,
  columns,
  people,
  sprints,
  onClose,
  onChanged,
}: {
  taskId: string;
  columns: BoardColumn[];
  people: Person[];
  sprints: Sprint[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const timer = useRunningTimer();
  const [tab, setTab] = useState<Tab>('detail');
  const [error, setError] = useState<string | null>(null);
  const [subtaskTitle, setSubtaskTitle] = useState('');
  const panel = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setTask(await api.get<TaskDetail>(`/scrum/tasks/${taskId}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [taskId]);

  useEffect(() => {
    setTask(null);
    setTab('detail');
    void load();
  }, [load]);

  /*
   * Escape closes it, from anywhere.
   *
   * Bound on the document rather than the panel because the focus is usually still on the
   * card that opened this, and a dismissal that only works once you have clicked inside is a
   * dismissal people stop reaching for.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const patch = async (body: Record<string, unknown>) => {
    try {
      await api.patch(`/scrum/tasks/${taskId}`, body);
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const addSubtask = async (e: FormEvent) => {
    e.preventDefault();
    const title = subtaskTitle.trim();
    if (!title || !task) return;
    setSubtaskTitle('');
    try {
      // A subtask is a task with a parent, so it inherits the project and nothing else. It
      // deliberately does not inherit the sprint: a checklist item is not a commitment.
      await api.post('/scrum/tasks', { projectId: task.projectId, title, parentId: task.id });
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  /** Tick a subtask by moving it to a done column — completion follows the column, always. */
  const toggleSubtask = async (child: Task) => {
    const done = columns.find((c) => c.isDone)?.key;
    const open = columns.find((c) => !c.isDone)?.key;
    const to = child.completedAt ? open : done;
    if (!to) return;
    try {
      await api.post(`/scrum/tasks/${child.id}/move`, { status: to });
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (error && !task) {
    return (
      <aside className="task-preview" ref={panel}>
        <p className="error">{error}</p>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </aside>
    );
  }

  if (!task) {
    return (
      <aside className="task-preview" aria-busy="true" ref={panel}>
        <p className="muted">Loading…</p>
      </aside>
    );
  }

  const estimate = hours(task.estimateMinutes);
  const logged = hours(task.loggedMinutes);
  const over = estimate != null && logged != null && logged > estimate;
  const done = task.children.filter((c) => c.completedAt).length;

  return (
    <aside
      className="task-preview"
      ref={panel}
      role="dialog"
      aria-label={`Preview of ${task.title}`}
    >
      <header className="preview-head">
        <div className="preview-title">
          <span className={`task-type task-type-${task.type}`} aria-hidden="true">
            {task.type[0]?.toUpperCase()}
          </span>
          <h2>{task.title}</h2>
        </div>
        <div className="row">
          {/* The page is still where you go to do more than glance — links, timeline, archive. */}
          <Link to={`/tasks/${task.id}`} className="muted">
            Open full
          </Link>
          {/*
            Start the clock on the thing you are looking at.
            
            The fastest way to start a timer used to be the sidebar, which cannot know what you
            are working on — so it produced an hour with no card, and the card's "0h of 8h"
            never moved however long you spent on it.
          */}
          <Button
            size="sm"
            variant="ghost"
            disabled={timer.busy || timer.running?.taskId === task.id}
            onClick={() =>
              // Switch rather than start: a clock already running is the ordinary case, and
              // "stop it first" is an instruction to go and find something.
              void timer.switchTo({ projectId: task.projectId, taskId: task.id }, task.title)
            }
          >
            {timer.running?.taskId === task.id
              ? 'Running'
              : timer.running
                ? 'Switch to this'
                : 'Start timer'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close preview">
            ✕
          </Button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {task.blockedReason && (
        <div className="task-blocked task-blocked-detail">
          <span className="tag overdue">blocked</span> {task.blockedReason}{' '}
          <span className="muted">— {daysBlocked(task.blockedSince)}d</span>
        </div>
      )}

      {/* The four things you change most, in one grid rather than a stack of labelled rows. */}
      <dl className="preview-fields">
        <dt>Status</dt>
        <dd>
          <select value={task.status} onChange={(e) => void patch({ status: e.target.value })}>
            {columns.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </dd>

        <dt>Assignee</dt>
        <dd className="preview-assignee">
          {task.assignee && (
            <Avatar id={task.assignee.id} name={task.assignee.displayName} size="sm" />
          )}
          <select
            value={task.assigneeId ?? ''}
            onChange={(e) => void patch({ assigneeId: e.target.value || null })}
          >
            <option value="">Unassigned</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        </dd>

        <dt>Priority</dt>
        <dd>
          <select value={task.priority} onChange={(e) => void patch({ priority: e.target.value })}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </dd>

        <dt>Type</dt>
        <dd>
          <select value={task.type} onChange={(e) => void patch({ type: e.target.value })}>
            {TASK_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </dd>

        <dt>Due</dt>
        <dd>
          <input
            type="date"
            value={task.dueOn ?? ''}
            onChange={(e) => void patch({ dueOn: e.target.value || null })}
            aria-label="Due date"
          />
        </dd>

        <dt>Estimate</dt>
        <dd>
          <input
            className="preview-hours"
            defaultValue={estimate ?? ''}
            placeholder="hours"
            aria-label="Estimate in hours"
            onBlur={(e) => {
              const next = e.target.value ? toMinutes(e.target.value) : null;
              if (next !== task.estimateMinutes) void patch({ estimateMinutes: next });
            }}
          />
          <span className={over ? 'error' : 'muted'}> {logged ?? 0}h logged</span>
        </dd>

        {sprints.length > 0 && (
          <>
            <dt>Sprint</dt>
            <dd>
              <select
                value={task.sprintId ?? ''}
                onChange={(e) => void patch({ sprintId: e.target.value || null })}
              >
                <option value="">Backlog</option>
                {sprints.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </dd>
          </>
        )}
      </dl>

      <nav className="preview-tabs" role="tablist">
        {(
          [
            ['detail', 'Description'],
            ['subtasks', task.children.length > 0 ? `Subtasks ${done}/${task.children.length}` : 'Subtasks'],
            ['discussion', 'Discussion'],
            ['activity', 'Activity'],
          ] as Array<[Tab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'chip chip-on' : 'chip'}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="preview-body">
        {tab === 'detail' && (
          <MarkdownEditor
            value={task.description ?? ''}
            label="Description"
            placeholder="What needs doing? Paste a screenshot straight in."
            onSave={(markdown) => void patch({ description: markdown || null })}
          />
        )}

        {tab === 'subtasks' && (
          <>
            <ul className="subtask-list">
              {task.children.map((child) => (
                <li key={child.id} className={child.completedAt ? 'is-done' : undefined}>
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(child.completedAt)}
                      onChange={() => void toggleSubtask(child)}
                    />
                    <span>{child.title}</span>
                  </label>
                  <Link to={`/tasks/${child.id}`} className="muted">
                    open
                  </Link>
                </li>
              ))}
            </ul>
            {task.children.length === 0 && (
              <p className="muted">
                Nothing broken out yet. A subtask is a real card — it can be estimated, assigned
                and timed like any other.
              </p>
            )}
            <form onSubmit={(e) => void addSubtask(e)} className="row">
              <input
                value={subtaskTitle}
                onChange={(e) => setSubtaskTitle(e.target.value)}
                placeholder="Add a subtask"
                aria-label="New subtask"
                style={{ flex: 1 }}
              />
              <Button type="submit" size="sm" disabled={!subtaskTitle.trim()}>
                Add
              </Button>
            </form>
          </>
        )}

        {tab === 'discussion' && <Comments entityId={task.id} />}

        {tab === 'activity' && (
          <ol className="activity">
            {task.history.map((h) => (
              <li key={h.id}>
                <span className="activity-dot" aria-hidden="true" />
                <div>
                  <strong>
                    {h.fromStatus
                      ? `${label(columns, h.fromStatus)} → ${label(columns, h.toStatus)}`
                      : `Created in ${label(columns, h.toStatus)}`}
                  </strong>
                  <span className="muted">
                    {' '}
                    · {h.movedByName ?? 'someone'} · {when(h.at)}
                  </span>
                </div>
              </li>
            ))}
            {task.history.length === 0 && (
              /* Transitions have only been recorded since the log was added, so a card older
                 than that has nothing to show and should say why rather than look broken. */
              <p className="muted">
                No moves recorded. Only changes made since the board started keeping a trail
                appear here.
              </p>
            )}
          </ol>
        )}
      </div>
    </aside>
  );
}

const label = (columns: BoardColumn[], key: string) =>
  columns.find((c) => c.key === key)?.label ?? key.replace(/_/g, ' ');
