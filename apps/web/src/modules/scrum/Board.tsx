import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { PageHeader } from '../../shell/ui/layout.js';
import { BoardTabs } from './BoardTabs.js';
import { useSearchParams } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { api } from '../../lib/api.js';
import { useToast } from '../../shell/ui/Toast.js';
import type { Project } from '../crm/types.js';
import { Avatar } from '../../shell/ui/primitives.js';
import { parseQuickAdd } from './quickAdd.js';
import { SprintBar } from './SprintBar.js';
import { TaskCard, TaskCardGhost } from './TaskCard.js';
import { TaskModal } from './TaskModal.js';
import {
  PRIORITIES,
  TASK_TYPES,
  hours,
  type BoardColumn,
  type Board as BoardType,
  type Person,
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

/**
 * Left and right change the column; up and down reorder within it.
 *
 * The stock sortable getter treats every droppable the same, and cards are droppables too —
 * so "right" would find the card sitting a fraction of a pixel to the right in the same
 * column and go there, and you pressed the key twice to move once. On a board the two axes
 * mean different things: sideways is the status, downwards is the order. This says so.
 *
 * It hands the vertical keys straight back to the sortable getter rather than reimplementing
 * ordering, because ordering is the part dnd-kit already gets right.
 */
const boardKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') {
    return sortableKeyboardCoordinates(event, args);
  }

  const { collisionRect, droppableRects, droppableContainers } = args.context;
  if (!collisionRect) return undefined;

  const columns = droppableContainers
    .getEnabled()
    .flatMap((c) => {
      const rect = String(c.id).startsWith('column:') ? droppableRects.get(c.id) : undefined;
      return rect ? [rect] : [];
    })
    .sort((a, b) => a.left - b.left);

  // Which column the card is over, by its middle — a card straddling a gap belongs to
  // whichever column it mostly covers, which is what it looks like it belongs to.
  const middle = collisionRect.left + collisionRect.width / 2;
  const here = columns.findIndex((r) => middle >= r.left && middle <= r.right);
  const next = columns[here + (event.code === 'ArrowRight' ? 1 : -1)];
  if (here === -1 || !next) return undefined;

  // Keep the inset and the height, so the card lands beside where it came from rather than
  // snapping to the top of a column it has nothing to do with yet.
  return { x: next.left + (collisionRect.left - columns[here]!.left), y: collisionRect.top };
};

function Column({
  column,
  tasks,
  wip,
  columns,
  onPull,
  onOpen,
  openId,
  collapsed,
  onToggleCollapse,
}: {
  column: BoardColumn;
  tasks: Task[];
  /**
   * How many cards are really in this column, filters and lanes ignored.
   *
   * `tasks` is what is on screen. Counting the limit against that meant narrowing to one
   * person, or to bugs, made a column look within its limit — the number moved when the view
   * moved. This is the same count the server checks on a drop.
   */
  wip: number;
  columns: Array<{ key: string; label: string }>;
  /** Offered only while looking at the backlog with a sprint to pull into. */
  onPull?: (taskId: string) => void;
  onOpen?: (taskId: string) => void;
  openId?: string | null;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
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
  const over = limit != null && wip > limit;

  /*
   * Collapsed, a column becomes a spine.
   *
   * A board with a "waiting on client" column that is always empty and a "done" column with
   * four months in it spends most of its width on things nobody is reading. Folding one keeps
   * it as a drop target — which is the whole point, and why this is not simply hiding it.
   */
  if (collapsed) {
    return (
      <div
        className={`board-column is-collapsed${isOver ? ' over' : ''}`}
        ref={setNodeRef}
        onClick={onToggleCollapse}
      >
        <button type="button" className="column-spine" aria-label={`Expand ${column.label}`}>
          <span className="column-spine-count">{tasks.length}</span>
          <span className="column-spine-label">{column.label}</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className={`board-column${isOver ? ' over' : ''}${over ? ' wip-exceeded' : ''}${column.isDone ? ' is-done-column' : ''}`}
      ref={setNodeRef}
    >
      <div className="board-column-head">
        <button
          type="button"
          className="column-fold"
          onClick={onToggleCollapse}
          aria-label={`Collapse ${column.label}`}
          title="Collapse"
        >
          ‹
        </button>
        <strong>{column.label}</strong>
        {/*
          A limited column counts itself, not the view.

          Without a limit the number answers "how many am I looking at", which is what a filter
          is for. With one it has to answer "how close is this to its limit", and that question
          does not change because you narrowed to bugs — reading 1/2 while three cards sit
          there is the number lying in the flattering direction. When the two differ, both are
          shown rather than picking one and hoping.
        */}
        <span className={over ? 'error' : 'muted'}>
          {limit != null ? `${wip} / ${limit}` : tasks.length}
          {limit != null && wip !== tasks.length && ` · ${tasks.length} shown`}
          {estimate > 0 && ` · ${hours(estimate)}h`}
        </span>
      </div>
      {/* A hairline that fills toward the limit — the count says the number, this says how
          close, which is the thing you want to notice without reading. */}
      {limit != null && (
        <span className="wip-track" aria-hidden="true">
          <span
            className={over ? 'wip-track-fill is-over' : 'wip-track-fill'}
            style={{ width: `${Math.min(100, (tasks.length / limit) * 100)}%` }}
          />
        </span>
      )}
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
              onPull={onPull && (() => onPull(task.id))}
              onOpen={onOpen && (() => onOpen(task.id))}
              selected={openId === task.id}
            />
          ))}
          {tasks.length === 0 && <p className="board-column-empty muted">Drop a card here</p>}
        </div>
      </SortableContext>
    </div>
  );
}

