import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveMeeting } from './LiveMeeting.js';
import { elapsedSeconds } from './liveMeetingReducer.js';

const clock = (seconds: number) => {
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
};

const money = (cents: number) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(cents / 100);

/**
 * A meeting is being recorded, and you are somewhere else.
 *
 * The counterpart to making the session outlive the page. Now that navigating away no longer
 * ends the meeting, it is possible to leave one running and forget — with a model
 * transcribing every segment and behaviours firing on a timer, which costs money whether or
 * not anyone is talking. So the chrome says so, with the same reasoning the status bar gives
 * for the running clock: state that outlives a page belongs in the frame around it.
 *
 * Deliberately a link back rather than a stop button. Stopping writes the note, converts
 * proposals and ends the recording; that is not a thing to offer in passing from a page that
 * is showing something else.
 */
export function LivePill() {
  const { live } = useLiveMeeting();
  const [, tick] = useState(0);

  useEffect(() => {
    if (!live.running) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [live.running]);

  if (!live.running || !live.noteId) return null;

  return (
    <div className="statusbar statusbar-live">
      <span className="statusbar-dot" />
      <strong>Recording</strong>
      <span className="statusbar-time">{clock(elapsedSeconds(live.startedAt))}</span>
      <span className="muted">
        {live.lines.length} segment{live.lines.length === 1 ? '' : 's'} · {money(live.costCents)}
      </span>
      <Link to={`/meetings/${live.noteId}`}>Back to the meeting</Link>
    </div>
  );
}
