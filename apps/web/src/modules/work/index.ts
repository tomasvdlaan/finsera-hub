import type { WebModule } from '../types.js';
import { Work } from './Work.js';

/**
 * The cross-project board. A web module with no API module behind it: it composes the scrum
 * task list with CRM project names, and belongs to neither.
 */
export const workWebModule: WebModule = {
  name: 'work',
  routes: [{ path: '/work', Component: Work }],
};
