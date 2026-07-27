import type { WebModule } from '../types.js';
import { Timesheet } from './Timesheet.js';

export const timeWebModule: WebModule = {
  name: 'time',
  routes: [{ path: '/time', Component: Timesheet }],
};
