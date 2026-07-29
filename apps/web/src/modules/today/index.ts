import type { WebModule } from '../types.js';
import { Today } from './Today.js';

/**
 * The front door. A web module with no API module behind it, because Today is composed
 * from several — insights, reporting, time, portal — and belongs to none of them.
 */
export const todayWebModule: WebModule = {
  name: 'today',
  routes: [{ path: '/today', Component: Today }],
};
