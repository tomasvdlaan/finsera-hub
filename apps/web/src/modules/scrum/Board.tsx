import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { api } from '../../lib/api.js';
import type { Project } from '../crm/types.js';
import { SprintBar } from './SprintBar.js';
import { TaskCard } from './TaskCard.js';
import {
  TASK_TYPES,
  hours,
  toMinutes,
  type BoardColumn,
  type Board as BoardType,
  type Sprint,
  type Task,
  type TaskType,
} from './types.js';

/**
 * What the board is showing.
 *
 * A board that always shows everything is a backlog, and a backlog is not a thing you can
 * stand in front of for fifteen minutes. When a sprint is running the default is the sprint,
 * because that is the commitment; the other two are how you get cards into it and how you
 * find the one you half-remember.
 */
type Scope = 'sprint' | 'backlog' | 'all';

function Column({
  column,
  tasks,
  columns,
  onMove,
  onPull,
}: {
  column: BoardColumn;
  tasks: Task[];
  columns: Array<{ key: string; label: string }>;
  onMove: (
    taskId: string,
    status: string,
    neighbours?: { beforeTaskId?: string | null; afterTaskId?: string | null },
  ) => void;
  /** Offered only while looking at the backlog with a sprint to pull into. */
  onPull?: (taskId: string) => void;
}) {
  // Droppable on the column itself, so an empty column is still a valid target.
  const { setNodeRef, isOver } = useDroppable({ id: `column:${column.key}` });
  const estimate = tasks.reduce((sum, t) => sum + (t.estimateMinutes ?? 0), 0);

  /*
   * Over the limit — said, not enforced.
   *
   * The point of a WIP limit is to make starting a fifth thing feel like a decision rather
   * than a reflex. A board that refuses the drop gets worked around within a week; a board
   * that turns the number red gets argued with, which is the conversation the limit is for.
   */
  const limit = column.wipLimit ?? null;
  const over = limit != null && tasks.length > limit;

  return (
    <div className={`board-column${isOver ? ' over' : ''}${over ? ' wip-exceeded' : ''}`} ref={setNodeRef}>
      <div className="board-column-head">
        <strong>{column.label}</strong>
        <span className={over ? 'error' : 'muted'}>
          {tasks.length}
          {limit != null && ` / ${limit}`}
          {estimate > 0 && ` · ${hours(estimate)}h`}
        </span>
      </div>
      {over && (
        <p className="wip-warning" role="status">
          Over the limit — finish something before starting another.
        </p>
      )}

      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="board-column-body">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              columns={columns}
              onMove={(status) => onMove(task.id, status)}
              onPull={onPull && (() => onPull(task.id))}
            />
          ))}
          {tasks.length === 0 && <p className="muted">—</p>}
        </div>
      </SortableContext>
    </div>
  );
}

/**
 * The board (Phase 4 brief §6).
 *
 * One project at a time, columns from that project's board configuration — including
 * "waiting on client", which is where consultancy work actually spends its time.
 */
