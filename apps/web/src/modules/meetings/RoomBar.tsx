import { Link } from 'react-router-dom';
import type { Sprint } from '../scrum/types.js';
import type { NoteDetail } from './types.js';

/** Initials for an avatar, from however much of a name we have. */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

/**
 * The top of the room: what this meeting is, who is in it, and the way out.
 *
 * Only identity lives here now. The clock, the cost, the board and the agenda used to share
 * this bar and each got a few pixels and a slash — a row of numbers with no room to say what
 * any of them meant. They are in the strip below, which exists to hold exactly that, and the
 * bar is left saying the one thing you need when you glance at the top of a screen: which
 * meeting this is.
 *
 * The sprint appears only when the project has one running. Most projects run a flow board and
 * have none, and inventing a cadence for them would be worse than having nothing to say.
 */
export function RoomBar({
  note,
  projectName,
  sprint,
  running,
  onEnd,
  ending,
}: {
  note: NoteDetail;
  projectName?: string;
  /** The project's running sprint, when it has one. */
  sprint?: Sprint | null;
  running: boolean;
  onEnd: () => void;
  ending: boolean;
}) {
  return (
    <header className="room-bar">
      <div className="room-title">
        <Link to={`/meetings/${note.id}`} className="room-back" title="Leave the room">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <h1>{note.title}</h1>
        {note.template && <span className="tag">{note.template.replace(/_/g, ' ')}</span>}
        {note.status === 'final' && <span className="tag">done</span>}

        <span className="room-context">
          {projectName ? (
            <Link to={`/projects/${note.projectId}`}>{projectName}</Link>
          ) : (
            <span className="tag overdue">no project linked</span>
          )}
          {sprint && (
            <>
              <span className="faint">·</span>
              <span className="muted">{sprint.name}</span>
              <span className="muted">
                {sprint.progress.days.overrun
                  ? `ended ${sprint.endsOn}, not closed`
                  : `day ${sprint.progress.days.elapsed} of ${sprint.progress.days.total}`}
              </span>
            </>
          )}
        </span>
      </div>

      <div className="room-bar-side">
        <div className="room-people">
          {note.attendees.map((person) => (
            <span
              key={person.id}
              className={
                person.consent === 'granted' ? 'room-avatar' : 'room-avatar room-avatar-unconsented'
              }
              title={
                person.consent === 'granted'
                  ? `${person.name} — consented`
                  : `${person.name} — has not consented to being recorded`
              }
            >
              {initials(person.name)}
            </span>
          ))}
        </div>

        <button
          onClick={onEnd}
          disabled={ending}
          className={running ? 'room-end primary' : undefined}
          title={
            running
              ? 'Stop recording, write the note, and go through what it produced'
              : 'Mark this meeting done'
          }
        >
          {ending ? 'Ending…' : running ? 'End & review' : 'Mark done'}
        </button>
      </div>
    </header>
  );
}
