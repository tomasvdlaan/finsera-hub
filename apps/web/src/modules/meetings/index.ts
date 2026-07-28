import type { WebModule } from '../types.js';
import { NoteChatCard } from './NoteChatCard.js';
import { NoteDetail } from './NoteDetail.js';
import { NoteList } from './NoteList.js';

export const meetingsWebModule: WebModule = {
  name: 'meetings',
  routes: [
    { path: '/meetings', Component: NoteList },
    { path: '/meetings/:id', Component: NoteDetail },
  ],
  chatWidgets: { meeting_note: NoteChatCard },
};
