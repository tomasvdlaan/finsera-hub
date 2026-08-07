import { ClientContractsWidget } from './ClientContractsWidget.js';
import { ClientQuotesWidget } from './ClientQuotesWidget.js';
import type { WidgetDef } from '../types.js';

export const salesWidgets: Record<string, WidgetDef> = {
  'sales:client-quotes': {
    title: 'Quotes',
    description: "This client's quotes, and where each one got to.",
    slot: 'entity-page',
    defaultSpan: 6,
    permission: 'sales.read',
    Component: ({ entityId }) => (entityId ? <ClientQuotesWidget clientId={entityId} /> : null),
  },
  'sales:client-contracts': {
    title: 'Contracts',
    description: 'Signed terms, end dates and notice deadlines for this client.',
    slot: 'entity-page',
    defaultSpan: 6,
    permission: 'sales.read',
    Component: ({ entityId }) => (entityId ? <ClientContractsWidget clientId={entityId} /> : null),
  },
};
