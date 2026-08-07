import type { WebModule } from '../types.js';
import { ClientRequests } from './ClientRequests.js';
import { PortalPreview } from './PortalPreview.js';

/**
 * The internal side of the client portal.
 *
 * Only a preview: the portal itself is a separate application (`apps/portal`) so that a
 * client's browser never receives the internal bundle. What lives here is the view of
 * what a client sees, for checking before and after sharing something.
 */
export const portalWebModule: WebModule = {
  name: 'portal',
  routes: [
    { path: '/clients/:id/portal', Component: PortalPreview },
    { path: '/portal/requests', Component: ClientRequests },
  ],

};
