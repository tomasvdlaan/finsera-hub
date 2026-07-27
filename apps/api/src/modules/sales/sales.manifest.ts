import { defineManifest } from '@platform/contracts';
import { z } from 'zod';

export const salesManifest = defineManifest({
  name: 'sales',
  version: '0.1.0',

  entities: [{ type: 'quote', displayTemplate: '{number}', urlPattern: '/sales/quotes/:id' }],

  structuralRefs: [
    { from: 'quote', toType: 'client', required: true },
    { from: 'quote', toType: 'project', required: false },
  ],

  publishes: [
    { name: 'quote.sent', description: 'A quote was sent and numbered.' },
    { name: 'quote.accepted', description: 'A client accepted a quote.' },
    { name: 'quote.rejected', description: 'A client rejected a quote.' },
  ],

  subscribes: [],

  permissions: [
    { capability: 'sales.quotes.read', description: 'View quotes.' },
    { capability: 'sales.quotes.write', description: 'Draft, send and decide on quotes.' },
  ],

  navigation: [{ label: 'Quotes', path: '/sales', icon: 'file-text' }],
  widgets: [{ slot: 'entity-page', component: 'sales:client-quotes' }],
  chatWidgets: [{ entityType: 'quote', component: 'sales:quote-card' }],

  reportingViews: [
    {
      view: 'sales.v_quotes',
      description: 'Quotes with totals, status, version and derived expiry.',
    },
  ],

  portalExposure: [], // Phase 7 exposes sent quotes and adds click-to-accept

  aiTools: [
    {
      name: 'sales_list_quotes',
      description:
        'List quotes, optionally filtered by status (draft, sent, accepted, rejected) or client.',
      inputSchema: z.object({
        status: z.string().optional(),
        clientId: z.string().uuid().optional(),
      }),
      outputSchema: z.object({}),
      permission: 'sales.quotes.read',
      riskClass: 'read',
      handler: 'listQuotes',
    },
    {
      name: 'sales_draft_quote',
      description:
        'Draft a quote for a client from a described scope. Returns a DRAFT for review — it does not send anything. Prices are estimates the user must confirm.',
      inputSchema: z.object({
        clientId: z.string().uuid(),
        title: z.string(),
        introduction: z.string().optional(),
        lines: z
          .array(
            z.object({
              description: z.string(),
              quantity: z.string().describe('Exact decimal, e.g. "24.00" hours'),
              unitPriceCents: z.number().int().describe('Unit price in whole cents'),
              unit: z.enum(['hours', 'days', 'fixed']).optional(),
            }),
          )
          .min(1),
      }),
      outputSchema: z.object({}),
      permission: 'sales.quotes.write',
      riskClass: 'write:draft',
      handler: 'createDraft',
    },
    {
      // Declared so the boundary is visible on the platform page; the orchestrator never
      // offers restricted tools. Sending a client-facing commercial document is not
      // delegable, the same position taken for invoices (§8).
      name: 'sales_send_quote',
      description:
        'Send a quote to a client. Restricted: client-facing commercial documents are never sent by the assistant.',
      inputSchema: z.object({ quoteId: z.string().uuid() }),
      outputSchema: z.object({}),
      permission: 'sales.quotes.write',
      riskClass: 'restricted',
      handler: 'sendQuote',
    },
  ],
});
