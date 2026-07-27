import type { WebModule } from '../types.js';
import { DayView } from './DayView.js';
import { Timesheet } from './Timesheet.js';

export const timeWebModule: WebModule = {
  name: 'time',
  routes: [
    { path: '/time', Component: DayView },
    { path: '/time/week', Component: Timesheet },
  ],
};
