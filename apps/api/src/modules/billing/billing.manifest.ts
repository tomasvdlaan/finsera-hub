import { defineManifest } from '@platform/contracts';
import { z } from 'zod';

export const billingManifest = defineManifest({
  name: 'billing',
  version: '0.1.0',

  entities: [{ type: 'invoice', displayTemplate: '{number}', urlPattern: '/billing/invoices/:id' }],

  structuralRefs: [
    { from: 'invoice', toType: 'client', required: true },
    { from: 'invoice', toType: 'project', required: false },
  ],

  publishes: [
    { name: 'invoice.issued', description: 'An invoice was issued and numbered.' },
    { name: 'invoice.paid', description: 'An invoice was marked paid.' },
  ],

  subscribes: [],

  permissions: [
    { capability: 'billing.read', description: 'View invoices.' },
    { capability: 'billing.write', description: 'Draft, edit and credit invoices.' },
    { capability: 'billing.issue', description: 'Issue an invoice — allocate its legal number.' },
  ],

  navigation: [{ label: 'Invoices', path: '/billing', icon: 'receipt' }],
  widgets: [{ slot: 'entity-page', component: 'billing:client-invoices' }],
  chatWidgets: [{ entityType: 'invoice', component: 'billing:invoice-card' }],

  reportingViews: [
    { view: 'billing.v_invoices', description: 'Invoices with totals, status and overdue flag.' },
  ],

  portalExposure: [], // Phase 7 exposes issued invoices, read-only

  aiTools: [
    {
      name: 'billing_list_invoices',
      description: 'List invoices, optionally by client or status. Amounts are euro cents.',
      inputSchema: z.object({
        clientId: z.string().uuid().optional(),
        status: z.enum(['draft', 'issued', 'paid']).optional(),
      }),
      outputSchema: z.object({}),
      permission: 'billing.read',
      riskClass: 'read',
      handler: 'listInvoices',
    },
    {
      name: 'billing_draft_from_hours',
      description:
        'Draft an invoice from the submitted, unbilled hours on a project. Returns a DRAFT for review — it does not issue or send anything.',
      inputSchema: z.object({ projectId: z.string().uuid() }),
      outputSchema: z.object({}),
      permission: 'billing.write',
      riskClass: 'write:draft',
      handler: 'draftFromHours',
    },
    {
      // Declared so the boundary is visible on the platform page; the orchestrator never
      // offers restricted tools, and sending a demand for money is not delegable (§8).
      name: 'billing_send_invoice',
      description: 'Send an issued invoice to the client. Permanently restricted.',
      inputSchema: z.object({ invoiceId: z.string().uuid() }),
      outputSchema: z.object({}),
      permission: 'billing.issue',
      riskClass: 'restricted',
      handler: 'sendInvoice',
    },
  ],
});
