import { useSyncExternalStore } from 'react';

/**
 * The phone tier, as one query shared by CSS and script.
 *
 * Most of what changes on a phone is layout and belongs in the stylesheet. This exists for the
 * few things that are a decision rather than a layout — which calendar view to open on, which
 * tabs the bottom bar shows — and it must agree with the `40rem` in phone.css, or a page
 * would choose the phone behaviour at a width where it is still drawn for a desktop.
 */
export const PHONE = '(max-width: 40rem)';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
