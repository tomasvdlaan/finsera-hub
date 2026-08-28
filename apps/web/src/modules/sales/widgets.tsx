import { Card } from '../../shell/ui/card.js';
import { ClientContractsWidget } from './ClientContractsWidget.js';
import { ClientQuotesWidget } from './ClientQuotesWidget.js';
import type { WidgetDef } from '../types.js';

export const salesWidgets: Record<string, WidgetDef> = {
  'sales:client-quotes': {
    title: 'Quotes',
    description: "This client's quotes, and where each one got to.",
    slot: 'entity-page',
    entityTypes: ['client'],
    defaultSpan: 6,
    permission: 'sales.quotes.read',
    Component: ({ entityId }) =>
      entityId ? (
        <Card title="Quotes">
          <ClientQuotesWidget clientId={entityId} />
        </Card>
      ) : null,
  },
  'sales:client-contracts': {
    title: 'Contracts',
    description: 'Signed terms, end dates and notice deadlines for this client.',
    slot: 'entity-page',
    entityTypes: ['client'],
    defaultSpan: 6,
    permission: 'sales.quotes.read',
    Component: ({ entityId }) =>
      entityId ? (
        <Card title="Contracts">
          <ClientContractsWidget clientId={entityId} />
        </Card>
      ) : null,
  },
};
