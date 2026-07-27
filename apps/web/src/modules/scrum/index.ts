import type { WebModule } from '../types.js';
import { Board } from './Board.js';
import { TaskChatCard } from './TaskChatCard.js';
import { TaskDetail } from './TaskDetail.js';

export const scrumWebModule: WebModule = {
  name: 'scrum',
  routes: [
    { path: '/scrum', Component: Board },
    { path: '/scrum/tasks/:id', Component: TaskDetail },
  ],
  chatWidgets: { task: TaskChatCard },
};
