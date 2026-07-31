import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Link } from 'react-router-dom';
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
 * Dragging is one way to move it; the keyboard menu beside it is the other. A board that
 * only responds to a pointer is unusable one-handed and untestable without one.
 *
 * What a card shows is ordered by what stops work rather than by what describes it: the
 * blocker first, then how long it has been sitting still, then the picture, then everything
 * that is merely true about it.
 */
export function TaskCard({
  task,
  columns,
  onMove,
  onPull,
}: {
  task: Task;
  columns: Array<{ key: string; label: string }>;
  onMove: (status: string) => void;
  /** Put this into the running sprint. Passed only while looking at the backlog. */
  onPull?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

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

  return (
    <div
      ref={setNodeRef}
      className={`task-card${isDragging ? ' dragging' : ''}${stale ? ` age-${stale}` : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {/* Only the handle starts a drag, so the title stays clickable and selectable. */}
      <button className="drag-handle" {...attributes} {...listeners} aria-label={`Move ${task.title}`}>
        ⠿
      </button>

      <div className="task-card-body">
        <div className="task-card-title">
          <span className={`task-type task-type-${task.type}`} title={type.label} aria-hidden="true">
            {type.mark}
          </span>
          <Link to={`/scrum/tasks/${task.id}`}>{task.title}</Link>
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
          <Link to={`/scrum/tasks/${task.id}`} className="task-thumb" tabIndex={-1}>
            {/* Empty alt: the title above says what this is, and the picture is decoration
                at this size. Announcing the filename would be noise on every card. */}
            <img src={thumbnail} alt="" loading="lazy" />
          </Link>
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

            Only once it is worth answering. A card that arrived this morning saying "0d" is
            a number that trains people to stop reading numbers.
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
}
