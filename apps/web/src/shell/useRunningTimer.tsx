import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api.js';
import { TIME_CHANGED, notifyTimeChanged } from './useDocumentTitle.js';

export interface Running {
  id: string;
  projectId: string;
  projectName: string;
  workedOn: string;
  startedAt: string;
  description: string | null;
  /**
   * The card this hour is against, when there is one.
   *
   * `time.entries.task_id` has existed since the module shipped and the two ways to start a
   * clock disagreed about it: the task page set it, and the tracker — the fastest way, and so
   * the one actually used — did not. An hour with no card is an hour a card's estimate can
   * never be compared against.
   */
  taskId: string | null;
}

/** More than a working day means the clock was almost certainly left running. */
export const LOOKS_FORGOTTEN_AFTER_HOURS = 10;

/** hh:mm:ss, because a clock that has been running for two days should look alarming. */
export function elapsed(since: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * The running timer, wherever it is shown.
 *
 * Extracted from the status bar the moment a second place needed it. Two components polling
 * one clock and each deciding for itself when to refresh is how they end up disagreeing —
 * which for a timer is not cosmetic: the number on screen is what somebody bills.
 *
 * `GET /time/running` had existed since the time module was built and nothing called it.
 * Running state used to be derived by scanning the entries of the day being viewed, so a
 * timer started on Friday was invisible on Monday while its minutes kept accruing.
 */
function useTimerState() {
  const [running, setRunning] = useState<Running | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * The value is never read: setTick re-renders, and the re-render is what recomputes
   * elapsed(). An earlier version rendered `tick` into a hidden span to "use" it, which did
   * nothing except append the counter to the bar's text.
   */
  const [, setTick] = useState(0);

  const load = useCallback(() => {
    api
      .get<{ running: Running | null }>('/time/running')
      .then((r) => setRunning(r.running))
      // Silent on failure: this is ambient chrome on every page, and an API blip must not
      // paint an error across a screen somebody is trying to work on.
      .catch(() => setRunning(null));
  }, []);

  useEffect(() => {
    load();
    /*
     * Polled rather than pushed. A websocket for one number would be the wrong trade, and 30s
     * is well inside the window where a stale timer misleads anyone. But polling alone leaves
     * it blank for half a minute after you start one, which reads as broken — so pages that
     * mutate a clock say so, and focus covers a timer started in another tab.
     */
    const poll = setInterval(load, 30_000);
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

  const start = useCallback(
    async (
      target: { projectId?: string | null; clientId?: string | null; taskId?: string | null },
      description?: string,
    ) => {
      setBusy(true);
      setError(null);
      try {
        await api.post('/time/entries', {
          // A project, a client, or neither — the clock does not care which.
          projectId: target.projectId ?? null,
          clientId: target.clientId ?? null,
          // Carried through, so starting a clock from a card produces an hour that card knows
          // about — which is the only reason logging against a card is worth doing.
          taskId: target.taskId ?? null,
          workedOn: new Date().toISOString().slice(0, 10),
          // A start with no end *is* the running entry — there is no separate timer record.
          startedAt: new Date().toISOString(),
          description: description?.trim() || null,
        });
        notifyTimeChanged();
        load();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [load],
  );


  const stop = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/time/stop', {});
      setRunning(null);
      // So an open timesheet reflects a stop it did not initiate.
      notifyTimeChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const forgotten = running
    ? (Date.now() - new Date(running.startedAt).getTime()) / 3_600_000 >=
      LOOKS_FORGOTTEN_AFTER_HOURS
    : false;

  /**
   * Stop whatever is running and start this instead.
   *
   * The server is right to refuse a second timer — two clocks running is how an hour gets
   * billed twice. But refusing was the whole answer: the UI printed "A timer is already
   * running — stop it first" in red and left you to go and find it. Wanting to switch is the
   * ordinary case, not an error, so it gets a button.
   */
  const switchTo = useCallback(
    async (
      target: { projectId?: string | null; clientId?: string | null; taskId?: string | null },
      description?: string,
    ) => {
      if (running) await stop();
      await start(target, description);
    },
    [running, stop, start],
  );

  return { running, forgotten, busy, error, start, switchTo, stop, reload: load };
}

type TimerState = ReturnType<typeof useTimerState>;
const Context = createContext<TimerState | null>(null);

/**
 * One clock for the whole application.
 *
 * The rail and the tracker page each called the hook directly, which meant two independent
 * pollers with their own copy of what was running. They agreed most of the time and could
 * disagree for up to thirty seconds after a change made in the other — and a timer that shows
 * two different answers on one screen is worse than one that is merely slow.
 *
 * Mounted above the router, so navigating does not remount it: the clock carries on across
 * pages and is already correct when you come back, rather than blank until the next fetch.
 */
export function RunningTimerProvider({ children }: { children: ReactNode }) {
  const state = useTimerState();
  return <Context.Provider value={state}>{children}</Context.Provider>;
}

export function useRunningTimer(): TimerState {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useRunningTimer must be used inside RunningTimerProvider');
  return ctx;
}
