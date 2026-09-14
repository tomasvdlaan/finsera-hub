import { Card } from '../../shell/ui/card.js';
import { ClientTicketsWidget } from './ClientTicketsWidget.js';
import type { WidgetDef } from '../types.js';

export const portalWidgets: Record<string, WidgetDef> = {
  'portal:client-tickets': {
    title: 'Tickets',
    description: "What this client has asked, through their portal.",
    slot: 'entity-page',
    entityTypes: ['client'],
    defaultSpan: 6,
    // The triage capability, not `portal.admin`: reading what a client asked is delivery
    // work, and the widget should appear for whoever can actually answer it.
    permission: 'portal.tickets',
    Component: ({ entityId }) =>
      entityId ? (
        <Card title="Tickets">
          <ClientTicketsWidget clientId={entityId} />
        </Card>
      ) : null,
  },
};
