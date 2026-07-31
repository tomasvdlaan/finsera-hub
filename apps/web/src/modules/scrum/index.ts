import type { WebModule } from '../types.js';
import { Board } from './Board.js';
import { BoardSettings } from './BoardSettings.js';
import { Flow } from './Flow.js';
import { SprintHistory } from './SprintHistory.js';
import { TaskChatCard } from './TaskChatCard.js';
import { TaskDetail } from './TaskDetail.js';

export const scrumWebModule: WebModule = {
  name: 'scrum',
  routes: [
    { path: '/scrum', Component: Board },
    // Not in the rail: you configure a board occasionally and from the board itself.
    { path: '/scrum/settings', Component: BoardSettings },
    { path: '/scrum/sprints', Component: SprintHistory },
    { path: '/scrum/flow', Component: Flow },
    { path: '/scrum/tasks/:id', Component: TaskDetail },
  ],
  chatWidgets: { task: TaskChatCard },
};
