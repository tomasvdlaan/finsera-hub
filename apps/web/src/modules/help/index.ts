import type { WebModule } from '../types.js';
import { HelpHome } from './HelpHome.js';
import { HelpPageView } from './HelpPageView.js';

export const helpWebModule: WebModule = {
  name: 'help',
  routes: [
    { path: '/help', Component: HelpHome, width: 'read' },
    // A page's address contains a slash (`time/log-hours`), so it is a splat, not a parameter.
    { path: '/help/*', Component: HelpPageView, width: 'read' },
  ],
};
