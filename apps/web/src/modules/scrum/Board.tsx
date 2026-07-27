import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import { TaskCard } from './TaskCard.js';
import { hours, toMinutes, type Board as BoardType, type Task } from './types.js';

function Column({
  column,
  tasks,
  columns,
  onMove,
}: {
  column: { key: string; label: string; isDone: boolean };
  tasks: Task[];
  columns: Array<{ key: string; label: string }>;
  onMove: (taskId: string, status: string, afterTaskId?: string | null) => void;
}) {
  // Droppable on the column itself, so an empty column is still a valid target.
  const { setNodeRef, isOver } = useDroppable({ id: `column:${column.key}` });
  const estimate = tasks.reduce((sum, t) => sum + (t.estimateMinutes ?? 0), 0);

  return (
    <div className={`board-column${isOver ? ' over' : ''}`} ref={setNodeRef}>
      <div className="board-column-head">
        <strong>{column.label}</strong>
        <span className="muted">
          {tasks.length}
          {estimate > 0 && ` · ${hours(estimate)}h`}
        </span>
      </div>

      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="board-column-body">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              columns={columns}
              onMove={(status) => onMove(task.id, status)}
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
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [estimate, setEstimate] = useState('');
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
      const [b, t] = await Promise.all([
        api.get<BoardType>(`/scrum/boards/${projectId}`),
        api.get<Task[]>(`/scrum/tasks?projectId=${projectId}`),
      ]);
      setBoard(b);
      setTasks(t);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    if (projectId) setParams({ projectId }, { replace: true });
  }, [load, projectId, setParams]);

  const byColumn = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const column of board?.columns ?? []) map.set(column.key, []);
    for (const task of tasks) map.get(task.status)?.push(task);
    return map;
  }, [board, tasks]);

  /**
   * Moves are applied locally first, then confirmed by the server.
   *
   * A card that snaps back for a moment while a request completes reads as a bug, and
   * this is the interaction people repeat dozens of times a day.
   */
  const move = async (taskId: string, status: string, afterTaskId?: string | null) => {
    const previous = tasks;
    setTasks((current) => current.map((t) => (t.id === taskId ? { ...t, status } : t)));
    try {
      await api.post(`/scrum/tasks/${taskId}/move`, { status, afterTaskId });
      await load();
    } catch (e) {
      setTasks(previous); // the server refused; show the truth
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

    // Dropped onto another card: take that card's column, and sit after it.
    const target = tasks.find((t) => t.id === over);
    if (!target || target.id === taskId) return;
    void move(taskId, target.status, target.id);
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
        estimateMinutes: toMinutes(estimate),
      });
      setTitle('');
      setEstimate('');
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
          {tasks.filter((t) => !t.completedAt).length} open of {tasks.length}
        </span>
      </div>

      <form onSubmit={(e) => void addTask(e)} className="row">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New task"
          aria-label="New task title"
          style={{ flex: 1, minWidth: 200 }}
        />
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
