import type { WebModule } from '../types.js';
import { ClientChatCard, ProjectChatCard } from './CrmChatCards.js';
import { ClientDetail } from './ClientDetail.js';
import { ClientList } from './ClientList.js';
import { ProjectDetail } from './ProjectDetail.js';
import { ProjectList } from './ProjectList.js';

export const crmWebModule: WebModule = {
  name: 'crm',
  routes: [
    { path: '/crm/clients', Component: ClientList, width: 'wide' },
    { path: '/crm/clients/:id', Component: ClientDetail },
    { path: '/crm/projects', Component: ProjectList, width: 'wide' },
    { path: '/crm/projects/:id', Component: ProjectDetail },
  ],
  chatWidgets: {
    client: ClientChatCard,
    project: ProjectChatCard,
  },
};
