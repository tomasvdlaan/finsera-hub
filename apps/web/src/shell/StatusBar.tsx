import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { TIME_CHANGED, notifyTimeChanged } from './useDocumentTitle.js';

interface Running {
  id: string;
  projectId: string;
  projectName: string;
  workedOn: string;
  startedAt: string;
  description: string | null;
}

/** hh:mm:ss, because a clock that has been running for two days should look alarming. */
function elapsed(since: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** More than a working day means the clock was almost certainly left running. */
const LOOKS_FORGOTTEN_AFTER_HOURS = 10;

/**
 * State that outlives a page.
 *
 * `GET /time/running` has existed since the time module was built and nothing in this app
 * has ever called it. Running state was derived instead by scanning the entries of the day
 * being viewed (DayView), which means a timer started on Friday is invisible on Monday —
 * while its minutes keep accruing, because an entry with a start and no end is exactly what
 * a running timer is.
 *
 * So this lives in the shell rather than on the timesheet: the whole point is to be visible
 * from wherever you actually are when you realise.
 */
export function StatusBar() {
  const [running, setRunning] = useState<Running | null>(null);
  // The value is never read: setTick re-renders, and the re-render is what recomputes
  // elapsed(). An earlier version rendered `tick` into a hidden span to "use" it, which
  // did nothing except append the counter to the bar's text content.
  const [, setTick] = useState(0);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<{ running: Running | null }>('/time/running')
      .then((r) => setRunning(r.running))
      // Silent on failure: this is ambient chrome on every page, and an API blip must not
      // paint an error banner across a screen the user is trying to work on.
      .catch(() => setRunning(null));
  }, []);

  useEffect(() => {
    load();
    // Polled rather than pushed. A websocket for one number would be the wrong trade, and
    // 30s is well inside the window where a stale timer misleads anyone.
    const poll = setInterval(load, 30_000);
    // But polling alone means the bar is blank for up to half a minute after you start a
    // timer, which reads as broken. Pages that mutate a clock say so, and focus covers a
    // timer started in another tab.
    window.addEventListener(TIME_CHANGED, load);
    window.addEventListener('focus', load);
    return () => {
      clearInterval(poll);
      window.removeEventListener(TIME_CHANGED, load);
      window.removeEventListener('focus', load);
    };
  }, [load]);

  useEffect(() => {
    if (!running) return;
    const clock = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(clock);
  }, [running]);

  const stop = () => {
    setStopping(true);
    setError(null);
    api
      .post('/time/stop', {})
      .then(() => {
        setRunning(null);
        // So an open timesheet reflects the stop it did not initiate.
        notifyTimeChanged();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setStopping(false));
  };

  if (!running) return null;

  const hours = (Date.now() - new Date(running.startedAt).getTime()) / 3_600_000;
  const forgotten = hours >= LOOKS_FORGOTTEN_AFTER_HOURS;

  return (
    <div className={`statusbar${forgotten ? ' statusbar-warn' : ''}`} role="status">
      <span className="statusbar-dot" aria-hidden="true" />
      <span
        className="statusbar-time"
        aria-label={`Timer running for ${elapsed(running.startedAt)}`}
      >
        {elapsed(running.startedAt)}
      </span>
      <Link to="/time" className="statusbar-what">
        {running.projectName}
        {running.description ? ` — ${running.description}` : ''}
      </Link>
      {forgotten && (
        <span className="statusbar-note">
          started {new Date(running.startedAt).toLocaleString('nl-NL', {
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      )}
      {error && <span className="statusbar-note error">{error}</span>}
      <button onClick={stop} disabled={stopping}>
        {stopping ? 'Stopping…' : 'Stop'}
      </button>
    </div>
  );
}
