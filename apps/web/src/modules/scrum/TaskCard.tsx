import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Link } from 'react-router-dom';
import { hours, isOverdue, type Task } from './types.js';

/**
 * A card on the board.
 *
 * Dragging is one way to move it; the keyboard menu beside it is the other. A board that
 * only responds to a pointer is unusable one-handed and untestable without one.
 */
export function TaskCard({
  task,
  columns,
  onMove,
}: {
  task: Task;
  columns: Array<{ key: string; label: string }>;
  onMove: (status: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  const estimate = hours(task.estimateMinutes);
  const overdue = isOverdue(task);

  return (
    <div
      ref={setNodeRef}
      className={`task-card${isDragging ? ' dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {/* Only the handle starts a drag, so the title stays clickable and selectable. */}
      <button className="drag-handle" {...attributes} {...listeners} aria-label={`Move ${task.title}`}>
        ⠿
      </button>

      <div className="task-card-body">
        <Link to={`/scrum/tasks/${task.id}`}>{task.title}</Link>

        {/* Controls sit below the title rather than beside it: a card is narrow, and a
            title squeezed to four lines is harder to scan than an extra row. */}
        <div className="task-card-meta">
          {task.priority !== 'normal' && (
            <span className={`badge priority-${task.priority}`}>{task.priority}</span>
          )}
          {estimate != null && <span className="muted">{estimate}h</span>}
          {task.dueOn && (
            <span className={overdue ? 'error' : 'muted'}>
              {overdue ? 'overdue ' : 'due '}
              {task.dueOn}
            </span>
          )}
          {task.labels.map((l) => (
            <span key={l} className="badge">
              {l}
            </span>
          ))}
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