/** What the rows are grouped by. 'none' is one board, the way it has always been. */
type Lane = 'none' | 'assignee' | 'priority' | 'type';

interface Filters {
  assignee: string | null;
  type: string | null;
  priority: string | null;
  label: string | null;
  flag: 'blocked' | 'overdue' | 'stale' | null;
  /**
   * Show cards that belong to another card.
   *
   * Off by default. A subtask is a real task — that is what lets it be estimated, assigned and
   * timed — but three checklist items sitting in To Do beside their own parent is the same
   * work counted twice, and it makes the column count lie. They are still reachable: they are
   * on their parent, and turning this on puts them back on the board where they can be
   * dragged and assigned like anything else.
   */
  subtasks: boolean;
}

const NO_FILTERS: Filters = {
  assignee: null,
  type: null,
  priority: null,
  label: null,
  flag: null,
  subtasks: false,
};

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
  /**
   * Which popover the toolbar has open.
   *
   * Filters and quick-add used to be two permanent rows. They are still both here — the same
   * controls, the same parser — but a control you use twice a day should not cost a row of
   * the page every day, and the board is what the page is for.
   */
  const [panel, setPanel] = useState<'filters' | 'add' | null>(null);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<TaskType>('story');
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [sprintList, setSprintList] = useState<Sprint[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [lane, setLane] = useState<Lane>('none');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** The card currently being carried, so the overlay has something to draw. */
  const [carried, setCarried] = useState<Task | null>(null);
  const toast = useToast();

  const sensors = useSensors(
    // A small distance so a click on a card is not swallowed as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    /*
     * The keyboard has to be able to do this too.
     *
     * Dragging is the only way to change a column now that the per-card select is gone, so a
     * board you cannot drag is a board you cannot use. Space picks a card up, the arrows
     * carry it, space puts it down.
     */
    useSensor(KeyboardSensor, { coordinateGetter: boardKeyboardCoordinates }),
  );

  useEffect(() => {
    api
      .get<Project[]>('/crm/projects')
      .then((ps) => {
        setProjects(ps);
        setProjectId((current) => current || (ps[0]?.id ?? ''));
      })
      .catch(() => setProjects([]));
    // Needed by the quick-add parser and the preview's assignee select, so it is fetched once
    // for the page rather than per card.
    api
      .get<Person[]>('/core/users')
      .then(setPeople)
      .catch(() => setPeople([]));
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
      setSprintList(all);
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

  /*
   * The real occupancy of each column, before any filter touches it.
   *
   * Counted the way the server counts it on a drop — open, not archived, not a subtask — so
   * the number beside a limit means the same thing on both sides of the wire.
   */
  const wipOf = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tasks) {
      if (t.completedAt || t.parentId) continue;
      counts.set(t.status, (counts.get(t.status) ?? 0) + 1);
    }
    return counts;
  }, [tasks]);

  const inScope = useMemo(() => {
    if (!sprint || scope === 'all') return tasks;
    return scope === 'sprint'
      ? tasks.filter((t) => t.sprintId === sprint.id)
      : tasks.filter((t) => t.sprintId === null);
  }, [tasks, sprint, scope]);

  /*
   * Filtered in the browser rather than re-queried.
   *
   * The whole board is already loaded — it has to be, or the columns cannot show counts — so
   * a round trip per filter change would buy nothing and cost a flicker on every click.
   * `listTasks` still takes these as query parameters for the callers that need them.
   */
  const shown = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return inScope.filter((t) => {
      if (!filters.subtasks && t.parentId) return false;
      if (filters.assignee === 'none' && t.assigneeId !== null) return false;
      if (filters.assignee && filters.assignee !== 'none' && t.assigneeId !== filters.assignee)
        return false;
      if (filters.type && t.type !== filters.type) return false;
      if (filters.priority && t.priority !== filters.priority) return false;
      if (filters.label && !t.labels.includes(filters.label)) return false;
      if (filters.flag === 'blocked' && !t.blockedReason) return false;
      if (filters.flag === 'overdue' && !(t.dueOn && !t.completedAt && t.dueOn < today))
        return false;
      if (filters.flag === 'stale' && (t.completedAt || t.daysInColumn < 5)) return false;
      return true;
    });
  }, [inScope, filters]);

  /** Every label in use on this board, so the filter offers what exists and nothing else. */
  const labels = useMemo(
    () => [...new Set(inScope.flatMap((t) => t.labels))].sort(),
    [inScope],
  );

  const filtered =
    Boolean(filters.assignee || filters.type || filters.priority || filters.label || filters.flag) ||
    filters.subtasks;

  /**
   * How many filters are on, for the badge on the closed button.
   *
   * The count rather than a dot, because "some are set" and "four are set" are different
   * amounts of not-seeing-your-board, and the first is the number people talk themselves
   * past when a column looks emptier than they expected.
   */
  const activeFilters = [
    filters.assignee,
    filters.type,
    filters.priority,
    filters.label,
    filters.flag,
    filters.subtasks || null,
  ].filter(Boolean).length;

  /*
   * Swimlanes: the same columns, split into rows.
   *
   * A column with thirty cards is a list, and the question people actually bring to a board —
   * what is everyone on, what is urgent — is a grouping the columns cannot express because
   * the columns are already spent on status.
   */
  const lanes = useMemo((): Array<{ key: string; label: string; person?: Person; tasks: Task[] }> => {
    if (lane === 'none') return [{ key: 'all', label: '', tasks: shown }];

    if (lane === 'assignee') {
      const groups = new Map<string, { label: string; person?: Person; tasks: Task[] }>();
      for (const t of shown) {
        const key = t.assigneeId ?? 'none';
        const entry = groups.get(key) ?? {
          label: t.assignee?.displayName ?? 'Unassigned',
          person: t.assignee ?? undefined,
          tasks: [],
        };
        entry.tasks.push(t);
        groups.set(key, entry);
      }
      // Unassigned last: it is a bucket, not a person, and it is usually the biggest.
      return [...groups.entries()]
        .map(([key, v]) => ({ key, ...v }))
        .sort((a, b) =>
          a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.label.localeCompare(b.label),
        );
    }

    // Priority and type both have a fixed vocabulary, so the lanes keep their meaningful
    // order rather than sorting alphabetically into nonsense (high, low, normal, urgent).
    const order = lane === 'priority' ? [...PRIORITIES].reverse() : TASK_TYPES;
    return order
      .map((key) => ({
        key,
        label: key,
        tasks: shown.filter((t) => (lane === 'priority' ? t.priority : t.type) === key),
      }))
      .filter((l) => l.tasks.length > 0);
  }, [shown, lane]);

  /**
   * The cards either side of an open one, for the modal's arrows.
   *
   * Its own column, in the order the board is drawing it — which is the order the eye was
   * going in, and which already has the filters, the scope and the sort applied. Reading it
   * off `shown` rather than off the server means the arrows can never offer a card the board
   * is currently hiding.
   */
  const siblingsOf = useCallback(
    (id: string) => {
      const here = shown.find((t) => t.id === id);
      if (!here) return [id];
      return shown.filter((t) => t.status === here.status).map((t) => t.id);
    },
    [shown],
  );

  const columnsOf = useCallback(
    (list: Task[]) => {
      const map = new Map<string, Task[]>();
      for (const column of board?.columns ?? []) map.set(column.key, []);
      for (const task of list) map.get(task.status)?.push(task);
      return map;
    },
    [board],
  );

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
      const moved = await api.post<{ warnings?: Array<{ message: string }> }>(
        `/scrum/tasks/${taskId}/move`,
        { status, ...neighbours },
      );
      /*
       * Said, not refused — and now said by the server rather than only drawn by the browser.
       *
       * The move has already happened by the time this shows. The point of a WIP limit is to
       * make starting a fifth thing feel like a decision, not to stop the person who is
       * dealing with something urgent; the breach is recorded in the audit log either way, so
       * a retrospective can count them.
       */
      for (const w of moved?.warnings ?? []) toast.fail(w.message);
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

  const onDragStart = (event: DragStartEvent) => {
    setCarried(tasks.find((t) => t.id === String(event.active.id)) ?? null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    setCarried(null);
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

  const parsed = useMemo(() => parseQuickAdd(title, people), [title, people]);

  const addTask = async (e: FormEvent) => {
    e.preventDefault();
    if (!parsed.title || !projectId) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/scrum/tasks', {
        projectId,
        title: parsed.title,
        // The select is the default; anything typed on the line wins, because it was typed
        // more recently and more deliberately.
        type: parsed.type ?? type,
        priority: parsed.priority,
        labels: parsed.labels,
        assigneeId: parsed.assigneeId,
        estimateMinutes: parsed.estimateMinutes,
        // A card added while looking at a sprint belongs to it. Added from the backlog or a
        // flow board, it does not — which is the same rule the scope switch already implies.
        sprintId: scope === 'sprint' && sprint ? sprint.id : undefined,
      });
      setTitle('');
      // The type is not reset: bugs arrive in clusters, and so do chores.
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /*
   * The keyboard, on the board itself.
   *
   * Not a shortcut sheet — three keys that make the board usable without a pointer at all:
   * `n` to type a new card, `f` to reach the filters, Escape to clear them and close the
   * preview. Everything else already works through Tab, because the cards are buttons.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // Never while someone is typing — this is the bug that makes shortcuts hated.
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'n') {
        e.preventDefault();
        setPanel('add');
        // After the panel exists. Focusing before it renders finds nothing and silently
        // leaves the key looking broken.
        requestAnimationFrame(() =>
          document.querySelector<HTMLInputElement>('.quick-add input')?.focus(),
        );
      }
      if (e.key === 'f') {
        e.preventDefault();
        setPanel('filters');
        requestAnimationFrame(() =>
          document.querySelector<HTMLSelectElement>('.filter-bar select')?.focus(),
        );
      }
      if (e.key === 'Escape') {
        // In order of what is most likely to be in the way.
        if (panel) return setPanel(null);
        setOpenId(null);
        setFilters(NO_FILTERS);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [panel]);

  if (projects.length === 0) {
    return (
      <>
        <PageHeader title="Board" subtitle="Create a project first — a board belongs to one." />
      </>
    );
  }

  return (
    <>
      {/*
        One line, where there were six.

        The page header, the tabs, the sprint prompt, the quick-add and the filters each had a
        row of their own, and together they pushed the first card past the halfway mark of the
        screen — 476px of chrome above 300px of board. None of them is gone: the ones you
        reach for many times a day stayed on the line, and the two you open, use and close
        became popovers hung off it.

        The title went entirely. "Board" was the word directly under the nav item reading
        Board, and the project's name is the thing that actually identifies what you are
        looking at.
      */}
      <div className="board-toolbar" data-span={12}>
        <select
          className="board-project"
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
        <span className="faint board-count">
          {shown.filter((t) => !t.completedAt).length} open of {shown.length}
        </span>

        <span className="board-toolbar-sep" aria-hidden="true" />
        <BoardTabs projectId={projectId} />

        <span className="board-toolbar-gap" />

        <button
          type="button"
          className={panel === 'filters' ? 'chip chip-on' : 'chip'}
          aria-expanded={panel === 'filters'}
          onClick={() => setPanel((p) => (p === 'filters' ? null : 'filters'))}
        >
          Filters
          {/*
            How many are on, always, next to the word.

            A filtered board is a board that is lying to you about what exists, and the one
            unforgivable version of this design is hiding the filters without saying that
            some are set.
          */}
          {activeFilters > 0 && <span className="chip-count">{activeFilters}</span>}
        </button>

        <span className="filter-lanes">
          <label htmlFor="lane-select" className="faint">
            Group
          </label>
          <select id="lane-select" value={lane} onChange={(e) => setLane(e.target.value as Lane)}>
            <option value="none">No lanes</option>
            <option value="assignee">By person</option>
            <option value="priority">By priority</option>
            <option value="type">By type</option>
          </select>
        </span>

        <SprintBar projectId={projectId} active={sprint} planned={planned} onChange={load} compact />

        <button
          type="button"
          className={panel === 'add' ? 'chip chip-on' : 'chip'}
          aria-expanded={panel === 'add'}
          onClick={() => setPanel((p) => (p === 'add' ? null : 'add'))}
        >
          + Task
        </button>

        {/*
          The two lines of keyboard instructions that used to sit under the board, moved
          behind the mark people press when they want them. They are a first-week aid and
          they were costing a permanent row.
        */}
        <details className="board-help">
          <summary aria-label="Keyboard shortcuts">?</summary>
          <div className="board-help-body">
            Drag a card anywhere on it to move it, or click its title to open it. From the
            keyboard: <kbd>space</kbd> to pick a card up, <kbd>←</kbd> <kbd>→</kbd> to change
            column, <kbd>↑</kbd> <kbd>↓</kbd> to reorder, <kbd>space</kbd> to drop.{' '}
            <kbd>n</kbd> new · <kbd>f</kbd> filter · <kbd>Esc</kbd> clear
          </div>
        </details>
      </div>

      {/* A running sprint has a goal, dates and a meter, and earns the row the prompt did not. */}
      {(sprint || planned) && (
        <SprintBar projectId={projectId} active={sprint} planned={planned} onChange={load} />
      )}

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

      {panel === 'add' && (
      <div className="board-panel" data-span={12}>
      <form onSubmit={(e) => void addTask(e)} className="row quick-add">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New task — try  !high  @name  #label  ~2h  bug"
          aria-label="New task"
          aria-describedby="quick-add-hint"
          style={{ flex: 1, minWidth: 240 }}
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
        <button type="submit" disabled={busy || !parsed.title}>
          Add
        </button>
      </form>

      {/*
        What the line was understood to mean, before anything is created.

        A parser that acts silently is a parser you cannot trust with a title, so it shows its
        working — and because it only ever removes tokens it recognised, what is left is
        exactly the title you will get.
      */}
      {parsed.recognised.length > 0 && (
        <p className="quick-add-read muted" id="quick-add-hint" aria-live="polite">
          <strong>{parsed.title || '(no title yet)'}</strong>
          {parsed.recognised.map((r) => (
            <span key={r.token} className="tag">
              {r.means}
            </span>
          ))}
        </p>
      )}
      </div>
      )}

      {/*
        Filters and lanes, in one row.

        Both answer the same complaint — a board of forty cards in five columns is a wall —
        and both are view state rather than stored state: nothing here is saved, because a
        filter you forgot you set is a board that lies to you tomorrow morning.
      */}
      {panel === 'filters' && (
      <div className="board-panel" data-span={12}>
      <div className="row filter-bar" role="group" aria-label="Filter and group">
        <select
          value={filters.assignee ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, assignee: e.target.value || null }))}
          aria-label="Filter by assignee"
        >
          <option value="">Anyone</option>
          <option value="none">Unassigned</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>

        <select
          value={filters.type ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value || null }))}
          aria-label="Filter by type"
        >
          <option value="">Any type</option>
          {TASK_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <select
          value={filters.priority ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value || null }))}
          aria-label="Filter by priority"
        >
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        {/* Only offered when the board actually has labels on it. */}
        {labels.length > 0 && (
          <select
            value={filters.label ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, label: e.target.value || null }))}
            aria-label="Filter by label"
          >
            <option value="">Any label</option>
            {labels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        )}

        {/* The three questions worth one click: what is stuck, what is late, what is rotting. */}
        {(
          [
            ['blocked', 'Blocked'],
            ['overdue', 'Overdue'],
            ['stale', 'Sitting 5d+'],
          ] as Array<[NonNullable<Filters['flag']>, string]>
        ).map(([key, text]) => (
          <button
            key={key}
            type="button"
            className={filters.flag === key ? 'chip chip-on' : 'chip'}
            aria-pressed={filters.flag === key}
            onClick={() => setFilters((f) => ({ ...f, flag: f.flag === key ? null : key }))}
          >
            {text}
          </button>
        ))}

        <button
          type="button"
          className={filters.subtasks ? 'chip chip-on' : 'chip'}
          aria-pressed={filters.subtasks}
          onClick={() => setFilters((f) => ({ ...f, subtasks: !f.subtasks }))}
          title="Subtasks live on their parent card unless you ask for them here"
        >
          Subtasks
        </button>

        {filtered && (
          <button type="button" className="chip" onClick={() => setFilters(NO_FILTERS)}>
            Clear
          </button>
        )}
      </div>
      </div>
      )}

      {error && <p className="error">{error}</p>}

      {board && (
        <div className={openId ? 'board-stage has-preview' : 'board-stage'}>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={() => setCarried(null)}
          >
            <div className="board-lanes">
              {lanes.map((swim) => {
                const byColumn = columnsOf(swim.tasks);
                return (
                  <section key={swim.key} className="board-lane">
                    {lane !== 'none' && (
                      <header className="lane-head">
                        {swim.person ? (
                          <Avatar id={swim.person.id} name={swim.person.displayName} size="sm" />
                        ) : (
                          <span className="avatar avatar-sm avatar-empty" aria-hidden="true">
                            ?
                          </span>
                        )}
                        <strong>{swim.label}</strong>
                        <span className="muted">{swim.tasks.length}</span>
                      </header>
                    )}
                    <div className="board">
                      {board.columns.map((column) => (
                        <Column
                          key={column.key}
                          column={column}
                          tasks={byColumn.get(column.key) ?? []}
                          wip={wipOf.get(column.key) ?? 0}
                          columns={board.columns}
                          onPull={sprint && scope === 'backlog' ? pull : undefined}
                          onOpen={setOpenId}
                          openId={openId}
                          collapsed={collapsed.has(column.key)}
                          onToggleCollapse={() =>
                            setCollapsed((c) => {
                              const next = new Set(c);
                              if (next.has(column.key)) next.delete(column.key);
                              else next.add(column.key);
                              return next;
                            })
                          }
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
              {lanes.length === 0 && (
                <p className="muted">Nothing matches those filters.</p>
              )}
            </div>

            {/*
              The card you are actually carrying.
              
              Portalled to the document root by dnd-kit, which is what lets it cross columns
              and escape `.board`'s scroll container — the original stays in place, dimmed, so
              the column keeps its shape while you decide.
            */}
            <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
              {carried && board && <TaskCardGhost task={carried} columns={board.columns} />}
            </DragOverlay>
          </DndContext>

        </div>
      )}

      {/*
        Outside the board, because it is over it rather than beside it.

        `siblings` is the column the card is in, in the order the board is drawing it — so the
        arrows in the modal walk the same list your eye was walking, filters and lanes and all.
      */}
      {openId && board && (
        <TaskModal
          key={openId}
          taskId={openId}
          columns={board.columns}
          people={people}
          sprints={sprintList}
          projectName={projects.find((p) => p.id === projectId)?.name}
          siblings={siblingsOf(openId)}
          onNavigate={setOpenId}
          onClose={() => setOpenId(null)}
          onChanged={load}
        />
      )}
    </>
  );
}
