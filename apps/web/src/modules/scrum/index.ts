import type { WebModule } from '../types.js';
import { Board } from './Board.js';
import { BoardSettings } from './BoardSettings.js';
import { Flow } from './Flow.js';
import { SprintDetail } from './SprintDetail.js';
import { SprintHistory } from './SprintHistory.js';
import { TaskChatCard } from './TaskChatCard.js';
import { TaskDetail } from './TaskDetail.js';

export const scrumWebModule: WebModule = {
  name: 'scrum',
  routes: [
    { path: '/scrum', Component: Board, width: 'wide' },
    // Not in the rail: you configure a board occasionally and from the board itself.
    { path: '/scrum/settings', Component: BoardSettings, width: 'read' },
    { path: '/scrum/sprints', Component: SprintHistory, width: 'wide' },
    // The manifest has advertised this URL since the module was written.
    { path: '/scrum/sprints/:id', Component: SprintDetail },
    { path: '/scrum/flow', Component: Flow },
    { path: '/scrum/tasks/:id', Component: TaskDetail },
  ],
  chatWidgets: { task: TaskChatCard },
};
