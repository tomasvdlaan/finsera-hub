import type { WebModule } from '../types.js';
import { ClientChatCard, ProjectChatCard } from './CrmChatCards.js';
import { ClientDetail } from './ClientDetail.js';
import { ClientList } from './ClientList.js';
import { ProjectDetail } from './ProjectDetail.js';
import { ProjectList } from './ProjectList.js';

export const crmWebModule: WebModule = {
  name: 'crm',
  routes: [
    { path: '/clients', Component: ClientList, width: 'wide' },
    /*
     * One page, four tabs, four routes.
     *
     * The tab is in the URL rather than in component state so a billing detail can be linked
     * to, and so the back button undoes a tab change. `/clients/:id/portal` belongs to the
     * portal module's preview page, which is why the access tab is not called that.
     */
    { path: '/clients/:id', Component: ClientDetail },
    { path: '/clients/:id/billing', Component: ClientDetail },
    { path: '/clients/:id/access', Component: ClientDetail },
    { path: '/clients/:id/activity', Component: ClientDetail },
    { path: '/projects', Component: ProjectList, width: 'wide' },
    { path: '/projects/:id', Component: ProjectDetail },
  ],
  chatWidgets: {
    client: ClientChatCard,
    project: ProjectChatCard,
  },
};
