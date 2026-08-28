import type { CurrentUser } from '@platform/contracts';
import { useShared } from '../lib/useShared.js';

/**
 * What this person is allowed to do, as the UI's own copy of the server's answer.
 *
 * `libraryFor` has taken a `can` predicate since it was written, and both of its call sites
 * passed `() => true` — so the `permission` field on every widget was decoration. That was
 * invisible for as long as nothing depended on it, and it stopped being invisible the moment
 * three of the time capabilities became admin-only: without this, a member would be offered
 * "Load per person", place it, and be refused by the server on every render.
 *
 * This is a courtesy, never a control. The server checks the same capability on the same
 * request through the same `PermissionService`, and a browser that lied about this would only
 * be lying to its own user. Which is exactly why the list is fetched rather than derived: the
 * rule lives in one place, and the client is told the outcome.
 */
export function useCan(): { can: (capability: string) => boolean; ready: boolean } {
  const { data } = useShared<CurrentUser>('/core/me');
  const held = data?.capabilities;

  return {
    /*
     * Unknown until it is known.
     *
     * Defaulting to true while `/core/me` is in flight would offer a widget and then withdraw
     * it, which reads as the app changing its mind. Defaulting to false shows less for a moment
     * and never shows something it has to take back.
     */
    can: (capability: string) => held?.includes(capability) ?? false,
    ready: held !== undefined,
  };
}
