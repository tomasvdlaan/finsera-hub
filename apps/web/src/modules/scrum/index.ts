import type { WebModule } from '../types.js';
import { TaskChatCard } from './TaskChatCard.js';

/**
 * The board screen lands in step 3 of the phase; the chat card is useful before it,
 * because the assistant can already create and move tasks.
 */
export const scrumWebModule: WebModule = {
  name: 'scrum',
  routes: [],
  chatWidgets: { task: TaskChatCard },
};
