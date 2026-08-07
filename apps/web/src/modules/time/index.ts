import { Tracker } from './Tracker.js';
import type { WebModule } from '../types.js';
import { DayView } from './DayView.js';
import { Timesheet } from './Timesheet.js';

export const timeWebModule: WebModule = {
  name: 'time',
  routes: [
    { path: '/time', Component: Tracker, width: 'wide' },
    { path: '/time/day', Component: DayView },
    { path: '/time/week', Component: Timesheet, width: 'wide' },
  ],
};
