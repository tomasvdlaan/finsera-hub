import type { WebModule } from '../types.js';
import { NoteChatCard } from './NoteChatCard.js';
import { NoteDetail } from './NoteDetail.js';
import { NoteList } from './NoteList.js';
import { Room } from './Room.js';

export const meetingsWebModule: WebModule = {
  name: 'meetings',
  routes: [
    { path: '/meetings', Component: NoteList, width: 'wide' },
    { path: '/meetings/:id', Component: NoteDetail, width: 'read' },
    /*
     * The room takes the viewport.
     *
     * A separate route from the note rather than a mode of it, so it has a URL you can be
     * sent to and come back from — and because the note page and the room want opposite
     * things from the shell. It keeps the note's id in the path, which also means the
     * assistant picks up the meeting as its context for free.
     */
    { path: '/meetings/:id/room', Component: Room, chrome: 'bare' },
  ],
  chatWidgets: { meeting_note: NoteChatCard },
};
