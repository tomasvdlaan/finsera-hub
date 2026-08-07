import { Card } from '../../shell/ui/card.js';
import { ClientInvoicesWidget } from './ClientInvoicesWidget.js';
import type { WidgetDef } from '../types.js';

export const billingWidgets: Record<string, WidgetDef> = {
  'billing:client-invoices': {
    title: 'Invoices',
    description: "This client's invoices, drafts included.",
    slot: 'entity-page',
    entityTypes: ['client'],
    defaultSpan: 6,
    permission: 'billing.read',
    Component: ({ entityId }) =>
      entityId ? (
        <Card title="Invoices">
          <ClientInvoicesWidget clientId={entityId} />
        </Card>
      ) : null,
  },
};