export function Board() {
  const [params, setParams] = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(params.get('projectId') ?? '');
  const [board, setBoard] = useState<BoardType | null>(null);
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [planned, setPlanned] = useState<Sprint | null>(null);
  const [scope, setScope] = useState<Scope>('all');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [estimate, setEstimate] = useState('');
  const [type, setType] = useState<TaskType>('story');
  const [busy, setBusy] = useState(false);

  const sensors = useSensors(
    // A small distance so a click on a card is not swallowed as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  useEffect(() => {
    api
      .get<Project[]>('/crm/projects')
      .then((ps) => {
        setProjects(ps);
        setProjectId((current) => current || (ps[0]?.id ?? ''));
      })
      .catch(() => setProjects([]));
  }, []);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const [b, t, s, all] = await Promise.all([
        api.get<BoardType>(`/scrum/boards/${projectId}`),
        /*
         * Completed cards included, unlike everywhere else that lists tasks.
         *
         * `listTasks` hides them by default and is right to: a cross-project list of
         * everything ever finished is unreadable within a month. A board is the one place
         * that is not true, because it has a Done column whose entire job is to hold them —
         * and without this that column is permanently empty while the sprint meter above it
         * reports work as finished. Two things on the same screen contradicting each other.
         */
        api.get<Task[]>(`/scrum/tasks?projectId=${projectId}&includeCompleted=true`),
        api.get<Sprint | null>(`/scrum/projects/${projectId}/sprint`).catch(() => null),
        api.get<Sprint[]>(`/scrum/sprints?projectId=${projectId}`).catch(() => []),
      ]);
      setBoard(b);
      setTasks(t);
      setSprint(s);
      // The next one waiting, oldest first — you start the sprint you planned, not the most
      // recent thing you typed.
      setPlanned(
        all
          .filter((x) => x.state === 'planned')
          .sort((a, z) => a.startsOn.localeCompare(z.startsOn))[0] ?? null,
      );
      /*
       * The running sprint becomes the default view the moment there is one, and stops being
       * it the moment there is not.
       *
       * Sticking on 'sprint' after a sprint is completed would show an empty board and no
       * explanation, which reads as data loss — the cards went back to the backlog, and the
       * board should follow them there.
       */
      setScope((current) =>
        s ? (current === 'all' ? 'sprint' : current) : current === 'sprint' ? 'all' : current,
      );
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    if (projectId) setParams({ projectId }, { replace: true });
  }, [load, projectId, setParams]);

  const shown = useMemo(() => {
    if (!sprint || scope === 'all') return tasks;
    return scope === 'sprint'
      ? tasks.filter((t) => t.sprintId === sprint.id)
      : tasks.filter((t) => t.sprintId === null);
  }, [tasks, sprint, scope]);

  const byColumn = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const column of board?.columns ?? []) map.set(column.key, []);
    for (const task of shown) map.get(task.status)?.push(task);
    return map;
  }, [board, shown]);

  /**
   * Moves are applied locally first, then confirmed by the server.
   *
   * A card that snaps back for a moment while a request completes reads as a bug, and
   * this is the interaction people repeat dozens of times a day.
   */
  /**
   * `beforeTaskId` is the card ABOVE the dropped one, `afterTaskId` the card below.
   *
   * The names read backwards from the drag's point of view and that is exactly how this
   * broke: the drop handler passed its target as `afterTaskId`, meaning "the target sits
   * below me", so every card-onto-card drag landed above the card it was dropped on. The
   * client now speaks the server's vocabulary rather than guessing at it.
   */
  const move = async (
    taskId: string,
    status: string,
    neighbours: { beforeTaskId?: string | null; afterTaskId?: string | null } = {},
  ) => {
    const previous = tasks;
    setTasks((current) => current.map((t) => (t.id === taskId ? { ...t, status } : t)));
    try {
      await api.post(`/scrum/tasks/${taskId}/move`, { status, ...neighbours });
      await load();
    } catch (e) {
      setTasks(previous); // the server refused; show the truth
      setError((e as Error).message);
    }
  };

  /**
   * Put a backlog card into the running sprint.
   *
   * A PATCH of one field rather than a bespoke endpoint: `sprintId` is already writable, and
   * sprint planning is the same edit whether it happens here or on the task page.
   */
  const pull = async (taskId: string) => {
    if (!sprint) return;
    const previous = tasks;
    setTasks((current) =>
      current.map((t) => (t.id === taskId ? { ...t, sprintId: sprint.id } : t)),
    );
    try {
      await api.patch(`/scrum/tasks/${taskId}`, { sprintId: sprint.id });
      await load();
    } catch (e) {
      setTasks(previous);
      setError((e as Error).message);
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    const taskId = String(event.active.id);
    const over = event.over?.id ? String(event.over.id) : null;
    if (!over) return;

    if (over.startsWith('column:')) {
      const status = over.slice('column:'.length);
      const task = tasks.find((t) => t.id === taskId);
      if (task && task.status !== status) void move(taskId, status);
      return;
    }

    // Dropped onto another card: take that card's column, and sit after it — so the
    // target is the card ABOVE, which the server calls beforeTaskId.
    const target = tasks.find((t) => t.id === over);
    if (!target || target.id === taskId) return;
    void move(taskId, target.status, { beforeTaskId: target.id });
  };

  const addTask = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !projectId) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/scrum/tasks', {
        projectId,
        title: title.trim(),
        type,
        estimateMinutes: toMinutes(estimate),
      });
      setTitle('');
      setEstimate('');
      // The type is not reset: bugs arrive in clusters, and so do chores.
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (projects.length === 0) {
    return (
      <>
        <h1>Board</h1>
        <p className="muted">Create a project first — a board belongs to one.</p>
      </>
    );
  }

  return (
    <>
      <h1>Board</h1>

      <div className="row">
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          aria-label="Project"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="muted">
          {shown.filter((t) => !t.completedAt).length} open of {shown.length}
        </span>
        {/* Pushed to the far end: you configure a board rarely and read it constantly. */}
        <Link to={`/scrum/settings?projectId=${projectId}`} className="muted board-settings-link">
          Columns
        </Link>
      </div>

      <SprintBar projectId={projectId} active={sprint} planned={planned} onChange={load} />

      {/* Only once there is a sprint to be inside or outside of. Three tabs on a flow board
          would be three ways to see the same list. */}
      {sprint && (
        <div className="row scope-switch" role="group" aria-label="What to show">
          {/* "This sprint" rather than its name: the bar directly above says which sprint,
              and a chip carrying a full sprint title wraps the row onto three lines. */}
          {(
            [
              ['sprint', 'This sprint'],
              ['backlog', 'Backlog'],
              ['all', 'Everything'],
            ] as Array<[Scope, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={scope === key ? 'chip chip-on' : 'chip'}
              aria-pressed={scope === key}
              onClick={() => setScope(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={(e) => void addTask(e)} className="row">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New task"
          aria-label="New task title"
          style={{ flex: 1, minWidth: 200 }}
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as TaskType)}
          aria-label="Task type"
        >
          {TASK_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          value={estimate}
          onChange={(e) => setEstimate(e.target.value)}
          placeholder="est. hours"
          aria-label="Estimate in hours"
          style={{ width: 110 }}
        />
        <button type="submit" disabled={busy || !title.trim()}>
          Add
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {board && (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
          <div className="board">
            {board.columns.map((column) => (
              <Column
                key={column.key}
                column={column}
                tasks={byColumn.get(column.key) ?? []}
                columns={board.columns}
                onMove={move}
                onPull={sprint && scope === 'backlog' ? pull : undefined}
              />
            ))}
          </div>
        </DndContext>
      )}

      <p className="muted">
        Drag a card by its handle, or use the dropdown on any card to move it with the keyboard.
      </p>
    </>
  );
}
