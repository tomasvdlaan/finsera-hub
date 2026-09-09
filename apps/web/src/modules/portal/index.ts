import type { WebModule } from '../types.js';
import { ClientTickets } from './ClientTickets.js';
import { PortalPreview } from './PortalPreview.js';
import { PortalUserDetail } from './PortalUserDetail.js';

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
    { path: '/portal/tickets', Component: ClientTickets },
    // The address `portal_user` entities carry, so a mention, a link or a search result
    // opens the person rather than the client they happen to belong to.
    { path: '/portal/users/:id', Component: PortalUserDetail },
  ],

};
