import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * The Inbox number, kept live.
 *
 * It used to be fetched once, at sign-in, and never again — so on a phone, where nobody keeps
 * a tab open for hours, it was a number nobody saw change. Now it is asked for every minute
 * while the page is visible, on returning to the page, and immediately whenever something here
 * reads or clears a notification. A socket would be faster and is not worth its moving parts
 * at four people (docs/notifications-brief.md N5).
 */
const POLL_MS = 60_000;
const CHANGED = 'finsera:notifications-changed';

/** Tell the badge to look again — after marking something read, or when a push arrives. */
export function notificationsChanged(): void {
  window.dispatchEvent(new Event(CHANGED));
}

/**
 * Open Inbox items plus unread notifications: everything waiting on you, as one number.
 *
 * Both sources fail quietly. A badge is an ornament on navigation that has to work, so an
 * outage in either leaves the other's count rather than no number at all.
 */
export function useAttentionCount(enabled: boolean): number | undefined {
  const [count, setCount] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;

    // The minute poll skips a hidden page; anything somebody just did refreshes regardless —
    // they are plainly looking at it.
    const refresh = (always = false) => {
      if (!always && document.visibilityState !== 'visible') return;
      void Promise.all([
        api.get<Array<{ id: string }>>('/insights?status=open').catch(() => []),
        api.get<{ unread: number }>('/core/notifications/count').catch(() => ({ unread: 0 })),
      ]).then(([open, n]) => {
        if (alive) setCount(open.length + n.unread);
      });
    };

    const now = () => refresh(true);
    const poll = () => refresh();
    now();
    const timer = window.setInterval(poll, POLL_MS);
    window.addEventListener(CHANGED, now);
    window.addEventListener('focus', poll);
    document.addEventListener('visibilitychange', poll);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener(CHANGED, now);
      window.removeEventListener('focus', poll);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [enabled]);

  return count;
}
