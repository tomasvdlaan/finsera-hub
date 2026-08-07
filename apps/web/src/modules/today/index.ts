import type { WebModule } from '../types.js';
import { Dashboard } from './Dashboard.js';

/**
 * The front door, and the one page nobody else's module owns.
 *
 * It is now composed at runtime from whatever widgets the person standing in it chose, which
 * is the same discipline the shell keeps everywhere else — this module names none of the
 * modules whose widgets it renders, and does not import one.
 */
export const todayWebModule: WebModule = {
  name: 'today',
  routes: [{ path: '/today', Component: Dashboard, width: 'wide' }],
};
