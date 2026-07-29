import type { WebModule } from '../types.js';
import { Money } from './Money.js';

/** One door for the finance pages, which keep their own routes. */
export const moneyWebModule: WebModule = {
  name: 'money',
  routes: [{ path: '/money', Component: Money }],
};
