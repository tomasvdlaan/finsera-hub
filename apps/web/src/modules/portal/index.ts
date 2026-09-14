import type { WebModule } from '../types.js';
import { ClientTickets } from './ClientTickets.js';
import { PortalPreview } from './PortalPreview.js';
import { PortalUserDetail } from './PortalUserDetail.js';
import { portalWidgets } from './widgets.js';

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
    // The same page, opened on one thread. An Insights item links here, which is the whole
    // point of raising one: the sentence and the conversation are one click apart.
    { path: '/portal/tickets/:id', Component: ClientTickets },
    // The address `portal_user` entities carry, so a mention, a link or a search result
    // opens the person rather than the client they happen to belong to.
    { path: '/portal/users/:id', Component: PortalUserDetail },
  ],

  // A client's open tickets, on their page. The first widget this module has had: until
  // now the only way to see what a client had asked was the cross-client inbox.
  widgets: portalWidgets,
};
