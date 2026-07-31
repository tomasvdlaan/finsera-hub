import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Button } from './ui/primitives.js';
import { elapsed, useRunningTimer } from './useRunningTimer.js';
import { TargetPicker, type Target } from '../modules/time/TargetPicker.js';

interface Project {
  id: string;
  name: string;
  clientName?: string | null;
}

/**
 * The clock, in the rail.
 *
 * It used to be a banner across the top of the page, which showed a running timer and could
 * only ever stop one — starting meant navigating to the timesheet, choosing a project and
 * finding the button. For a consultancy that bills by the hour, the gap between "I have
 * started work" and "the clock is running" is the gap where hours go missing.
 *
 * Two shapes, because there are two states and they want different things from you. Running:
 * the number, what it is against, and one button to stop. Idle: a project and a button to
 * start. Nothing else — a form in a sidebar is a form nobody fills in.
 */
export function TimerWidget() {
  const { running, forgotten, busy, error, start, stop } = useRunningTimer();
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [target, setTarget] = useState<Target>({});
  const [picking, setPicking] = useState(false);

  /*
   * Projects are fetched only when you go to start something.
   *
   * The rail is on every page; loading a project list on every page load to populate a select
   * nobody has opened is a request per navigation for nothing.
   */
  useEffect(() => {
    if (!picking || projects.length > 0) return;
    Promise.all([
      api.get<Project[]>('/crm/projects'),
      api.get<Array<{ id: string; name: string }>>('/crm/clients'),
    ])
      .then(([p, c]) => {
        setProjects(p);
        setClients(c);
      })
      .catch(() => setProjects([]));
  }, [picking, projects.length]);

  if (running) {
    return (
      <div className={forgotten ? 'timer timer-warn' : 'timer'} role="status">
        <div className="timer-head">
          <span className="timer-dot" aria-hidden="true" />
          <span className="timer-clock" aria-label={`Timer running for ${elapsed(running.startedAt)}`}>
            {elapsed(running.startedAt)}
          </span>
        </div>
        <Link to="/time" className="timer-what" title={running.projectName}>
          {running.projectName}
          {running.description ? ` — ${running.description}` : ''}
        </Link>
        {forgotten && (
          /* Ten hours in, the likeliest explanation is that somebody forgot, and saying when
             it started is more use than saying how long it has been. */
          <span className="timer-note">
            since{' '}
            {new Date(running.startedAt).toLocaleString('nl-NL', {
              weekday: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        )}
        {error && <span className="timer-note error">{error}</span>}
        <Button size="sm" variant="danger" disabled={busy} onClick={() => void stop()}>
          {busy ? 'Stopping…' : 'Stop'}
        </Button>
      </div>
    );
  }

  if (!picking) {
    return (
      <button type="button" className="nav-row timer-start" onClick={() => setPicking(true)}>
        <span className="timer-dot timer-dot-idle" aria-hidden="true" />
        <span className="nav-label">Start timer</span>
      </button>
    );
  }

  return (
    <div className="timer">
      {/* The same three shapes the tracker offers — the rail must not be the place where
          internal work is impossible to record. */}
      <TargetPicker value={target} projects={projects} clients={clients} onChange={setTarget} />
      {error && <span className="timer-note error">{error}</span>}
      <div className="row">
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          onClick={() => void start(target)}
        >
          {busy ? 'Starting…' : 'Start'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
