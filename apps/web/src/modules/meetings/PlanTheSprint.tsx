import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Empty } from '../../shell/ui/primitives.js';
import { hours, type Board, type Sprint, type Task } from '../scrum/types.js';

/** The coming Monday, and a fortnight from it — the dates a planning meeting nearly always means. */
function defaultDates(): { startsOn: string; endsOn: string } {
  const start = new Date();
  start.setDate(start.getDate() + ((8 - start.getDay()) % 7 || 7));
  const end = new Date(start);
  end.setDate(end.getDate() + 13);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { startsOn: iso(start), endsOn: iso(end) };
}

/**
 * Sprint planning that produces a sprint.
 *
 * A planning meeting was held on 30 July and no sprint existed afterwards. That was not an
 * oversight — the note offered a `## Coming in` heading, and committing to it meant leaving
 * for a different screen and a separate dialog, which is a thing nobody does while a meeting
 * is running. So the ceremony happened and the board never heard about it.
 *
 * This is the same two writes the board already supports, in the place the decision is made:
 * create the sprint, and pull the cards you just agreed on into it.
 */
export function PlanTheSprint({
  noteId,
  projectId,
  onPlanned,
}: {
  noteId: string;
  projectId: string;
  onPlanned: () => void;
}) {
  const [backlog, setBacklog] = useState<Task[]>([]);
  const [ready, setReady] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [dates, setDates] = useState(defaultDates);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    api
      .get<Task[]>(`/scrum/tasks?projectId=${projectId}`)
      .then((ts) => setBacklog(ts.filter((t) => !t.sprintId)))
      .catch(() => setBacklog([]));
    // What "ready" means, beside the list where you decide what comes in — which is the only
    // moment it is any use.
    api
      .get<Board>(`/scrum/boards/${projectId}`)
      .then((b) => setReady(b.definitionOfReady))
      .catch(() => setReady(null));
    // A name nobody has to think about. It is renameable, and "Sprint 5" is what it would
    // have been called anyway.
    api
      .get<Sprint[]>(`/scrum/sprints?projectId=${projectId}`)
      .then((ss) => setName(`Sprint ${ss.length + 1}`))
      .catch(() => setName('Sprint 1'));
  }, [projectId]);

  const toggle = (taskId: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });

  const committed = backlog
    .filter((t) => picked.has(t.id))
    .reduce((n, t) => n + (t.estimateMinutes ?? 0), 0);

  const plan = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const sprint = await api.post<Sprint>('/scrum/sprints', {
        projectId,
        name: name.trim(),
        goal: goal.trim() || null,
        ...dates,
      });
      // One at a time, because that is what the endpoint takes. A handful of cards is the
      // whole point of a fortnight, so this is not the loop worth optimising.
      for (const taskId of picked) {
        await api.patch(`/scrum/tasks/${taskId}`, { sprintId: sprint.id });
      }
      // And the note stops being a document about a sprint and becomes attached to one.
      await api.post(`/meetings/${noteId}/sprint`, { sprintId: sprint.id });
      onPlanned();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>Plan the sprint</h2>
      <p className="muted">
        This meeting has not produced a sprint yet. Name it, say what it is for, and pick what
        comes in.
      </p>
      {error && <p className="error">{error}</p>}

      <form onSubmit={(e) => void plan(e)}>
        <div className="row">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Starts
            <input
              type="date"
              value={dates.startsOn}
              onChange={(e) => setDates((d) => ({ ...d, startsOn: e.target.value }))}
            />
          </label>
          <label>
            Ends
            <input
              type="date"
              value={dates.endsOn}
              onChange={(e) => setDates((d) => ({ ...d, endsOn: e.target.value }))}
            />
          </label>
        </div>
        <label className="field">
          Goal
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="One sentence. A fortnight of unrelated cards is not a sprint."
          />
        </label>

        <h3>Coming in</h3>
        {ready && <p className="muted">Ready means: {ready}</p>}
        {backlog.length === 0 ? (
          <Empty>
            Nothing in the backlog. Cards can be pulled in later from the board.
          </Empty>
        ) : (
          <ul className="flow-list">
            {backlog.map((t) => (
              <li key={t.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={picked.has(t.id)}
                    onChange={() => toggle(t.id)}
                  />{' '}
                  {t.title}
                </label>
                {t.estimateMinutes != null && (
                  <span className="muted"> · {hours(t.estimateMinutes)}h</span>
                )}
                {/* Nothing is stopping an unestimated card going in — but the total below
                    stops meaning anything the moment one does, so it says which. */}
                {t.estimateMinutes == null && picked.has(t.id) && (
                  <span className="muted"> · no estimate</span>
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="muted">
          {picked.size} {picked.size === 1 ? 'card' : 'cards'}
          {committed > 0 && ` · ${hours(committed)}h estimated`}
        </p>

        <button type="submit" disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create the sprint'}
        </button>
      </form>
    </section>
  );
}

/** Once a note has a sprint, the panel becomes a link to it. */
export function SprintLine({ sprint }: { sprint: Sprint }) {
  return (
    <p>
      <Link to={`/scrum/sprints/${sprint.id}`}>{sprint.name}</Link>
      {sprint.goal && <span className="muted"> — {sprint.goal}</span>}
    </p>
  );
}
