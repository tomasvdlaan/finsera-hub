import { Link } from 'react-router-dom';
import { elapsedSeconds } from '../../shell/liveMeetingReducer.js';
import { sprintFraction, sprintProgressLabel, type Sprint } from '../scrum/types.js';
import type { NoteDetail } from './types.js';

const money = (cents: number) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(cents / 100);

const clock = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

/**
 * How far through the sprint is, and in which unit.
 *
 * The unit is chosen by the server so every screen agrees, and it is named here rather than
 * implied — "12 of 28" means nothing without it, and a bar with no number beside it means
 * less. An unmeasurable sprint gets the words and no bar, because a bar at zero reads as no
 * progress rather than as nothing to measure.
 */
function SprintMeter({ sprint }: { sprint: Sprint }) {
  const fraction = sprintFraction(sprint.progress);
  return (
    <>
      <span>· {sprintProgressLabel(sprint.progress)}</span>
      {fraction !== null && (
        <span className="meter room-sprint-meter" role="progressbar" aria-valuenow={Math.round(fraction * 100)}>
          <span className="meter-fill" style={{ width: `${Math.round(fraction * 100)}%` }} />
        </span>
      )}
      {sprint.progress.blocked > 0 && (
        <span className="tag overdue">{sprint.progress.blocked} blocked</span>
      )}
    </>
  );
}

/** Initials for an avatar, from however much of a name we have. */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

/**
 * The top of the room.
 *
 * Everything you glance at without looking away from the conversation: what this meeting is,
 * how long it has been going against how long it was meant to take, who is here, and what it
 * has cost. Nothing here is a place to work — the work is the notes below.
 *
 * The timebox comes from the template rather than a column, because it is a property of the
 * ceremony: a stand-up is fifteen minutes whoever runs it.
 *
 * The sprint line appears only when the project has a sprint running. Before sprints existed
 * this bar showed the project and a count of open cards instead, and it still does when a
 * project runs a flow board — which is most of them. Inventing a cadence for a project that
 * does not work in sprints would be worse than not having one.
 */
export function RoomBar({
  note,
  projectName,
  sprint,
  running,
  needsAudio,
  startedAt,
  costCents,
  timeboxMinutes,
  workLine,
  onEnd,
  ending,
}: {
  note: NoteDetail;
  projectName?: string;
  /** The project's running sprint, when it has one. */
  sprint?: Sprint | null;
  running: boolean;
  /** Running but unfed — after a reload a shared tab has to be shared again. */
  needsAudio: boolean;
  startedAt: string | null;
  costCents: number;
  timeboxMinutes?: number;
  /** A true sentence about the work, assembled from the board. */
  workLine?: string;
  onEnd: () => void;
  ending: boolean;
}) {
  const elapsed = elapsedSeconds(startedAt);
  const box = (timeboxMinutes ?? 0) * 60;
  const over = box > 0 && elapsed > box;
  const fraction = box > 0 ? Math.min(1, elapsed / box) : 0;

  return (
    <header className="room-bar">
      <div className="room-bar-main">
        <div className="room-title">
          <Link to={`/meetings/${note.id}`} className="room-back" title="Leave the room">
            ‹
          </Link>
          <h1>{note.title}</h1>
          {note.template && <span className="tag">{note.template.replace(/_/g, ' ')}</span>}
          {note.status === 'final' && <span className="tag">done</span>}
        </div>

        <div className="room-context muted">
          {projectName ? (
            <Link to={`/projects/${note.projectId}`}>{projectName}</Link>
          ) : (
            <span className="tag overdue">no project linked</span>
          )}

          {sprint ? (
            <>
              <span>· {sprint.name}</span>
              <span>
                ·{' '}
                {sprint.progress.days.overrun
                  ? `ended ${sprint.endsOn}, not closed`
                  : `day ${sprint.progress.days.elapsed} of ${sprint.progress.days.total}`}
              </span>
              {sprint.goal && <span className="room-goal">· {sprint.goal}</span>}
              <SprintMeter sprint={sprint} />
            </>
          ) : (
            workLine && <span>· {workLine}</span>
          )}
        </div>
      </div>

      <div className="room-bar-side">
        {running && needsAudio && (
          <span className="tag overdue" title="Nothing is reaching the meeting — share again">
            no audio
          </span>
        )}

        {running && (
          <div className={over ? 'room-clock room-clock-over' : 'room-clock'}>
            <span className="statusbar-dot" />
            <span className="room-elapsed">{clock(elapsed)}</span>
            {box > 0 && <span className="muted"> / {clock(box)}</span>}
            {/* The bar is the point of a timebox: a number you have to read is a number you
                read once, at the start, and never again. */}
            {box > 0 && (
              <span className="room-box" aria-hidden="true">
                <span
                  className="room-box-fill"
                  style={{ width: `${Math.round(fraction * 100)}%` }}
                />
              </span>
            )}
          </div>
        )}

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

        {running && <span className="muted room-cost">{money(costCents)}</span>}

        <button
          onClick={onEnd}
          disabled={ending}
          className={running ? 'room-end' : undefined}
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
