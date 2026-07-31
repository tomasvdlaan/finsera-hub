import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Avatar } from '../../shell/ui/primitives.js';
import { firstImage } from '../../shell/ui/MarkdownEditor.js';
import { ageTone, daysBlocked, hours, isOverdue, type Task } from './types.js';

/** A letter and a colour, so type is readable at a glance without spending a word on it. */
const TYPE_MARK: Record<string, { mark: string; label: string }> = {
  story: { mark: 'S', label: 'Story' },
  bug: { mark: 'B', label: 'Bug' },
  chore: { mark: 'C', label: 'Chore' },
  spike: { mark: '?', label: 'Spike' },
};

/**
 * A card on the board.
 *
 * Three ways to act on it, because a board that only responds to a pointer is unusable
 * one-handed and untestable without one: drag it by the handle, move it with the column
 * select, or open it into the preview beside the board.
 *
 * The title is a button rather than a link now. It used to navigate to the task page, which
 * meant glancing at a card cost you the board you were reading. The page still exists and the
 * preview links to it; this is the cheap look.
 *
 * What a card shows is ordered by what stops work rather than by what describes it: the
 * blocker first, then how long it has sat still, then the picture, then everything that is
 * merely true about it.
 */
export interface TaskCardProps {
  task: Task;
  columns: Array<{ key: string; label: string }>;
  onMove: (status: string) => void;
  /** Put this into the running sprint. Passed only while looking at the backlog. */
  onPull?: () => void;
  /** Open it in the preview beside the board. */
  onOpen?: () => void;
  selected?: boolean;
}

export function TaskCard(props: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
  });

  return (
    <CardBody
      {...props}
      dragging={isDragging}
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      handle={
        // Only the handle starts a drag, so the title stays clickable and selectable.
        <button
          className="drag-handle"
          {...attributes}
          {...listeners}
          aria-label={`Move ${props.task.title}`}
        >
          ⠿
        </button>
      }
    />
  );
}

/**
 * The card as it looks while being carried.
 *
 * Rendered into dnd-kit's `DragOverlay`, which portals it to the document root — which is the
 * point. `verticalListSortingStrategy` only positions items within one list, so the moment a
 * card crossed into another column it stopped being transformed and sat frozen at its origin
 * while the pointer carried on without it. An overlay is the documented answer for a board
 * with more than one column, and it incidentally escapes `.board`'s scroll container, which
 * was clipping the card as well.
 */
export function TaskCardGhost({ task, columns }: { task: Task; columns: TaskCardProps['columns'] }) {
  return <CardBody task={task} columns={columns} onMove={() => undefined} isGhost />;
}

const CardBody = forwardRef<
  HTMLDivElement,
  TaskCardProps & {
    dragging?: boolean;
    isGhost?: boolean;
    style?: CSSProperties;
    handle?: ReactNode;
  }
