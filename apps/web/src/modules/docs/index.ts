import type { WebModule } from '../types.js';
import { DocumentDetail } from './DocumentDetail.js';
import { DocumentList } from './DocumentList.js';

export const docsWebModule: WebModule = {
  name: 'docs',
  routes: [
    { path: '/docs', Component: DocumentList },
    { path: '/docs/documents/:id', Component: DocumentDetail },
  ],
};
