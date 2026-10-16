import { Card } from '../../shell/ui/card.js';
import { ClientInvoicesWidget } from './ClientInvoicesWidget.js';
import { ProjectUnbilledWidget } from './DraftFromHours.js';
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
  /** The step after the hours: on the project they were logged against, not on a list. */
  'billing:project-unbilled': {
    title: 'Unbilled',
    description: 'Billable hours on this project not yet invoiced, with a button that drafts the invoice.',
    slot: 'entity-page',
    entityTypes: ['project'],
    defaultSpan: 6,
    permission: 'billing.write',
    Component: ({ entityId }) => (entityId ? <ProjectUnbilledWidget projectId={entityId} /> : null),
  },
};
