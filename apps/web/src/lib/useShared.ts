import { useEffect, useState } from 'react';
import { api } from './api.js';

/**
 * One request, however many widgets asked for it.
 *
 * A dashboard is the first screen in this app where independent components choose their own
 * data, and four counters that each want `/scrum/tasks` would make four identical round trips
 * on every load — a cost that grows with how useful the widget library becomes, which is
 * exactly the wrong direction.
 *
 * Deliberately not a cache. Entries live for a few seconds, long enough to cover one render
 * pass of a page and no longer, because a dashboard is a thing people leave open and stale
 * figures on a screen that looks live are worse than a second request. Anything wanting real
 * caching should use the running-timer pattern instead, which has an owner and an invalidation
 * story; this only collapses a stampede.
 */
const WINDOW_MS = 4000;

const inflight = new Map<string, { at: number; promise: Promise<unknown> }>();

/**
 * Everything read is suspect after something is written.
 *
 * Two widgets can be about the same fact — "my week" and "weeks waiting on you" are two views
 * of one timesheet — and approving in one left the other saying "submitted" until a reload.
 * That is worse than a stale number in a corner: the two are on screen together, disagreeing,
 * and the reader has no way to know which one is right.
 *
 * A counter rather than per-path invalidation, because a widget does not know which paths its
 * action touched and guessing would be wrong exactly when it mattered. Refetching everything
 * after a write is cheap here — a dashboard is a dozen small reads — and it cannot be subtly
 * wrong, which is the property worth paying for.
 */
let generation = 0;
const listeners = new Set<() => void>();

export function refreshShared(): void {
  generation += 1;
  inflight.clear();
  for (const l of listeners) l();
}

function shared<T>(path: string): Promise<T> {
  const hit = inflight.get(path);
  if (hit && Date.now() - hit.at < WINDOW_MS) return hit.promise as Promise<T>;

  const promise = api.get<T>(path);
  inflight.set(path, { at: Date.now(), promise });
  // A failure must not be remembered. Keeping a rejected promise in the map would make one
  // blip poison every widget that asks for the same path for the rest of the window.
  promise.catch(() => inflight.delete(path));
  return promise;
}

export interface Loaded<T> {
  data: T | undefined;
  error: string | undefined;
  /** True until the first answer, either way. Widgets render a skeleton on it. */
  loading: boolean;
}

/**
 * Fetch a path, sharing the request with anything else that wants it.
 *
 * `path` may be null when a widget has not been told what to look at yet — a burn widget with
 * no project chosen — which is a real state and not an error.
 */
export function useShared<T>(path: string | null): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ data: undefined, error: undefined, loading: path !== null });
  const [at, setAt] = useState(generation);

  // Re-runs the fetch below by moving `at`, which is in that effect's dependency list.
  useEffect(() => {
    const wake = () => setAt(generation);
    listeners.add(wake);
    return () => {
      listeners.delete(wake);
    };
  }, []);

  useEffect(() => {
    if (path === null) {
      setState({ data: undefined, error: undefined, loading: false });
      return;
    }
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    shared<T>(path)
      .then((data) => live && setState({ data, error: undefined, loading: false }))
      .catch((e: Error) => live && setState({ data: undefined, error: e.message, loading: false }));
    // Guarded rather than aborted: several widgets share one request, so one of them
    // unmounting must not cancel it for the others.
    return () => {
      live = false;
    };
  }, [path, at]);

  return state;
}
