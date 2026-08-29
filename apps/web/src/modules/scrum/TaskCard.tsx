import { forwardRef, type CSSProperties, type HTMLAttributes } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Avatar } from '../../shell/ui/primitives.js';
import { firstImage } from '../../shell/ui/MarkdownEditor.js';
import { ageTone, daysBlocked, hours, isOverdue, type Task } from './types.js';

/**
 * The word, not a letter.
 *
 * A spike was marked `?` and an unassigned card carries a `?` avatar — the same glyph twice
 * on one card meaning two unrelated things. "Spike" costs four characters and cannot be
 * confused with anything.
 */
const TYPE_LABEL: Record<string, string> = {
  story: 'Story',
  bug: 'Bug',
  chore: 'Chore',
  spike: 'Spike',
};

/**
 * A card on the board.
 *
 * The whole card is the grip. It used to be a six-dot handle beside a column select, which is
 * two controls doing one job and neither of them the obvious one — you point at a card, you
 * mean the card. Dragging is now the only way to change a column here, so the keyboard has to
 * be able to do it too: the card is focusable, space picks it up, the arrows carry it across
 * columns and space puts it down. That is the sortable keyboard sensor, not a second code
 * path, so it cannot fall behind what the pointer does.
 *
 * The buttons inside still work, because the pointer sensor waits for six pixels of movement
 * before it calls something a drag — under that it is a click and the button gets it.
 *
 * The title is a button rather than a link. It used to navigate to the task page, which meant
 * glancing at a card cost you the board you were reading. The page still exists and the
 * preview links to it; this is the cheap look.
 *
 * What a card shows is ordered by what stops work rather than by what describes it: the
 * blocker first, then how long it has sat still, then the picture, then everything that is
 * merely true about it.
 */
export interface TaskCardProps {
  task: Task;
  columns: Array<{ key: string; label: string }>;
  /** Put this into the running sprint. Passed only while looking at the backlog. */
  onPull?: () => void;
  /** Open it in the preview beside the board. */
  onOpen?: () => void;
  selected?: boolean;
}

export function TaskCard(props: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
    /*
     * Not a button.
     *
     * dnd-kit calls a draggable `role="button"`, which was right while the grip was a button
     * of its own and is wrong now that the whole card is the grip: the card contains real
     * buttons, and a button inside a button is not a thing. `group` lets them nest honestly.
     * The role is only ever announced — the keyboard sensor listens on the element itself and
     * does not consult it.
     */
    attributes: { role: 'group', roleDescription: 'draggable card' },
  });

  return (
    <CardBody
      {...props}
      dragging={isDragging}
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      drag={{ ...attributes, ...listeners }}
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
  return <CardBody task={task} columns={columns} isGhost />;
}

const CardBody = forwardRef<
  HTMLDivElement,
  TaskCardProps & {
    dragging?: boolean;
    isGhost?: boolean;
    style?: CSSProperties;
    /** Everything that makes the card a grip — dnd-kit's own attributes and listeners. */
    drag?: HTMLAttributes<HTMLDivElement>;
  }
>(function CardBody(
  { task, columns, onPull, onOpen, selected, dragging, isGhost, style, drag },
  ref,
) {

  const estimate = hours(task.estimateMinutes);
  const overdue = isOverdue(task);
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
    <div ref={ref} className={classes} style={style} {...drag}>
      <div className="task-card-body">
        {/*
          The badges, above the title.

          They answer "is this mine to worry about" before the title answers "what is it",
          which is the order a board is actually read in — you scan a column for the one that
          matters and only then read words.
        */}
        <div className="task-badges">
          <span className={`badge type-${task.type}`}>{TYPE_LABEL[task.type] ?? 'Story'}</span>
          {task.blockedReason && <span className="badge badge-blocked">Blocked</span>}
          {/* Normal is the default and saying so on every card would make the word meaningless. */}
          {task.priority !== 'normal' && (
            <span className={`badge priority-${task.priority}`}>{task.priority}</span>
          )}
          {task.labels.map((l) => (
            <span key={l} className="badge">
              {l}
            </span>
          ))}
        </div>

        <button
          type="button"
          className="task-open"
          onClick={onOpen}
          aria-haspopup="dialog"
          aria-label={`Open ${task.title}`}
        >
          {task.title}
        </button>

        {/*
          The reason, under the badge that announced it.

          A blocker is why the card is not moving, so it outranks the estimate and the labels
          and does not belong among them.
        */}
        {task.blockedReason && (
          <div className="task-blocked" title={`Blocked for ${daysBlocked(task.blockedSince)} days`}>
            {task.blockedReason}
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

        {/*
          The footer: who has it on the left, what it costs on the right.

          Split rather than run together, because the two are asked about separately — "whose
          is this" and "how much is left in it" — and a single row of chips answers neither
          without being read end to end.
        */}
        <div className="task-card-meta">
          {task.assignee ? (
            <Avatar id={task.assignee.id} name={task.assignee.displayName} size="sm" />
          ) : (
            /*
              Quiet on purpose.

              Every card on a one-person board is unassigned, and the old bright ringed "?"
              made the least informative fact on the card its loudest mark.
            */
            <span className="avatar avatar-sm avatar-empty" title="Unassigned" aria-label="Unassigned">
              <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <circle cx="6" cy="3.6" r="2.2" stroke="currentColor" strokeWidth="1.2" />
                <path d="M1.9 10.6c0-2.2 1.8-3.4 4.1-3.4s4.1 1.2 4.1 3.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
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
          {task.dueOn && (
            <span className={overdue ? 'error' : 'muted'}>
              {overdue ? 'overdue ' : 'due '}
              {task.dueOn}
            </span>
          )}

          <span className="task-card-gap" />

          {estimate != null && <span className="muted">{estimate}h</span>}
          {task.commentCount > 0 && (
            /* An icon, not an emoji. This was the only emoji rendered anywhere in the
               product, and it picked up the platform's own font rather than the app's. */
            <span className="task-comments muted" title={`${task.commentCount} comments`}>
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path
                  d="M10.5 7.2c0 .8-.7 1.5-1.5 1.5H4.2L1.5 10.8V3.3c0-.8.7-1.5 1.5-1.5h6c.8 0 1.5.7 1.5 1.5z"
                  stroke="currentColor"
                  strokeWidth="1.1"
                  strokeLinejoin="round"
                />
              </svg>
              {task.commentCount}
            </span>
          )}
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
      </div>
    </div>
  );
});
