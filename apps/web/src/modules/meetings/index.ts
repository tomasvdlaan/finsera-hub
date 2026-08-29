import type { WebModule } from '../types.js';
import { meetingsWidgets } from './widgets.js';
import { NoteChatCard } from './NoteChatCard.js';
import { NoteDetail } from './NoteDetail.js';
import { NoteList } from './NoteList.js';
import { Room } from './Room.js';

export const meetingsWebModule: WebModule = {
  name: 'meetings',
  routes: [
    { path: '/meetings', Component: NoteList, width: 'wide' },
    /*
     * The whole width, and a grid to spend it on.
     *
     * It was capped at a reading measure, which is the right call for a page that is one
     * column of prose and the wrong one here: this page is a document *and* everything around
     * it — what you owe, who was there, what it cost — and at 46rem all of that was a single
     * stack a thousand pixels narrower than the screen it was on. The note keeps its reading
     * width regardless; prose is capped on the text, not on the page.
     */
    { path: '/meetings/:id', Component: NoteDetail, width: 'full' },
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
  widgets: meetingsWidgets
};
