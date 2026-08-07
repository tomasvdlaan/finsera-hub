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
    { path: '/board', Component: Board, width: 'wide' },
    // Not in the rail: you configure a board occasionally and from the board itself.
    { path: '/board/settings', Component: BoardSettings, width: 'read' },
    { path: '/board/sprints', Component: SprintHistory, width: 'wide' },
    // The manifest has advertised this URL since the module was written.
    { path: '/board/sprints/:id', Component: SprintDetail },
    { path: '/board/flow', Component: Flow },
    { path: '/tasks/:id', Component: TaskDetail },
  ],
  chatWidgets: { task: TaskChatCard },
};
