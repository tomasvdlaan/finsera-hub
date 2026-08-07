import type { WebModule } from '../types.js';
import { reportingWidgets } from './widgets.js';
import { Overview } from './Overview.js';

export const reportingWebModule: WebModule = {
  name: 'reporting',
  routes: [{ path: '/reporting', Component: Overview, width: 'wide' }],
  widgets: reportingWidgets
};
