import { useState } from 'react';
import type { Line } from '../../shell/liveMeetingReducer.js';

const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

/** How many lines murmur at the edge of the room before you have to ask for more. */
const TAIL = 3;

/**
 * The last few things anyone said.
 *
 * Deliberately quiet. During a meeting you are looking at the notes, and the transcript's job
 * is to reassure you that something is being heard — not to be read. A full scrolling
 * transcript in the corner of a room pulls the eye every few seconds and competes with the
 * conversation, which is the opposite of useful.
 *
 * So: three lines, small, muted, fixed height, and no autoscrolling container. The height is
 * fixed rather than fluid because a panel that grows and shrinks as sentences arrive reflows
 * everything beside it, and the notes are beside it.
 *
 * `aria-live` is off on purpose. It updates every few seconds for the whole meeting;
 * announcing each line would make a screen reader unusable exactly when someone is trying to
 * listen to a room. The full transcript is available on demand, where it can be read
 * properly.
 */
export function TranscriptTicker({ lines }: { lines: Line[] }) {
  const [open, setOpen] = useState(false);
  const tail = open ? lines : lines.slice(-TAIL);

  return (
    <div className={open ? 'ticker ticker-open' : 'ticker'} aria-live="off">
      <div className="ticker-head">
        <span className="muted">Heard</span>
        {lines.length > TAIL && (
          <button className="link-button" onClick={() => setOpen((o) => !o)}>
            {open ? 'just the last few' : `all ${lines.length}`}
          </button>
        )}
      </div>

      {lines.length === 0 ? (
        <p className="muted ticker-line">Listening…</p>
      ) : (
        tail.map((line) => (
          <p key={line.id} className="muted ticker-line">
            <span className="ticker-at">{clock(line.at)}</span>
            {line.speaker && <strong>{line.speaker}: </strong>}
            {line.text}
          </p>
        ))
      )}
    </div>
  );
}
