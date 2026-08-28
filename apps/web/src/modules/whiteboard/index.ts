import type { WebModule } from '../types.js';
import { whiteboardWidgets } from './widgets.js';
import { BoardLibrary } from './BoardLibrary.js';
import { BoardPage } from './BoardPage.js';
import { BoardChatCard } from './BoardChatCard.js';

export const whiteboardWebModule: WebModule = {
  name: 'whiteboard',
  routes: [
    { path: '/whiteboards', Component: BoardLibrary, width: 'wide' },
    /*
     * The board takes the viewport, for the same reason the meeting room does.
     *
     * An infinite canvas inside a padded, width-capped <main> is a canvas you cannot draw on:
     * every pan hits a wall a few hundred pixels away. `bare` is the shell's existing word for
     * "this page is the whole window", and the route still has a URL you can be sent to.
     */
    { path: '/whiteboards/:id', Component: BoardPage, chrome: 'bare' },
  ],
  chatWidgets: { whiteboard: BoardChatCard },
  widgets: whiteboardWidgets,
};
