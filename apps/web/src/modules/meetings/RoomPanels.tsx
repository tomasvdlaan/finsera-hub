import { Link } from 'react-router-dom';
import { Empty } from '../../shell/ui/primitives.js';
import type { NoteDetail } from './types.js';

export interface BoardColumn {
  key: string;
  label: string;
  isDone: boolean;
}

export interface BoardTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueOn: string | null;
  estimateMinutes: number | null;
  blockedReason: string | null;
}

const hours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10}h`;

/**
 * The panels the dock opens onto.
 *
 * Board, agenda and people were tabs of the rail that used to stand beside the notes. They
 * are the same panels; what changed is that they are no longer competing with the notes for
 * the screen. Each one is detail you go and look at, which is what the dock is for — the
 * glanceable part of all three now lives in the strip and never needs opening.
 */

/** Where the work stands, on this note's project, using that project's own columns. */
export function BoardPanel({
  note,
  columns,
  tasks,
}: {
  note: NoteDetail;
  columns: BoardColumn[];
  tasks: BoardTask[];
}) {
  if (!note.projectId) {
    return (
      <p className="muted">
        This note is not linked to a project, so there is no board to show — and no action
        point can become a task. Link one on the note.
      </p>
    );
  }
  if (tasks.length === 0) {
    return <Empty>Nothing open on this project.</Empty>;
  }

  const today = new Date().toISOString().slice(0, 10);
  const blocked = tasks.filter((t) => t.blockedReason);

  return (
    <>
      {/*
        Blocked cards first, out of their columns.

        In a stand-up the blockers are the agenda — the rest of the board is context. Leaving
        them scattered through the columns means reading the whole board to find the three
        things anybody needs to talk about.
      */}
      {blocked.length > 0 && (
        <section className="room-block">
          <h3>Blocked {blocked.length}</h3>
          <ul className="cards">
            {blocked.map((t) => (
              <li key={t.id}>
                <Link to={`/tasks/${t.id}`}>{t.title}</Link>
                <div className="task-blocked">
                  <span className="tag overdue">blocked</span> {t.blockedReason}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {columns
        .filter((c) => !c.isDone)
        .map((column) => {
          const inColumn = tasks.filter((t) => t.status === column.key);
          if (inColumn.length === 0) return null;
          const estimated = inColumn.reduce((n, t) => n + (t.estimateMinutes ?? 0), 0);
          return (
            <section className="room-block" key={column.key}>
              <h3>
                {column.label} <span className="muted">{inColumn.length}</span>
                {estimated > 0 && <span className="muted"> · {hours(estimated)}</span>}
              </h3>
              <ul className="cards">
                {inColumn.map((t) => (
                  <li key={t.id}>
                    <Link to={`/tasks/${t.id}`}>{t.title}</Link>
                    {t.priority !== 'normal' && (
                      <span className={`badge priority-${t.priority}`}> {t.priority}</span>
                    )}
                    {t.dueOn && (
                      <span className={t.dueOn < today ? 'tag overdue' : 'tag'}>
                        {' '}
                        {t.dueOn < today ? 'overdue' : 'due'} {t.dueOn}
                      </span>
                    )}
                    {t.blockedReason && (
                      <>
                        {' '}
                        <span className="tag overdue">blocked</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
    </>
  );
}

export function AgendaPanel({
  note,
  onCovered,
}: {
  note: NoteDetail;
  onCovered: (itemId: string, covered: boolean) => void;
}) {
  if (note.agenda.length === 0) {
    return <Empty>No agenda. Add one on the note if this meeting needs a shape.</Empty>;
  }
  return (
    <ul className="agenda">
      {note.agenda.map((item) => (
        <li key={item.id}>
          <label>
            <input
              type="checkbox"
              checked={item.covered}
              onChange={(e) => onCovered(item.id, e.target.checked)}
            />{' '}
            <span className={item.covered ? 'muted' : undefined}>{item.title}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

/**
 * Who is here, and whether they agreed to be recorded.
 *
 * Consent is the one thing in this rail that is not a convenience. Recording refuses to start
 * without it, so a room that cannot record needs to say why here rather than failing at the
 * button.
 */
export function PeoplePanel({ note }: { note: NoteDetail }) {
  return (
    <>
      <ul className="cards">
        {note.attendees.map((person) => (
          <li key={person.id}>
            {person.name}{' '}
            {person.consent === 'granted' ? (
              <span className="tag">consented</span>
            ) : person.consent === 'declined' ? (
              <span className="tag overdue">declined</span>
            ) : (
              <span className="tag overdue">not asked</span>
            )}
            {person.detectedAt && <span className="muted"> · was in the call</span>}
          </li>
        ))}
      </ul>
      {note.attendees.length === 0 && (
        <Empty>Nobody recorded yet. Add attendees on the note.</Empty>
      )}
      {note.unconsentedPresent.length > 0 && (
        <p className="error">
          {note.unconsentedPresent.map((p) => p.name).join(', ')} joined the call without having
          agreed to be recorded.
        </p>
      )}
    </>
  );
}
