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

const when = (iso: string) =>
  new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

const label = (columns: BoardColumn[], key: string) =>
  columns.find((c) => c.key === key)?.label ?? key.replace(/_/g, ' ');

/**
 * One task, opened over the board.
 *
 * It replaces a side panel, and the reason is what the panel could not hold. A description is
 * rich text that wants sixty-odd characters of measure, and a thread has replies that indent —
 * neither survives a 560px column, so the panel had the description behind one tab and the
 * discussion behind another, which is a way of saying it had room for neither.
 *
 * What a modal costs is the board, and that cost is paid back in the header: the arrows step
 * through the same cards in the same order as the column you opened this from, so working
 * down a column never means closing and reopening. That was the panel's one real advantage.
 *
 * Every edit writes through the same PATCH the task page uses and then hands control back to
 * the board to reload. Two surfaces onto one record is only safe while exactly one of them
 * owns the data.
 */
export function TaskModal({
  taskId,
  columns,
  people,
  sprints,
  projectName,
  siblings,
  onNavigate,
  onClose,
  onChanged,
}: {
  taskId: string;
  columns: BoardColumn[];
  people: Person[];
  sprints: Sprint[];
  projectName?: string;
  /** The cards either side of this one, in the order the board is showing them. */
  siblings: string[];
  onNavigate: (taskId: string) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const timer = useRunningTimer();
  const [error, setError] = useState<string | null>(null);
  const [subtaskTitle, setSubtaskTitle] = useState('');
  const [blocking, setBlocking] = useState(false);
  const [reason, setReason] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);

  const at = siblings.indexOf(taskId);
  const previous = at > 0 ? siblings[at - 1] : undefined;
  const next = at >= 0 && at < siblings.length - 1 ? siblings[at + 1] : undefined;

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
    setBlocking(false);
    void load();
  }, [load]);

  /*
   * Escape closes; the arrows walk the column.
   *
   * Bound on the document rather than the dialog because focus is often still on the card
   * that opened this. The arrow keys are ignored while something is being typed into, or
   * moving the caret through a description would also change the task underneath it.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape arrives as the dialog's `cancel` event instead — see onCancel above.
      const target = e.target as HTMLElement | null;
      const typing =
        target?.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '');
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft' && previous) onNavigate(previous);
      if (e.key === 'ArrowRight' && next) onNavigate(next);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onNavigate, previous, next]);

  /*
   * Open it, and let the browser do the rest.
   *
   * `showModal()` moves focus in, traps it, makes everything behind inert and restores focus
   * to whatever opened it on close — all of which this component used to half-do by hand.
   */
  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
    return () => {
      if (el?.open) el.close();
    };
  }, []);

  const patch = async (body: Record<string, unknown>) => {
    try {
      await api.patch(`/scrum/tasks/${taskId}`, body);
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const block = async (input: { reason: string; blockedOnUserId?: string | null }) => {
    try {
      await api.post(`/scrum/tasks/${taskId}/block`, input);
      setBlocking(false);
      setReason('');
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const unblock = async () => {
    try {
      await api.post(`/scrum/tasks/${taskId}/unblock`, {});
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

  /*
   * A real `<dialog>`, opened with showModal().
   *
   * Not a positioned div with a high z-index, which is what this was and why the top bar
   * stayed lit above the scrim: `.topbar` is sticky and sits in its own stacking context, so
   * no number on a descendant of `main` can climb over it. `showModal()` puts the element in
   * the top layer, above every stacking context on the page by construction, and brings the
   * things a modal is supposed to have — the background goes inert, focus is trapped, and the
   * backdrop is a real pseudo-element rather than a div pretending.
   */
  const shell = (children: React.ReactNode) => (
    <dialog
      className="task-modal"
      ref={dialog}
      aria-label={task ? task.title : 'Task'}
      /* Escape fires `cancel` natively; the browser would otherwise close it behind React's back. */
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      /* A click on the backdrop lands on the dialog itself, never on its contents. */
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      {children}
    </dialog>
  );

  if (error && !task) {
    return shell(
      <div className="task-modal-empty">
        <p className="error">{error}</p>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>,
    );
  }

  if (!task) {
    return shell(
      <div className="task-modal-empty" aria-busy="true">
        <p className="muted">Loading…</p>
      </div>,
    );
  }

  const estimate = hours(task.estimateMinutes);
  const logged = hours(task.loggedMinutes);
  const over = estimate != null && logged != null && logged > estimate;
  const doneChildren = task.children.filter((c) => c.completedAt).length;
  const bar =
    estimate != null && estimate > 0 && logged != null
      ? Math.min(100, Math.round((logged / estimate) * 100))
      : null;

  return shell(
    <>
      <header className="task-modal-head">
        {/*
          What the drawer was better at, bought back.

          Half the reason to open a card is to decide what to do next, and that means opening
          four of them. Closing and reopening between each was the panel's whole advantage;
          the arrows keep it, and say where you are so the end of the column is not a surprise.
        */}
        <div className="task-modal-step">
          <Button
            size="sm"
            variant="ghost"
            disabled={!previous}
            aria-label="Previous card"
            onClick={() => previous && onNavigate(previous)}
          >
            ‹
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!next}
            aria-label="Next card"
            onClick={() => next && onNavigate(next)}
          >
            ›
          </Button>
          {at >= 0 && (
            <span className="faint">
              {at + 1} of {siblings.length} in {label(columns, task.status)}
            </span>
          )}
        </div>

        <span className="task-modal-where muted">{projectName}</span>

        <div className="task-modal-out">
          {/* The page is still where you go for links, the timeline and archiving. */}
          <Link to={`/tasks/${task.id}`} className="muted">
            Open full page
          </Link>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </div>
      </header>

      <div className="task-modal-body">
        <div className="task-modal-main">
          {error && <p className="error">{error}</p>}

          <div className="task-badges">
            <span className={`badge type-${task.type}`}>{task.type}</span>
            {task.priority !== 'normal' && (
              <span className={`badge priority-${task.priority}`}>{task.priority}</span>
            )}
            {task.labels.map((l) => (
              <span key={l} className="badge">
                {l}
              </span>
            ))}
          </div>

          <h2 className="task-modal-title">{task.title}</h2>

          {/*
            Blocked, and who by.

            `blockedOnUserId` has been accepted by this endpoint, published in a view, read by
            an insight rule and rendered by a Today widget called "blocked on you" since the
            day it was added — and no screen has ever set it, so that widget could never fire.
            This is the control it was waiting for.
          */}
          {task.blockedReason ? (
            <div className="task-block-banner">
              <div className="task-block-head">
                <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M6 1.2 11 10H1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                  <path d="M6 4.6v2.1M6 8.3v.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                <strong>Blocked for {daysBlocked(task.blockedSince)} days</strong>
                <span className="task-card-gap" />
                <Button size="sm" variant="ghost" onClick={() => void unblock()}>
                  Unblock
                </Button>
              </div>
              <p className="task-block-reason">{task.blockedReason}</p>
              <label className="task-block-who">
                <span className="faint">Waiting on</span>
                <select
                  value={task.blockedOnUserId ?? ''}
                  aria-label="Who we are waiting on"
                  onChange={(e) =>
                    void block({
                      // The reason is unchanged; re-blocking keeps the original date, so the
                      // clock still measures how long the work has been stuck.
                      reason: task.blockedReason!,
                      blockedOnUserId: e.target.value || null,
                    })
                  }
                >
                  <option value="">Nobody in particular</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : blocking ? (
            <form
              className="task-block-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (reason.trim()) void block({ reason });
              }}
            >
              <input
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="What is it waiting on?"
                aria-label="Why it is blocked"
              />
              <Button type="submit" size="sm" disabled={!reason.trim()}>
                Block
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setBlocking(false)}>
                Cancel
              </Button>
            </form>
          ) : null}

          <div className="task-modal-section">
            <h3>Description</h3>
            <MarkdownEditor
              value={task.description ?? ''}
              label="Description"
              toolbar
              placeholder="What needs doing? Paste a screenshot straight in."
              onSave={(markdown) => void patch({ description: markdown || null })}
            />
          </div>

          <div className="task-modal-section">
            <h3>
              Subtasks{' '}
              {task.children.length > 0 && (
                <span className="faint">
                  {doneChildren} of {task.children.length}
                </span>
              )}
            </h3>
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
          </div>

          {/*
            In the page, not behind a tab.

            The thread was on the task page only, so from the board you could neither read a
            conversation nor join one — and a comment nobody sees is a comment nobody writes.
          */}
          <div className="task-modal-section">
            <h3>Discussion {task.commentCount > 0 && <span className="faint">{task.commentCount}</span>}</h3>
            <Comments entityId={task.id} />
          </div>
        </div>

        <aside className="task-modal-side">
          {/*
            Start the clock on the thing you are looking at.

            The fastest way to start a timer used to be the sidebar, which cannot know what you
            are working on — so it produced an hour with no card, and the card's "0h of 8h"
            never moved however long you spent on it.
          */}
          <Button
            variant="primary"
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

          <div className="task-time">
            <div className="task-time-line">
              <span>
                <strong>{logged ?? 0}h</strong> logged
              </span>
              <span className="faint">{estimate != null ? `of ${estimate}h` : 'no estimate'}</span>
            </div>
            {bar !== null && (
              <span className="task-time-bar" aria-hidden="true">
                <span className={over ? 'over' : undefined} style={{ width: `${bar}%` }} />
              </span>
            )}
            {/* Named rather than merely coloured: the number that matters is how far over. */}
            {over && estimate != null && logged != null && (
              <p className="task-time-over">
                {Math.round((logged - estimate) * 10) / 10}h over — worth re-estimating or splitting
              </p>
            )}
          </div>

          <dl className="task-props">
            <dt>Column</dt>
            <dd>
              <select value={task.status} onChange={(e) => void patch({ status: e.target.value })}>
                {columns.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
              {task.daysInColumn > 0 && <span className="faint"> {task.daysInColumn}d here</span>}
            </dd>

            <dt>Assignee</dt>
            <dd className="task-prop-assignee">
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
                className="task-prop-hours"
                defaultValue={estimate ?? ''}
                placeholder="hours"
                aria-label="Estimate in hours"
                onBlur={(e) => {
                  const next = e.target.value ? toMinutes(e.target.value) : null;
                  if (next !== task.estimateMinutes) void patch({ estimateMinutes: next });
                }}
              />
            </dd>
          </dl>

          {!task.blockedReason && !blocking && (
            <Button size="sm" variant="ghost" onClick={() => setBlocking(true)}>
              Mark blocked
            </Button>
          )}

          <div className="task-modal-history">
            <h3>History</h3>
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
          </div>
        </aside>
      </div>
    </>,
  );
}
