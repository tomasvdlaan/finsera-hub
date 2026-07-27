import type { WebModule } from '../types.js';
import { Insights } from './Insights.js';

export const insightsWebModule: WebModule = {
  name: 'insights',
  routes: [{ path: '/insights', Component: Insights }],
};
