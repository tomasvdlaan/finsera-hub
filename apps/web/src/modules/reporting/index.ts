import type { WebModule } from '../types.js';
import { Overview } from './Overview.js';

export const reportingWebModule: WebModule = {
  name: 'reporting',
  routes: [{ path: '/reporting', Component: Overview, width: 'wide' }],
};
