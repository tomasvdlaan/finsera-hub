import type { WebModule } from '../types.js';
import { DemoDetail } from './DemoDetail.js';
import { DemoList } from './DemoList.js';

/** THROWAWAY — the reference pattern a real web module follows. Delete after G0. */
export const demoWebModule: WebModule = {
  name: 'demo',
  routes: [
    { path: '/demo/items', Component: DemoList },
    { path: '/demo/items/:id', Component: DemoDetail },
  ],
};
