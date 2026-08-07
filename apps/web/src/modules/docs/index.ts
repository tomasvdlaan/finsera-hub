import type { WebModule } from '../types.js';
import { DocumentChatCard } from './DocumentChatCard.js';
import { DocumentDetail } from './DocumentDetail.js';
import { DocumentList } from './DocumentList.js';

export const docsWebModule: WebModule = {
  name: 'docs',
  routes: [
    { path: '/docs', Component: DocumentList, width: 'wide' },
    { path: '/docs/documents/:id', Component: DocumentDetail, width: 'read' },
  ],
  chatWidgets: { document: DocumentChatCard },
};
