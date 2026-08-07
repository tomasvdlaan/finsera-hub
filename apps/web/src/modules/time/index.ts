import { Tracker } from './Tracker.js';
import type { WebModule } from '../types.js';
import { timeWidgets } from './widgets.js';
import { Timesheet } from './Timesheet.js';

export const timeWebModule: WebModule = {
  name: 'time',
  routes: [
    { path: '/time', Component: Tracker, width: 'wide' },
    { path: '/time/week', Component: Timesheet, width: 'wide' },
  ],
  widgets: timeWidgets
};
