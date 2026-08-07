import type { WebModule } from '../types.js';
import { insightsWidgets } from './widgets.js';
import { Insights } from './Insights.js';

export const insightsWebModule: WebModule = {
  name: 'insights',
  routes: [{ path: '/insights', Component: Insights, width: 'wide' }],
  widgets: insightsWidgets
};
