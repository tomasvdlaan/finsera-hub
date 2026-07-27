import type { WebModule } from '../types.js';
import { ClientDetail } from './ClientDetail.js';
import { ClientList } from './ClientList.js';
import { ProjectDetail } from './ProjectDetail.js';
import { ProjectList } from './ProjectList.js';

export const crmWebModule: WebModule = {
  name: 'crm',
  routes: [
    { path: '/crm/clients', Component: ClientList },
    { path: '/crm/clients/:id', Component: ClientDetail },
    { path: '/crm/projects', Component: ProjectList },
    { path: '/crm/projects/:id', Component: ProjectDetail },
  ],
};
