import { useEffect, useState } from 'react';
import { elapsedSeconds } from '../../shell/liveMeetingReducer.js';
import type { BoardColumn, BoardTask } from './RoomPanels.js';
import type { NoteDetail } from './types.js';

const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * The band under the title, always on.
 *
 * Everything here was previously behind a tab in a rail — which meant that during a meeting,
 * the three things you glance at without breaking the conversation were the three things you
 * had to click for. A tab you must open to read is a tab you read once.
 *
 * It is deliberately not interactive beyond opening the panel that holds the detail. Reading
 * it should never cost anything.
 *
 * The stage switch is the one exception, and it earns it: it is the only control that changes
 * what you are working on rather than what you are looking at, and this band — the thing your
 * eye is already on between glances — is where you would look for it. Putting it in the title
 * bar would have meant that bar saying two things, and it exists to say one.
 *
 * On the agenda: the segments are equal width and say covered, current, or not yet. They are
 * not proportional to time spent, because nothing records time spent per item — an agenda
 * item knows only whether it has been covered. A bar drawn to imply minutes we do not measure
 * would be the most convincing lie on the screen.
 */
/** Which artefact the stage is showing. Both are things this meeting is making. */
export type Stage = 'note' | 'board';

export function RoomStrip({
  stage,
  onStage,
  hasBoard,
  note,
  columns,
  tasks,
  running,
  startedAt,
  timeboxMinutes,
  waiting,
  onOpen,
}: {
  note: NoteDetail;
  columns: BoardColumn[];
  tasks: BoardTask[];
  running: boolean;
  startedAt: string | null;
  /** How long the ceremony is meant to take, from its template. */
  timeboxMinutes?: number;
  /** Suggestions and action points with nobody's decision on them yet. */
  waiting: number;
  onOpen: (tab: 'agenda' | 'board' | 'agent') => void;
  stage: Stage;
  onStage: (stage: Stage) => void;
  /** False when no module offers a whiteboard, in which case there is nothing to switch to. */
  hasBoard: boolean;
}) {
  const [, tick] = useState(0);

  /* The elapsed clock is in this band now, so this band is what has to move. */
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const elapsed = elapsedSeconds(startedAt);
  const box = (timeboxMinutes ?? 0) * 60;
  const over = box > 0 && elapsed > box;

  const covered = note.agenda.filter((a) => a.covered).length;
  // The one being talked about now, as far as anything here can know: the first that has not
  // been marked covered.
  const current = note.agenda.find((a) => !a.covered);

  const doneKeys = new Set(columns.filter((c) => c.isDone).map((c) => c.key));
  const open = tasks.filter((t) => !doneKeys.has(t.status));
  const blocked = open.filter((t) => t.blockedReason).length;

  return (
    <div className="room-strip">
      {hasBoard && (
        <div className="room-strip-zone room-strip-stage">
          <span className="room-strip-label">Stage</span>
          <div className="room-strip-value" role="tablist" aria-label="What the stage shows">
            <button
              type="button"
              role="tab"
              aria-selected={stage === 'note'}
              className={stage === 'note' ? 'room-stage-tab room-stage-tab-on' : 'room-stage-tab'}
              onClick={() => onStage('note')}
            >
              Note
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={stage === 'board'}
              className={stage === 'board' ? 'room-stage-tab room-stage-tab-on' : 'room-stage-tab'}
              onClick={() => onStage('board')}
            >
              Whiteboard
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        className="room-strip-zone room-strip-agenda"
        onClick={() => onOpen('agenda')}
        title="Open the agenda"
      >
        {note.agenda.length > 0 ? (
          <>
            <span className="room-strip-label">
              Agenda · {covered} of {note.agenda.length}
            </span>
            <div className="room-strip-value">
              <span className="room-segments" aria-hidden="true">
                {note.agenda.map((item) => (
                  <span
                    key={item.id}
                    className={
                      item.covered
                        ? 'room-segment room-segment-done'
                        : item.id === current?.id
                          ? 'room-segment room-segment-now'
                          : 'room-segment'
                    }
                  />
                ))}
              </span>
              {current && <span className="room-strip-now">{current.title}</span>}
            </div>
          </>
        ) : (
          <>
            <span className="room-strip-label">Agenda</span>
            <span className="room-strip-value muted">none set</span>
          </>
        )}
      </button>

      {running && (
        <div className="room-strip-zone room-strip-clock">
          <span className="room-strip-label">Running</span>
          <div className="room-strip-value">
            <span className={over ? 'room-elapsed room-elapsed-over' : 'room-elapsed'}>
              {clock(elapsed)}
            </span>
            {box > 0 && <span className="faint"> / {clock(box)}</span>}
            {over && <span className="tag overdue">over</span>}
          </div>
        </div>
      )}

      <button
        type="button"
        className="room-strip-zone"
        onClick={() => onOpen('board')}
        title="Open the board"
      >
        <span className="room-strip-label">Board</span>
        <div className="room-strip-value">
          {note.projectId ? (
            <>
              <strong>{open.length} open</strong>
              {blocked > 0 && <span className="tag overdue">{blocked} blocked</span>}
            </>
          ) : (
            <span className="tag overdue">no project linked</span>
          )}
        </div>
      </button>

      <button
        type="button"
        className="room-strip-zone room-strip-waiting"
        onClick={() => onOpen('agent')}
        title={waiting > 0 ? 'Open what the assistant is waiting on' : 'Open the assistant'}
      >
        <span className="room-strip-label">Waiting on you</span>
        <div className="room-strip-value">
          {waiting > 0 ? (
            <strong className="room-strip-count">
              {waiting} {waiting === 1 ? 'suggestion' : 'suggestions'}
            </strong>
          ) : (
            <span className="muted">nothing</span>
          )}
        </div>
      </button>
    </div>
  );
}
