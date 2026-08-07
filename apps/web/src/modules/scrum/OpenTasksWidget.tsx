import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { hours, isOverdue, type Task } from './types.js';

/**
 * Open tasks for a project — contributed by this module to CRM's project page, the same
 * mechanism Time uses for budget burn and Docs for its file list.
 */
export function OpenTasksWidget({ projectId }: { projectId: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    api
      .get<Task[]>(`/scrum/tasks?projectId=${projectId}`)
      .then(setTasks)
      .catch(() => setTasks([]));
  }, [projectId]);

  const open = tasks.filter((t) => !t.completedAt);
  const estimate = open.reduce((sum, t) => sum + (t.estimateMinutes ?? 0), 0);

  if (tasks.length === 0) {
    return (
      <p className="muted">
        No tasks yet — <Link to={`/board?projectId=${projectId}`}>open the board</Link>.
      </p>
    );
  }

  return (
    <div>
      <p className="muted">
        {open.length} open of {tasks.length}
        {estimate > 0 && ` · ${hours(estimate)}h estimated remaining`} ·{' '}
        <Link to={`/board?projectId=${projectId}`}>board</Link>
      </p>
      <ul className="cards">
        {open.slice(0, 8).map((t) => (
          <li key={t.id}>
            <Link to={`/tasks/${t.id}`}>{t.title}</Link>{' '}
            <span className="muted">{t.status.replace(/_/g, ' ')}</span>
            {isOverdue(t) && <span className="badge">overdue</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
