import { useEffect } from 'react';

const SUFFIX = 'Finsera';

/**
 * Name the tab after what is in it.
 *
 * Every tab, bookmark and history entry in this app currently reads "Finsera Platform",
 * which makes the browser's own back-history and tab strip useless for navigation — a
 * second window on an invoice is indistinguishable from one on the timesheet.
 *
 * Pages can call this to name themselves; the shell calls it as a fallback from the
 * navigation label, so a page that never opts in still gets something better than nothing.
 */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} · ${SUFFIX}`;
    // Restored on unmount so a page that sets a title while a more specific one is already
    // set cannot leave the wrong name behind when it goes away.
    return () => {
      document.title = previous;
    };
  }, [title]);
}

/**
 * Announce that a timer started, stopped or was deleted.
 *
 * The status bar polls, because a websocket for one number would be the wrong trade — but
 * polling alone means starting a timer leaves the bar blank for up to half a minute, which
 * reads as broken rather than as slow. This is the nudge: any page that mutates a timer
 * says so, and the bar refreshes immediately.
 *
 * An event rather than a callback or a store, so the time module does not have to know the
 * shell exists and the shell does not have to know which pages can start a clock.
 */
export const TIME_CHANGED = 'finsera:time-changed';

export const notifyTimeChanged = () => window.dispatchEvent(new Event(TIME_CHANGED));
