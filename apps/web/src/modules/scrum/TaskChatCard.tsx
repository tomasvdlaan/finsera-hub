import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import type { ChatWidgetProps } from '../types.js';

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  estimateMinutes: number | null;
  loggedMinutes: number;
  dueOn: string | null;
}

const humanise = (s: string) => s.replace(/_/g, ' ');
const hours = (minutes: number | null | undefined) =>
  minutes == null ? null : +(minutes / 60).toFixed(2);

/**
 * A task, as the assistant shows it — with the one comparison that matters here:
 * estimated against logged.
 */
export function TaskChatCard({ id, displayName, urlPath }: ChatWidgetProps) {
  const [task, setTask] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .get<Task>(`/scrum/tasks/${id}`)
      .then(setTask)
      .catch(() => setTask(null));

  useEffect(() => {
    void load();
  }, [id]);

  const startTimer = async () => {
    setBusy(true);
    try {
      await api.post(`/scrum/tasks/${id}/start-timer`, {});
      await load();
    } finally {
      setBusy(false);
    }
  };

  const estimate = hours(task?.estimateMinutes);
  const logged = hours(task?.loggedMinutes);

  return (
    <div className="chat-card">
      <div className="chat-card-head">
        <span className="badge">task</span>
        <Link to={urlPath}>{task?.title ?? displayName}</Link>
      </div>
      {task && (
        <div className="muted">
          {humanise(task.status)}
          {task.priority !== 'normal' && ` · ${task.priority}`}
          {logged != null && logged > 0 && ` · ${logged}h logged`}
          {estimate != null && ` of ${estimate}h estimated`}
          {task.dueOn && ` · due ${task.dueOn}`}
        </div>
      )}
      <div className="chat-card-actions">
        <Link to={urlPath}>open</Link>
        {/* Acting on what the assistant just told you, without leaving the answer. */}
        <button className="link-button" onClick={() => void startTimer()} disabled={busy}>
          start timer
        </button>
      </div>
    </div>
  );
}