>(function CardBody(
  { task, columns, onMove, onPull, onOpen, selected, dragging, isGhost, style, handle },
  ref,
) {

  const estimate = hours(task.estimateMinutes);
  const overdue = isOverdue(task);
  const type = TYPE_MARK[task.type] ?? TYPE_MARK.story!;
  const stale = task.completedAt ? null : ageTone(task.daysInColumn);

  /*
   * The thumbnail is read out of the description rather than stored beside it.
   *
   * A screenshot is how most of these cards are actually explained — a broken visual, a
   * mock-up, a chart that is wrong. Deriving it means changing the picture in the description
   * changes the card, with nothing left to remember and nothing to go stale.
   */
  const thumbnail = firstImage(task.description);

  const classes = [
    'task-card',
    `task-card-${task.type}`,
    dragging && 'dragging',
    isGhost && 'is-ghost',
    stale && `age-${stale}`,
    task.blockedReason && 'is-blocked',
    selected && 'is-selected',
    task.completedAt && 'is-done',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={ref} className={classes} style={style}>
      {handle ?? <span className="drag-handle" aria-hidden="true">⠿</span>}

      <div className="task-card-body">
        <div className="task-card-title">
          <span className={`task-type task-type-${task.type}`} title={type.label} aria-hidden="true">
            {type.mark}
          </span>
          <button
            type="button"
            className="task-open"
            onClick={onOpen}
            aria-haspopup="dialog"
            aria-label={`Open ${task.title}`}
          >
            {task.title}
          </button>
        </div>

        {/*
          Above the metadata, not among it.

          A blocker is the reason this card is not moving, which makes it the most important
          thing about it — more than its estimate, its labels or when it is due. Buried in the
          meta row it would read as one more attribute.
        */}
        {task.blockedReason && (
          <div className="task-blocked" title={`Blocked for ${daysBlocked(task.blockedSince)} days`}>
            <span className="tag overdue">blocked</span> {task.blockedReason}
          </div>
        )}

        {thumbnail && (
          <button
            type="button"
            className="task-thumb"
            onClick={onOpen}
            tabIndex={-1}
            aria-hidden="true"
          >
            {/* Empty alt: the title above says what this is, and the picture is decoration at
                this size. Announcing the filename would be noise on every card. */}
            <img src={thumbnail} alt="" loading="lazy" />
          </button>
        )}

        {/*
          The checklist, as a bar.

          "3 of 5" is a fact you have to read; a bar three fifths full is one you can see from
          across the room, which is the only way a number earns space on a card this size.
          Absent entirely when there are no subtasks, rather than an empty bar saying nothing.
        */}
        {task.subtasks.total > 0 && (
          <div
            className="task-subtasks"
            title={`${task.subtasks.done} of ${task.subtasks.total} subtasks done`}
          >
            <span className="task-subtasks-bar">
              <span style={{ width: `${(task.subtasks.done / task.subtasks.total) * 100}%` }} />
            </span>
            <span className="muted">
              {task.subtasks.done}/{task.subtasks.total}
            </span>
          </div>
        )}

        {/* Controls sit below the title rather than beside it: a card is narrow, and a
            title squeezed to four lines is harder to scan than an extra row. */}
        <div className="task-card-meta">
          {task.priority !== 'normal' && (
            <span className={`badge priority-${task.priority}`}>{task.priority}</span>
          )}
          {task.storyPoints != null && <span className="badge">{task.storyPoints} pts</span>}
          {estimate != null && <span className="muted">{estimate}h</span>}
          {task.dueOn && (
            <span className={overdue ? 'error' : 'muted'}>
              {overdue ? 'overdue ' : 'due '}
              {task.dueOn}
            </span>
          )}
          {/*
            How long it has sat here — the standup question the board could never answer.

            Only once it is worth answering. A card that arrived this morning saying "0d" is a
            number that trains people to stop reading numbers.
          */}
          {stale && (
            <span
              className={`tag age-tag age-${stale}`}
              title={`${columns.find((c) => c.key === task.status)?.label ?? task.status} for ${task.daysInColumn} days`}
            >
              {task.daysInColumn}d
            </span>
          )}
          {task.commentCount > 0 && (
            <span className="muted" title={`${task.commentCount} comments`}>
              💬 {task.commentCount}
            </span>
          )}
          {task.labels.map((l) => (
            <span key={l} className="badge">
              {l}
            </span>
          ))}
          {/*
            Sprint planning, one card at a time.

            On the card rather than in a bulk picker because that is where the decision is
            actually made — you read what a card is and then decide whether it belongs in the
            fortnight, and a multi-select of titles is a list of things you have to remember.
          */}
          {onPull && (
            <button type="button" className="chip chip-pull" onClick={onPull}>
              + sprint
            </button>
          )}
        </div>

        <div className="task-card-foot">
          {/* Whose card this is — something the board could not say for as long as it existed. */}
          {task.assignee ? (
            <Avatar id={task.assignee.id} name={task.assignee.displayName} size="sm" />
          ) : (
            <span className="avatar avatar-sm avatar-empty" title="Unassigned">
              ?
            </span>
          )}
          <select
            className="task-move"
            value={task.status}
            onChange={(e) => onMove(e.target.value)}
            aria-label={`Column for ${task.title}`}
          >
            {columns.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
});
