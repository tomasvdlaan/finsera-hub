import type { WebModule } from '../types.js';
import { docsWidgets } from './widgets.js';
import { DocumentChatCard } from './DocumentChatCard.js';
import { DocumentDetail } from './DocumentDetail.js';
import { DocumentList } from './DocumentList.js';

export const docsWebModule: WebModule = {
  name: 'docs',
  routes: [
    { path: '/docs', Component: DocumentList, width: 'wide' },
    // The viewer is the page: a document capped at reading width renders A4 as a postcard.
    { path: '/docs/documents/:id', Component: DocumentDetail, width: 'full' },
  ],
  chatWidgets: { document: DocumentChatCard },
  widgets: docsWidgets
};
